import asyncio
import base64
import io
import json
import wave

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.models import VoicePreviewRequest
from app.prompts import build_prompt, choose_style, load_character
from app.provider import AIProvider, ProviderError
from app.service import NarrationService
from app.settings import Settings
from test_pipeline import config, jpeg, metadata
from test_providers import vision_response


def settings(**overrides):
    values = dict(elevenlabs_api_key="eleven-test-secret", elevenlabs_grandma_voice_id="grandma-test-id",
                  elevenlabs_skeptic_voice_id="skeptic-test-id")
    return Settings(**(values | overrides))


@pytest.mark.parametrize("character", ["grandma", "skeptic"])
@pytest.mark.parametrize("language,code", [("en-US", "en"), ("zh-CN", "zh")])
@pytest.mark.parametrize("vision", ["openai", "deepseek"])
async def test_vision_text_goes_to_selected_voice_with_its_own_key(config, character, language, code, vision):
    config["narration"].update(provider=vision, character=character, language=language)
    config["audio"]["provider"] = "elevenlabs"
    calls = []

    def handler(request):
        calls.append(request)
        body = json.loads(request.content)
        if request.url.host != "api.elevenlabs.io":
            assert request.headers["authorization"] == f"Bearer {vision}-test-secret"
            assert "xi-api-key" not in request.headers
            return httpx.Response(200, json=vision_response(vision))
        assert request.url.path == f"/v1/text-to-speech/{character}-test-id"
        assert request.url.params["output_format"] == "pcm_24000"
        assert request.headers["xi-api-key"] == "eleven-test-secret"
        assert "authorization" not in request.headers
        assert body == {"text": "A very important cup.", "model_id": "eleven_flash_v2_5", "language_code": code}
        return httpx.Response(200, content=b"\x01\x00" * 240, headers={"content-type": "audio/pcm"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = NarrationService(AIProvider(settings(openai_api_key="openai-test-secret", deepseek_api_key="deepseek-test-secret"), client))
        result = await service.run([jpeg()] * 12, metadata(config))
    assert len(calls) == 2
    assert result["character"] == character
    assert result["vision_provider"] == vision
    assert result["audio_source"] == "elevenlabs"
    assert result["audio_mime_type"] == "audio/wav"
    assert result["warning"] is None
    with wave.open(io.BytesIO(base64.b64decode(result["audio_base64"])), "rb") as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (24000, 1, 2)
        assert audio.readframes(240) == b"\x01\x00" * 240


@pytest.mark.parametrize("overrides,variable", [
    ({"elevenlabs_api_key": ""}, "ELEVENLABS_API_KEY"),
    ({"elevenlabs_grandma_voice_id": ""}, "ELEVENLABS_GRANDMA_VOICE_ID"),
    ({"elevenlabs_grandma_voice_id": "../private?key=x"}, "ELEVENLABS_GRANDMA_VOICE_ID"),
])
async def test_missing_or_invalid_local_config_makes_no_upstream_request(overrides, variable):
    def handler(request):
        pytest.fail("Invalid local configuration must not call ElevenLabs")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError, match=variable) as error:
            await AIProvider(settings(**overrides), client).synthesize_elevenlabs("Hello", "en-US", "grandma")
    assert error.value.status_code == 503


@pytest.mark.parametrize("status", [401, 402, 403, 404, 422, 429, 500])
async def test_upstream_errors_are_safe_and_do_not_echo_private_data(status):
    def handler(request):
        return httpx.Response(status, json={"detail": "private-scene eleven-test-secret"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError) as error:
            await AIProvider(settings(), client).synthesize_elevenlabs("private-scene", "en-US", "grandma")
    assert "private-scene" not in str(error.value)
    assert "eleven-test-secret" not in str(error.value)
    assert error.value.status_code == (status if status in {402, 429} else 502)


@pytest.mark.parametrize("data,content_type", [
    (b"", "audio/pcm"), (b"x", "audio/pcm"), (b'{}', "application/json"),
    (b"error!", "text/plain"), (b"\x00" * (24000 * 2 * 90 + 2), "audio/pcm"),
], ids=["empty", "truncated-pcm", "json", "text", "oversized"])
async def test_invalid_or_oversize_audio_is_not_playable(data, content_type):
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=data, headers={"content-type": content_type})
    )) as client:
        with pytest.raises(ProviderError):
            await AIProvider(settings(), client).synthesize_elevenlabs("Hello", "en-US", "skeptic")


async def test_multilingual_v2_omits_unsupported_language_parameter():
    def handler(request):
        assert "language_code" not in json.loads(request.content)
        return httpx.Response(200, content=b"\x00\x00" * 240)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await AIProvider(settings(elevenlabs_tts_model="eleven_multilingual_v2"), client).synthesize_elevenlabs("Hello", "en-US", "grandma")


async def test_cancellation_reaches_the_inflight_tts_request():
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def handler(request):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        work = asyncio.create_task(AIProvider(settings(), client).synthesize_elevenlabs("Hello", "en-US", "grandma"))
        await asyncio.wait_for(entered.wait(), 1)
        work.cancel()
        with pytest.raises(asyncio.CancelledError):
            await work
    assert cancelled.is_set()


async def test_tts_failure_preserves_real_vision_text_and_reports_browser_fallback(config):
    config["audio"]["provider"] = "elevenlabs"
    def handler(request):
        if request.url.host == "api.elevenlabs.io":
            return httpx.Response(403, text="private account response")
        return httpx.Response(200, json=vision_response("openai"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await NarrationService(AIProvider(settings(openai_api_key="vision-test-key"), client)).run([jpeg()] * 12, metadata(config))
    assert result["mode"] == "live"
    assert result["observation"] == "a cup"
    assert result["narration"] == "A very important cup."
    assert result["audio_base64"] is None
    assert result["audio_source"] == "browser"
    assert "ElevenLabs" in result["warning"] and "浏览器" in result["warning"]


async def test_silence_never_calls_elevenlabs(config):
    config["audio"]["provider"] = "elevenlabs"
    def handler(request):
        assert request.url.host != "api.elevenlabs.io"
        return httpx.Response(200, json=vision_response("openai", json.dumps({"should_speak": False, "observation": "No new action.", "narration": ""})))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await NarrationService(AIProvider(settings(openai_api_key="vision-test-key"), client)).run([jpeg()] * 12, metadata(config))
    assert result["audio_source"] == "none"


@pytest.mark.parametrize("character", ["grandma", "skeptic"])
async def test_demo_is_still_free_and_explicit_with_a_selected_character(config, character):
    config["audio"]["provider"] = "elevenlabs"
    config["narration"].update(character=character, language="en-US")
    result = await NarrationService(None).run([jpeg()] * 12, metadata(config, mode="demo"))
    assert result["character"] == character
    assert result["narration"]
    assert result["audio_source"] == "browser"
    assert "演示模式" in result["warning"]


@pytest.mark.parametrize("character", ["grandma", "skeptic"])
@pytest.mark.parametrize("language", ["en-US", "zh-CN"])
def test_preview_endpoint_uses_fixed_text_without_vision_credentials(character, language):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.host == "api.elevenlabs.io"
        assert json.loads(request.content)["text"] == load_character(character)["preview"][language]
        return httpx.Response(200, content=b"\x01\x00" * 240)
    with TestClient(create_app(settings(), NarrationService(AIProvider(settings(), httpx.AsyncClient(transport=httpx.MockTransport(handler)))))) as client:
        response = client.post("/api/voices/preview", json={"character": character, "language": language})
    assert response.status_code == 200
    assert response.json()["audio_source"] == "elevenlabs"
    assert response.json()["character"] == character
    assert response.json()["audio_base64"]
    assert len(calls) == 1


def test_preview_does_not_fall_back_to_a_different_voice_when_key_is_missing():
    with TestClient(create_app(Settings())) as client:
        response = client.post("/api/voices/preview", json={"character": "grandma"})
    assert response.status_code == 503
    assert "ELEVENLABS_API_KEY" in response.json()["detail"]
    assert "audio_base64" not in response.json()


@pytest.mark.parametrize("payload", [{"character": "unknown"}, {"character": "grandma", "text": "custom"}, {"character": "grandma", "voice_id": "unapproved"}])
def test_preview_rejects_unknown_characters_and_arbitrary_inputs(payload):
    with pytest.raises(ValidationError):
        VoicePreviewRequest.model_validate(payload)


def test_health_reports_local_readiness_without_returning_keys():
    with TestClient(create_app(settings(openai_api_key="vision-secret", deepseek_api_key="deepseek-secret"))) as client:
        health = client.get("/api/health")
        public = health.text + client.get("/api/config").text
    assert health.json()["elevenlabs"]["voices"]["grandma"]["configured"]
    for secret in ("eleven-test-secret", "vision-secret", "deepseek-secret"):
        assert secret not in public


def test_prompt_receives_character_language_limits_and_recent_context_once(config):
    config["narration"].update(character="skeptic", language="zh-CN", max_characters=100)
    config["loop"]["history_size"] = 1
    batch = metadata(config, recent_narrations=["older line", "You in red: ${language}"])
    prompt = build_prompt(batch, choose_style(batch))
    assert load_character("skeptic")["instruction"] in prompt
    assert "Simplified Chinese" in prompt and "100 个字符" in prompt
    assert "older line" not in prompt
    assert "You in red: ${language}" in prompt
    assert "${character_instruction}" not in prompt


def test_zero_history_excludes_previous_lines(config):
    config["loop"]["history_size"] = 0
    batch = metadata(config, recent_narrations=["private previous line"])
    assert "private previous line" not in build_prompt(batch, choose_style(batch))
