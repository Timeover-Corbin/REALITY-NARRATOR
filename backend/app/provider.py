"""GPT / DeepSeek image narration and independent cloud speech via REST."""
import base64
import io
import json
import logging
import re
import wave
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from .models import BatchMetadata, VisionResult
from .settings import Settings

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AudioResult:
    data: bytes
    mime_type: str = "audio/wav"


def validate_wav(data: bytes) -> AudioResult:
    if not data or len(data) > 8 * 1024 * 1024:
        raise ProviderError("TTS音频为空或超过大小限制。")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (wav.getnframes() == 0 or wav.getnframes() / wav.getframerate() > 90
                    or len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth()):
                raise ValueError("Invalid WAV duration or truncated data")
    except (wave.Error, EOFError, ValueError, ZeroDivisionError) as exc:
        raise ProviderError("TTS返回了无效WAV文件。") from exc
    return AudioResult(data)


def pcm_to_wav(data: bytes) -> AudioResult:
    # OpenAI PCM and ElevenLabs pcm_24000 are 24kHz signed 16-bit mono.
    if not data or len(data) % 2 or len(data) > 24000 * 2 * 90:
        raise ProviderError("TTS返回了无效或过长的PCM音频。")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(data)
    return validate_wav(output.getvalue())


VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "should_speak": {"type": "boolean"},
        "observation": {"type": "string"},
        "narration": {"type": "string"},
    },
    "required": ["should_speak", "observation", "narration"],
    "additionalProperties": False,
}


def vision_format_error(errors: list[dict]) -> str:
    reasons = []
    for error in errors:
        field = next((part for part in error["loc"] if part in VISION_SCHEMA["properties"]), None)
        kind = error["type"]
        if kind == "missing" and field:
            reason = f"缺少字段 {field}"
        elif kind == "extra_forbidden":
            reason = "包含约定之外的字段"
        elif kind in {"bool_type", "bool_parsing"}:
            reason = "should_speak 必须是布尔值 true 或 false"
        elif kind == "string_type" and field:
            reason = f"{field} 必须是字符串，不能是 null、数组或对象"
        elif kind == "string_too_long" and field:
            reason = f"{field} 超过1000个字符"
        elif kind == "value_error":
            reason = "should_speak=true 时，observation 和 narration 都不能为空"
        else:
            reason = "JSON字段不符合约定格式"
        if reason not in reasons:
            reasons.append(reason)
    return "；".join(reasons)


def parse_vision_result(text: str, provider: str, batch_id: str) -> VisionResult:
    # Accept an entire fenced JSON response, without extracting objects from prose.
    text = text.strip().removeprefix("\ufeff").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        reason = f"不是有效JSON（第{exc.lineno}行，第{exc.colno}列）"
    else:
        if not isinstance(data, dict):
            reason = "JSON顶层必须是对象"
        else:
            # Explicit silence needs no narration; some models emit null here.
            if data.get("should_speak") is False and "narration" in data and data["narration"] is None:
                data["narration"] = ""
            try:
                result = VisionResult.model_validate(data)
            except ValidationError as exc:
                reason = vision_format_error(exc.errors(include_input=False, include_context=False))
            else:
                if not result.should_speak:
                    result.narration = ""
                return result
    # Log only the failure category, never model text, images or credentials.
    logger.warning("%s vision format rejected (batch=%s): %s", provider, batch_id, reason)
    raise ProviderError(f"{provider}返回的旁白格式不正确：{reason}。请重试。")


def check_status(response: httpx.Response, provider: str):
    status = response.status_code
    if status < 400:
        return
    if status in {401, 403}:
        raise ProviderError(f"{provider}拒绝访问，请检查API Key及模型权限。")
    if status == 429:
        raise ProviderError(f"{provider}配额或请求频率超限，请稍后再试。", 429)
    raise ProviderError(f"{provider}请求失败（HTTP {status}），请检查模型名、接口地址及账户可用性。")


class AIProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def _json_request(self, endpoint: str, key: str, payload: dict, name: str) -> dict:
        try:
            response = await self.client.post(endpoint, json=payload,
                                              headers={"Authorization": f"Bearer {key}"}, timeout=110)
        except httpx.TimeoutException as exc:
            raise ProviderError(f"{name}响应超时，请稍后再试。", 504) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"无法连接{name}，请检查后端网络。") from exc
        check_status(response, name)
        try:
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Not an object")
            return data
        except (ValueError, json.JSONDecodeError) as exc:
            raise ProviderError(f"{name}返回了无法解析的数据。") from exc

    async def describe(self, images: list[bytes], metadata: BatchMetadata, prompt: str) -> VisionResult:
        provider = metadata.config.narration.provider
        key = self.settings.key_for(provider)
        if not key:
            raise ProviderError(f"请先在 backend/.env 设置 {provider.upper()}_API_KEY，然后重启后端。", 503)
        times = metadata.frame_timestamps_ms
        content = []
        for index, (image, timestamp) in enumerate(zip(images, times)):
            label = f"Frame {index + 1}, {(timestamp - times[0]) / 1000:.2f}s"
            url = "data:image/jpeg;base64," + base64.b64encode(image).decode()
            if provider == "openai":
                content.extend([{"type": "input_text", "text": label},
                                {"type": "input_image", "image_url": url, "detail": "low"}])
            else:
                content.extend([{"type": "text", "text": label},
                                {"type": "image_url", "image_url": {"url": url, "detail": "low"}}])
        if provider == "openai":
            payload = {
                "model": self.settings.openai_vision_model, "store": False,
                "instructions": prompt,
                "input": [{"role": "user", "content": content}],
                "max_output_tokens": 1200,
                "text": {"format": {"type": "json_schema", "name": "narration", "strict": True, "schema": VISION_SCHEMA}},
            }
            data = await self._json_request(f"{self.settings.openai_api_base}/responses", key, payload, "OpenAI")
            if data.get("status") != "completed":
                raise ProviderError("GPT未完成本次生成，请检查模型、输出限制或图片。")
            blocks = [block for item in data.get("output", []) if isinstance(item, dict) and item.get("type") == "message"
                      and item.get("role") == "assistant" for block in item.get("content", []) if isinstance(block, dict)]
            if any(block.get("type") == "refusal" for block in blocks):
                raise ProviderError("GPT未能为本批次生成旁白，请更换画面后重试。")
            text = "".join(block.get("text", "") for block in blocks if block.get("type") == "output_text")
        else:
            # JSON mode guarantees syntax, so also send the application's field contract.
            format_contract = (
                "\n\nRequired JSON output schema:\n" + json.dumps(VISION_SCHEMA)
                + "\nInclude all three fields and no other fields. should_speak must be a JSON boolean."
                " observation and narration must be strings, never null, each at most 1000 characters."
                " If should_speak is true, both strings must be non-empty."
                " If should_speak is false, narration must be an empty string."
                " Return only the JSON object, without Markdown fences or explanations."
            )
            payload = {
                "model": self.settings.deepseek_vision_model,
                "messages": [{"role": "system", "content": prompt + format_contract}, {"role": "user", "content": content}],
                "response_format": {"type": "json_object"},
                "thinking": {"type": "disabled"}, "max_tokens": 1200,
            }
            data = await self._json_request(f"{self.settings.deepseek_api_base}/chat/completions", key, payload, "DeepSeek")
            choices = data.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise ProviderError("DeepSeek没有返回旁白内容。")
            choice = choices[0]
            if choice.get("finish_reason") != "stop":
                raise ProviderError("DeepSeek未完成旁白，请检查输出限制或图片。")
            text = choice.get("message", {}).get("content", "")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("视觉模型没有返回旁白内容，请检查模型、配额或图片。")
        return parse_vision_result(text, "OpenAI" if provider == "openai" else "DeepSeek", metadata.batch_id)

    async def synthesize(self, narration: str, language: str, style: dict) -> AudioResult:
        key = self.settings.openai_api_key
        if not key:
            raise ProviderError("OpenAI云端语音需要 OPENAI_API_KEY。", 503)
        payload = {
            "model": self.settings.openai_tts_model, "voice": self.settings.openai_tts_voice,
            "input": narration, "response_format": "pcm",
        }
        if not self.settings.openai_tts_model.startswith("tts-1"):
            payload["instructions"] = f"Read the supplied text exactly in {language}. {style['voice_direction']}"
        try:
            async with self.client.stream("POST", f"{self.settings.openai_api_base}/audio/speech", json=payload,
                                          headers={"Authorization": f"Bearer {key}"}, timeout=110) as response:
                check_status(response, "OpenAI语音服务")
                output = bytearray()
                async for chunk in response.aiter_bytes():
                    output.extend(chunk)
                    if len(output) > 8 * 1024 * 1024:
                        raise ProviderError("TTS音频超过大小限制。")
        except httpx.TimeoutException as exc:
            raise ProviderError("云端语音合成超时。", 504) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("无法连接云端语音服务。") from exc
        return pcm_to_wav(bytes(output))

    async def synthesize_elevenlabs(self, narration: str, language: str, character: str) -> AudioResult:
        key = self.settings.elevenlabs_api_key
        if not key:
            raise ProviderError("请先在 backend/.env 设置 ELEVENLABS_API_KEY，然后重启后端。", 503)
        voice_id = self.settings.elevenlabs_voice_for(character)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", voice_id):
            variable = f"ELEVENLABS_{character.upper()}_VOICE_ID"
            raise ProviderError(f"请先在 backend/.env 设置 {variable}，然后重启后端。", 503)
        payload = {"text": narration, "model_id": self.settings.elevenlabs_tts_model}
        if self.settings.elevenlabs_tts_model != "eleven_multilingual_v2":
            payload["language_code"] = language.split("-")[0]
        try:
            async with self.client.stream(
                "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                params={"output_format": "pcm_24000"}, json=payload,
                headers={"xi-api-key": key}, timeout=45,
            ) as response:
                # Never pass upstream bodies (which may echo private text) to the UI.
                if response.status_code == 402:
                    raise ProviderError("ElevenLabs 要求付费权限（payment_required），请检查账户套餐及该声音的 API 使用权限。", 402)
                if response.status_code == 404:
                    raise ProviderError("ElevenLabs 找不到所选声音，请检查 My Voices 和 Voice ID。")
                if response.status_code in {400, 403, 422}:
                    raise ProviderError("ElevenLabs 无法使用所选声音，请检查 My Voices、Voice ID、模型及账户套餐权限。")
                check_status(response, "ElevenLabs")
                content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type and not (content_type.startswith("audio/") or content_type == "application/octet-stream"):
                    raise ProviderError("ElevenLabs 返回了无效音频。")
                output = bytearray()
                async for chunk in response.aiter_bytes():
                    output.extend(chunk)
                    if len(output) > 24000 * 2 * 90:
                        raise ProviderError("TTS音频超过大小限制。")
        except httpx.TimeoutException as exc:
            raise ProviderError("ElevenLabs 响应超时，请稍后再试。", 504) from exc
        except httpx.HTTPError as exc:
            raise ProviderError("无法连接 ElevenLabs，请检查后端网络。") from exc
        return pcm_to_wav(bytes(output))
