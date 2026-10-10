import json
import secrets
from pathlib import Path

from .models import BatchMetadata

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"


def load_styles() -> list[dict]:
    return json.loads((PROMPT_DIR / "styles.json").read_text(encoding="utf-8"))


def choose_style(metadata: BatchMetadata) -> dict:
    styles = {style["id"]: style for style in load_styles()}
    config = metadata.config.narration
    if config.style_mode == "fixed":
        return styles[config.fixed_style]
    pool = list(dict.fromkeys(config.style_pool))
    last = metadata.recent_styles[-1] if metadata.recent_styles else None
    choices = [name for name in pool if name != last] or pool
    return styles[secrets.choice(choices)]


def build_prompt(metadata: BatchMetadata, style: dict) -> str:
    # Read on every request: editing this file does not require a restart.
    template = (PROMPT_DIR / "base.md").read_text(encoding="utf-8")
    history_size = metadata.config.loop.history_size
    recent = metadata.recent_narrations[-history_size:] if history_size else []
    values = {
        "style_instruction": style["instruction"],
        "language": "Simplified Chinese" if metadata.config.narration.language == "zh-CN" else "English",
        "max_characters": metadata.config.narration.max_characters,
        "recent_narrations": json.dumps(recent, ensure_ascii=False),
    }
    for key, value in values.items():
        template = template.replace("${" + key + "}", str(value))
    return template
