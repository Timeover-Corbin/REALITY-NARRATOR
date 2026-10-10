import asyncio
import base64
import copy
import io
import json
import re
import wave

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.main import create_app, run_cancellable
from app.models import BatchMetadata, RuntimeConfig, VisionResult
from app.prompts import choose_style
from app.provider import AudioResult, ProviderError, pcm_to_wav, validate_wav
from app.service import NarrationService
from app.settings import ROOT, Settings


@pytest.fixture
def config():
    return json.loads((ROOT / "config/defaults.json").read_text())


def metadata(config, **updates):
    value = {"batch_id": "test_batch", "mode": "live", "config": config,
             "frame_timestamps_ms": [i * 5500 / (config["capture"]["frame_count"] - 1) for i in range(config["capture"]["frame_count"])]}
    value.update(updates)
    return BatchMetadata.model_validate(value)


def jpeg():
    output = io.BytesIO()
    Image.new("RGB", (640, 360), (120, 90, 70)).save(output, format="JPEG")
    return output.getvalue()


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
        wav.writeframes(b"\x00\x00" * 240)
    return output.getvalue()


class FakeProvider:
    def __init__(self, speak=True, fail_audio=False):
        self.speak = speak
        self.fail_audio = fail_audio
        self.audio_calls = 0

    async def describe(self, images, batch, prompt):
        assert len(images) == batch.config.capture.frame_count
        return VisionResult(should_speak=self.speak, observation="人拿起杯子。", narration="他拿起了杯子。事情终于有了一个盛水的方向。" if self.speak else "")

    async def synthesize(self, text, language, style):
        self.audio_calls += 1
        if self.fail_audio:
            raise ProviderError("TTS unavailable")
        return AudioResult(wav_bytes())


def test_hyperparameters_reject_impossible_sampling(config):
    config["capture"]["sample_fps"] = 1
    with pytest.raises(ValidationError):
        RuntimeConfig.model_validate(config)


@pytest.mark.parametrize("timestamps", [[0] * 12, list(reversed(range(12))), [float("nan")] * 12])
def test_reject_invalid_timestamps(config, timestamps):
    with pytest.raises(ValidationError):
        metadata(config, frame_timestamps_ms=timestamps)


def test_random_styles_do_not_immediately_repeat(config):
    for _ in range(15):
        batch = metadata(config, recent_styles=["deadpan"])
        assert choose_style(batch)["id"] != "deadpan"


async def test_pipeline_returns_real_audio_and_matching_id(config):
    config["audio"]["provider"] = "openai"
    provider = FakeProvider()
    result = await NarrationService(provider).run([jpeg()] * 12, metadata(config))
    assert result["batch_id"] == "test_batch"
    assert result["audio_source"] == "openai"
    assert base64.b64decode(result["audio_base64"]) == wav_bytes()
    assert provider.audio_calls == 1


async def test_silence_never_calls_tts(config):
    provider = FakeProvider(speak=False)
    result = await NarrationService(provider).run([jpeg()] * 12, metadata(config))
    assert not result["should_speak"]
    assert result["audio_base64"] is None
    assert provider.audio_calls == 0


async def test_tts_failure_keeps_grounded_text_and_labels_fallback(config):
    config["audio"]["provider"] = "openai"
    provider = FakeProvider(fail_audio=True)
    result = await NarrationService(provider).run([jpeg()] * 12, metadata(config))
    assert result["mode"] == "live"
    assert result["narration"]
    assert result["audio_source"] == "browser"
    assert result["warning"]


async def test_demo_is_explicitly_labelled(config):
    result = await NarrationService(None).run([jpeg()] * 12, metadata(config, mode="demo"))
    assert result["mode"] == "demo"
    assert "未识别" in result["observation"]
    assert "演示模式" in result["warning"]


def test_pcm_is_wrapped_in_valid_wav():
    pcm = b"\x01\x00\xff\x7f" * 100
    result = pcm_to_wav(pcm)
    with wave.open(io.BytesIO(result.data)) as wav:
        assert wav.getframerate() == 24000
        assert wav.getnchannels() == 1
        assert wav.readframes(200) == pcm


@pytest.mark.parametrize("data", [b"", b"invalid", b"RIFFbroken"])
def test_corrupt_audio_is_rejected(data):
    with pytest.raises(ProviderError):
        validate_wav(data)


async def test_browser_speech_never_calls_cloud_tts(config):
    provider = FakeProvider(fail_audio=True)
    result = await NarrationService(provider).run([jpeg()] * 12, metadata(config))
    assert result["audio_source"] == "browser"
    assert result["audio_base64"] is None
    assert result["warning"] is None
    assert provider.audio_calls == 0


def test_http_endpoint_validates_upload_and_returns_audio(config):
    config["audio"]["provider"] = "openai"
    service = NarrationService(FakeProvider())
    with TestClient(create_app(Settings(), service)) as client:
        response = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(12)])
        assert response.status_code == 200, response.text
        assert response.json()["audio_source"] == "openai"
        invalid = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", b"invalid", "image/jpeg")) for i in range(12)])
        assert invalid.status_code == 422


def test_missing_key_never_silently_uses_demo(config):
    with TestClient(create_app(Settings())) as client:
        response = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(12)])
        assert response.status_code == 503
        assert "OPENAI_API_KEY" in response.json()["detail"]


def test_public_config_contains_no_credentials():
    with TestClient(create_app(Settings(openai_api_key="test-only-secret", deepseek_api_key="deepseek-test-secret"))) as client:
        combined = client.get("/api/config").text + client.get("/api/health").text
        assert "test-only-secret" not in combined
        assert "deepseek-test-secret" not in combined


async def test_disconnect_cancels_inflight_work():
    cancelled = asyncio.Event()
    class Request:
        async def receive(self): return {"type": "http.disconnect"}
    async def work():
        try: await asyncio.sleep(30)
        finally: cancelled.set()
    with pytest.raises(Exception) as error:
        await run_cancellable(Request(), work(), 5)
    assert error.value.status_code == 499
    assert cancelled.is_set()


@pytest.mark.parametrize("count", [6, 18])
def test_frame_count_extremes_use_same_endpoint(config, count):
    config["capture"]["frame_count"] = count
    with TestClient(create_app(Settings(), NarrationService(FakeProvider()))) as client:
        response = client.post("/api/narrate", data={"metadata": metadata(config).model_dump_json()}, files=[("frames", (f"f{i}.jpg", jpeg(), "image/jpeg")) for i in range(count)])
        assert response.status_code == 200, response.text


def test_production_static_assets_and_api_coexist():
    if not (ROOT / "frontend/dist/index.html").exists():
        pytest.skip("Run npm run build first to verify the production static build")
    with TestClient(create_app(Settings())) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "Reality Narrator" in page.text
        assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', page.text)
        assert len(assets) >= 2
        for asset in assets:
            assert client.get(asset).status_code == 200
        assert client.get("/api/health").json()["status"] == "ok"


async def test_processing_timeout_cancels_work():
    cancelled = asyncio.Event()
    class Request:
        async def receive(self):
            await asyncio.sleep(30)
    async def work():
        try: await asyncio.sleep(30)
        finally: cancelled.set()
    with pytest.raises(Exception) as error:
        await run_cancellable(Request(), work(), 0.01)
    assert error.value.status_code == 504
    assert cancelled.is_set()
