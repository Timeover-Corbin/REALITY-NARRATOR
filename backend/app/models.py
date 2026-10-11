from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

StyleId = Literal["deadpan", "documentary", "bureaucratic", "epic", "unreliable"]
CharacterId = Literal["grandma", "skeptic"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CaptureConfig(StrictModel):
    frame_count: int = Field(ge=6, le=18)
    sample_fps: float = Field(ge=0.5, le=10)
    window_seconds: float = Field(ge=2, le=30)
    image_width: int = Field(ge=320, le=1280)
    jpeg_quality: float = Field(ge=0.2, le=0.95)
    max_buffer_mb: int = Field(ge=4, le=128)
    max_frame_gap_seconds: float = Field(ge=0.5, le=10)

    @model_validator(mode="after")
    def ensure_feasible_sampling(self):
        if self.sample_fps * self.window_seconds < self.frame_count:
            raise ValueError("观察窗口×截图频率必须至少等于上传图片数量")
        return self


class LoopConfig(StrictModel):
    cooldown_seconds: float = Field(ge=0, le=30)
    request_timeout_seconds: float = Field(ge=10, le=120)
    max_result_age_seconds: float = Field(ge=5, le=180)
    history_size: int = Field(ge=0, le=10)
    max_consecutive_errors: int = Field(ge=1, le=10)


class NarrationConfig(StrictModel):
    provider: Literal["openai", "deepseek"] = "openai"
    character: CharacterId = "grandma"
    language: Literal["zh-CN", "en-US"]
    style_mode: Literal["random", "fixed"]
    fixed_style: StyleId
    style_pool: list[StyleId] = Field(min_length=1, max_length=5)
    max_characters: int = Field(ge=20, le=240)


class AudioConfig(StrictModel):
    provider: Literal["browser", "openai", "elevenlabs"] = "browser"
    browser_voice_uri: str = Field(default="", max_length=500)
    volume: float = Field(ge=0, le=1)
    speech_rate: float = Field(ge=0.6, le=1.5)


class RuntimeConfig(StrictModel):
    capture: CaptureConfig
    loop: LoopConfig
    narration: NarrationConfig
    audio: AudioConfig


class VoicePreviewRequest(StrictModel):
    character: CharacterId
    language: Literal["zh-CN", "en-US"] = "en-US"


class BatchMetadata(StrictModel):
    batch_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    mode: Literal["live", "demo"] = "live"
    config: RuntimeConfig
    frame_timestamps_ms: list[float] = Field(min_length=6, max_length=18)
    recent_narrations: list[str] = Field(default_factory=list, max_length=10)
    recent_styles: list[StyleId] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_batch(self):
        times = self.frame_timestamps_ms
        if len(times) != self.config.capture.frame_count:
            raise ValueError("图片时间戳数量与 frame_count 不一致")
        if any(t < 0 for t in times) or any(a >= b for a, b in zip(times, times[1:])):
            raise ValueError("图片时间戳必须非负且严格递增")
        if times[-1] - times[0] > self.config.capture.window_seconds * 1000 + 1000:
            raise ValueError("图片超出配置的观察时间范围")
        if any(len(line) > 500 for line in self.recent_narrations):
            raise ValueError("历史旁白过长")
        return self


class VisionResult(StrictModel):
    should_speak: bool
    observation: str = Field(max_length=1000)
    narration: str = Field(max_length=1000)

    @model_validator(mode="after")
    def validate_speech(self):
        self.observation = self.observation.strip()
        self.narration = self.narration.strip()
        if self.should_speak and (not self.observation or not self.narration):
            raise ValueError("播报结果缺少观察或旁白")
        return self
