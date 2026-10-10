import json

import httpx
import pytest

from app.main import create_app
from app.provider import AIProvider, ProviderError
from app.service import NarrationService
from app.settings import Settings
from fastapi.testclient import TestClient
from test_pipeline import config, jpeg, metadata, wav_bytes


VISION = {"should_speak": True, "observation": "a cup", "narration": "A very important cup."}


def vision_response(provider, content=None):
    text = json.dumps(VISION) if content is None else content
    if provider == "openai":
        return {"status": "completed", "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}]}
    return {"choices": [{"finish_reason": "stop", "message": {"content": text, "reasoning_content": "do not read this"}}]}


@pytest.mark.parametrize("provider", ["openai", "deepseek"])
async def test_provider_routes_key_and_chronological_images(config, provider):
    config["narration"]["provider"] = provider
    requests = []
    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.headers["authorization"] == f"Bearer {provider}-test-key"
        if provider == "openai":
            assert request.url.path == "/v1/responses"
            assert body["model"] == "gpt-4.1-mini"
            assert body["store"] is False
            assert body["text"]["format"]["schema"]["additionalProperties"] is False
            parts = body["input"][0]["content"]
            assert sum(part["type"] == "input_image" for part in parts) == 12
            assert parts[0]["text"] == "Frame 1, 0.00s"
            assert parts[-2]["text"] == "Frame 12, 5.50s"
        else:
            assert request.url.path == "/chat/completions"
            assert body["model"] == "deepseek-flash"
            assert body["response_format"] == {"type": "json_object"}
            assert body["thinking"] == {"type": "disabled"}
            prompt = body["messages"][0]["content"]
            assert '"required": ["should_speak", "observation", "narration"]' in prompt
            assert "never null" in prompt
            parts = body["messages"][1]["content"]
            assert sum(part["type"] == "image_url" for part in parts) == 12
            assert parts[0]["text"] == "Frame 1, 0.00s"
            assert parts[-2]["text"] == "Frame 12, 5.50s"
        return httpx.Response(200, json=vision_response(provider))
    settings = Settings(openai_api_key="openai-test-key", deepseek_api_key="deepseek-test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await AIProvider(settings, client).describe([jpeg()] * 12, metadata(config), "Return JSON")
    assert result.narration == VISION["narration"]
    assert len(requests) == 1


async def test_deepseek_can_use_openai_speech_with_separate_keys(config):
    config["narration"]["provider"] = "deepseek"
    config["audio"]["provider"] = "openai"
    def handler(request):
        body = json.loads(request.content)
        if request.url.host == "api.deepseek.com":
            assert request.headers["authorization"] == "Bearer deepseek-test-key"
            return httpx.Response(200, json=vision_response("deepseek"))
        assert request.url.path == "/v1/audio/speech"
        assert request.headers["authorization"] == "Bearer openai-test-key"
        assert body["input"] == VISION["narration"]
        assert body["response_format"] == "pcm"
        assert "instructions" in body
        return httpx.Response(200, content=b"\x00\x00" * 240)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = NarrationService(AIProvider(Settings(openai_api_key="openai-test-key", deepseek_api_key="deepseek-test-key"), client))
        result = await service.run([jpeg()] * 12, metadata(config))
    assert result["vision_provider"] == "deepseek"
    assert result["audio_source"] == "openai"
    assert result["warning"] is None


async def test_deepseek_only_key_can_narrate_with_browser_speech(config):
    config["narration"]["provider"] = "deepseek"
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.host == "api.deepseek.com"
        return httpx.Response(200, json=vision_response("deepseek"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await NarrationService(AIProvider(Settings(deepseek_api_key="test-key"), client)).run([jpeg()] * 12, metadata(config))
    assert result["audio_source"] == "browser"
    assert result["warning"] is None
    assert len(calls) == 1


async def test_cloud_speech_missing_key_keeps_deepseek_observation(config):
    config["narration"]["provider"] = "deepseek"
    config["audio"]["provider"] = "openai"
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response("deepseek")))) as client:
        result = await NarrationService(AIProvider(Settings(deepseek_api_key="test-key"), client)).run([jpeg()] * 12, metadata(config))
    assert result["audio_source"] == "browser"
    assert result["observation"] == "a cup"
    assert "OPENAI_API_KEY" in result["warning"]


@pytest.mark.parametrize("provider", ["openai", "deepseek"])
@pytest.mark.parametrize("content", ["not JSON", '{"should_speak":true}', ""])
async def test_malformed_vision_output_is_reported(config, provider, content):
    config["narration"]["provider"] = provider
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response(provider, content)))) as client:
        with pytest.raises(ProviderError):
            await AIProvider(Settings(openai_api_key="test-key", deepseek_api_key="test-key"), client).describe([jpeg()] * 12, metadata(config), "Return JSON")


@pytest.mark.parametrize("provider", ["openai", "deepseek"])
@pytest.mark.parametrize("wrap", [
    lambda text: f"```json\n{text}\n```",
    lambda text: f"```\n{text}\n```",
    lambda text: "\ufeff " + text,
], ids=["json-fence", "plain-fence", "bom"])
async def test_vision_json_wrappers_preserve_narration(config, provider, wrap):
    config["narration"]["provider"] = provider
    content = wrap(json.dumps(VISION))
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response(provider, content)))) as client:
        result = await AIProvider(Settings(openai_api_key="test-key", deepseek_api_key="test-key"), client).describe([jpeg()] * 12, metadata(config), "Return JSON")
    assert result.model_dump() == VISION


@pytest.mark.parametrize("provider", ["openai", "deepseek"])
async def test_explicit_silence_accepts_null_narration(config, provider):
    config["narration"]["provider"] = provider
    content = json.dumps({"should_speak": False, "observation": "No clear action.", "narration": None})
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response(provider, content)))) as client:
        result = await AIProvider(Settings(openai_api_key="test-key", deepseek_api_key="test-key"), client).describe([jpeg()] * 12, metadata(config), "Return JSON")
    assert not result.should_speak
    assert result.narration == ""
    assert result.observation == "No clear action."


@pytest.mark.parametrize("content,reason", [
    ('{"should_speak":true}', "缺少字段 observation"),
    (json.dumps({**VISION, "narration": None}), "narration 必须是字符串"),
    (json.dumps({**VISION, "observation": {"private-field": "private-scene"}}), "observation 必须是字符串"),
    (json.dumps({**VISION, "should_speak": "maybe"}), "should_speak 必须是布尔值"),
    (json.dumps({**VISION, "narration": ""}), "都不能为空"),
    (json.dumps({**VISION, "observation": "private-scene" * 100}), "observation 超过1000个字符"),
    (json.dumps({**VISION, "private-field": "private-scene"}), "包含约定之外的字段"),
    ('["private-scene"]', "JSON顶层必须是对象"),
    ("private-scene " + json.dumps(VISION), "不是有效JSON"),
    (json.dumps(VISION) + json.dumps(VISION), "不是有效JSON"),
    ('{"should_speak":false,"observation":"private-scene"}', "缺少字段 narration"),
])
async def test_deepseek_reports_safe_specific_format_errors(config, content, reason, caplog):
    config["narration"]["provider"] = "deepseek"
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response("deepseek", content)))) as client:
        with pytest.raises(ProviderError) as error:
            await AIProvider(Settings(deepseek_api_key="test-key"), client).describe([jpeg()] * 12, metadata(config), "Return JSON")
    assert "DeepSeek" in str(error.value)
    assert reason in str(error.value)
    assert reason in caplog.text
    for private in ["private-field", "private-scene", "test-key"]:
        assert private not in str(error.value)
        assert private not in caplog.text


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_upstream_errors_do_not_expose_private_payload(config, status):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status, text="secret private payload"))) as client:
        with pytest.raises(ProviderError) as error:
            await AIProvider(Settings(openai_api_key="test-key"), client).describe([jpeg()] * 12, metadata(config), "Return JSON")
    assert "secret" not in str(error.value)
    assert error.value.status_code == (429 if status == 429 else 502)


def test_missing_selected_key_cannot_use_other_provider_key(config):
    config["narration"]["provider"] = "deepseek"
    with TestClient(create_app(Settings(openai_api_key="other-test-key", deepseek_api_key=""))) as client:
        health = client.get("/api/health").json()
        assert health["providers"]["openai"]["configured"]
        assert not health["providers"]["deepseek"]["configured"]
        response = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(12)])
        assert response.status_code == 503
        assert "DEEPSEEK_API_KEY" in response.json()["detail"]


async def test_deepseek_format_diagnostic_reaches_http_client(config):
    config["narration"]["provider"] = "deepseek"
    content = json.dumps({**VISION, "narration": None})
    settings = Settings(deepseek_api_key="test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=vision_response("deepseek", content)))) as upstream:
        service = NarrationService(AIProvider(settings, upstream))
        with TestClient(create_app(settings, service)) as client:
            response = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(12)])
    assert response.status_code == 502
    assert "DeepSeek" in response.json()["detail"]
    assert "narration 必须是字符串" in response.json()["detail"]


async def test_text_is_truncated_before_tts(config):
    config["audio"]["provider"] = "openai"
    config["narration"]["max_characters"] = 20
    from app.models import VisionResult
    from app.provider import AudioResult
    class Provider:
        async def describe(self, images, batch, prompt):
            return VisionResult(should_speak=True, observation="cup", narration="x" * 50)
        async def synthesize(self, text, language, style):
            assert len(text) == 20
            assert text.endswith("…")
            return AudioResult(wav_bytes())
    result = await NarrationService(Provider()).run([jpeg()] * 12, metadata(config))
    assert len(result["narration"]) == 20
