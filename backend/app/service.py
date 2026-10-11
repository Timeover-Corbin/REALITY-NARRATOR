import asyncio
import base64
import hashlib
import time

from .models import BatchMetadata, VisionResult, VoicePreviewRequest
from .prompts import build_prompt, choose_style, load_character
from .provider import ProviderError

DEMO_LINES = {
    "grandma": {
        "zh-CN": "这椅子挪来挪去，工作量倒是先达标了。坐它的人还没开工。",
        "en-US": "That poor chair keeps getting relocated. Lovely to see something in this room making a career move.",
    },
    "skeptic": {
        "zh-CN": "椅子又挪了。不得了，看来不是椅子放错，是整间房子盖偏了。",
        "en-US": "The chair moves again. Incredible. Apparently the problem isn't the chair. They built the room in the wrong place.",
    },
}


class NarrationService:
    def __init__(self, provider):
        self.provider = provider

    async def preview_voice(self, request: VoicePreviewRequest) -> dict:
        character = load_character(request.character)
        text = character["preview"][request.language]
        audio = await self.provider.synthesize_elevenlabs(text, request.language, request.character)
        return {"character": request.character, "narration": text,
                "audio_base64": base64.b64encode(audio.data).decode(),
                "audio_mime_type": audio.mime_type, "audio_source": "elevenlabs"}

    async def run(self, images: list[bytes], metadata: BatchMetadata) -> dict:
        started = time.perf_counter()
        style = choose_style(metadata)
        character = load_character(metadata.config.narration.character)
        audio = None
        warning = None
        vision_ms = tts_ms = 0
        if metadata.mode == "demo":
            language = metadata.config.narration.language
            lines = [character["preview"][language], DEMO_LINES[character["id"]][language]]
            index = int(hashlib.sha256(metadata.batch_id.encode()).hexdigest(), 16) % len(lines)
            choices = [line for line in lines if line not in metadata.recent_narrations] or lines
            result = VisionResult(should_speak=True, observation="演示示例：未识别上传的画面。", narration=choices[index % len(choices)])
            warning = "演示模式：使用预设示例文案和浏览器语音，没有进行图像识别。"
        else:
            result = await self.provider.describe(images, metadata, build_prompt(metadata, style))
            vision_ms = round((time.perf_counter() - started) * 1000)
            limit = metadata.config.narration.max_characters
            if len(result.narration) > limit:
                result.narration = result.narration[:limit - 1].rstrip() + "…"
            if result.should_speak and metadata.config.audio.provider in {"openai", "elevenlabs"}:
                tts_started = time.perf_counter()
                try:
                    remaining = metadata.config.loop.request_timeout_seconds - (tts_started - started) - 1
                    if remaining <= 0:
                        raise ProviderError("语音合成的时间预算不足。")
                    if metadata.config.audio.provider == "elevenlabs":
                        synthesis = self.provider.synthesize_elevenlabs(
                            result.narration, metadata.config.narration.language, character["id"])
                    else:
                        direction = {**style, "voice_direction": character["voice_direction"] + " " + style["voice_direction"]}
                        synthesis = self.provider.synthesize(result.narration, metadata.config.narration.language, direction)
                    audio = await asyncio.wait_for(synthesis, timeout=remaining)
                except TimeoutError:
                    warning = "云端语音合成超时，将尝试浏览器语音。"
                except ProviderError as exc:
                    warning = f"{exc} 将尝试浏览器语音。"
                tts_ms = round((time.perf_counter() - tts_started) * 1000)
        limit = metadata.config.narration.max_characters
        if len(result.narration) > limit:
            result.narration = result.narration[:limit - 1].rstrip() + "…"
        return {
            "batch_id": metadata.batch_id,
            "mode": metadata.mode,
            "vision_provider": metadata.config.narration.provider if metadata.mode == "live" else None,
            "style": {key: style[key] for key in ["id", "label"]},
            "character": character["id"],
            **result.model_dump(),
            "audio_base64": base64.b64encode(audio.data).decode() if audio else None,
            "audio_mime_type": audio.mime_type if audio else None,
            "audio_source": metadata.config.audio.provider if audio else ("browser" if result.should_speak else "none"),
            "warning": warning,
            "timings": {"vision_ms": vision_ms, "tts_ms": tts_ms, "total_ms": round((time.perf_counter() - started) * 1000)},
        }
