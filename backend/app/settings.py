"""Server-only API credentials and model names."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
load_dotenv(BACKEND / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    openai_api_base: str = "https://api.openai.com/v1"
    deepseek_api_base: str = "https://api.deepseek.com"
    openai_vision_model: str = "gpt-4.1-mini"
    deepseek_vision_model: str = "deepseek-flash"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "onyx"
    elevenlabs_api_key: str = ""
    elevenlabs_tts_model: str = "eleven_flash_v2_5"
    elevenlabs_grandma_voice_id: str = ""
    elevenlabs_skeptic_voice_id: str = ""
    allow_demo: bool = True
    max_concurrent_requests: int = 2
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    def key_for(self, provider: str) -> str:
        return self.openai_api_key if provider == "openai" else self.deepseek_api_key

    def model_for(self, provider: str) -> str:
        return self.openai_vision_model if provider == "openai" else self.deepseek_vision_model

    def elevenlabs_voice_for(self, character: str) -> str:
        return {"grandma": self.elevenlabs_grandma_voice_id,
                "skeptic": self.elevenlabs_skeptic_voice_id}[character]

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
            deepseek_api_key=os.getenv("DEEPSEEK_API_KEY", "").strip(),
            openai_api_base=os.getenv("OPENAI_API_BASE", cls.openai_api_base).rstrip("/"),
            deepseek_api_base=os.getenv("DEEPSEEK_API_BASE", cls.deepseek_api_base).rstrip("/"),
            openai_vision_model=os.getenv("OPENAI_VISION_MODEL", cls.openai_vision_model),
            deepseek_vision_model=os.getenv("DEEPSEEK_VISION_MODEL", cls.deepseek_vision_model),
            openai_tts_model=os.getenv("OPENAI_TTS_MODEL", cls.openai_tts_model),
            openai_tts_voice=os.getenv("OPENAI_TTS_VOICE", cls.openai_tts_voice),
            elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY", "").strip(),
            elevenlabs_tts_model=os.getenv("ELEVENLABS_TTS_MODEL", cls.elevenlabs_tts_model).strip(),
            elevenlabs_grandma_voice_id=os.getenv("ELEVENLABS_GRANDMA_VOICE_ID", "").strip(),
            elevenlabs_skeptic_voice_id=os.getenv("ELEVENLABS_SKEPTIC_VOICE_ID", "").strip(),
            allow_demo=os.getenv("ALLOW_DEMO", "true").lower() in {"1", "true", "yes"},
            max_concurrent_requests=max(1, min(8, int(os.getenv("MAX_CONCURRENT_REQUESTS", "2")))),
            cors_origins=tuple(x.strip() for x in os.getenv("CORS_ORIGINS", ",".join(cls.cors_origins)).split(",") if x.strip()),
        )
