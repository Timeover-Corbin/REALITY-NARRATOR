import asyncio
import base64
import hashlib
import time

from .models import BatchMetadata, VisionResult
from .prompts import build_prompt, choose_style
from .provider import ProviderError

DEMO_LINES = {
    "zh-CN": {
        "deadpan": ["他决定做点什么。这个决定目前还停留在决定阶段。", "他以为自己掌握了节奏。旁白决定暂时不纠正他。"],
        "documentary": ["这位人类正在进行一种罕见的仪式：等待事情自己变好。", "在这片栖息地里，忙碌的姿态有时比忙碌本身更加重要。"],
        "bureaucratic": ["本次行动已顺利完成准备工作的前期准备，进展显著。", "经初步评估，这项微小进展值得召开一次不小的总结会议。"],
        "epic": ["命运的齿轮终于转动了。虽然只转了半格，但气氛已经到位。", "漫长的征程即将开始。第一步，是继续考虑第一步。"],
        "unreliable": ["他显然正在实施一项宏伟计划。也可能只是忘了自己要干什么。", "一切都在他的掌控之中。至少他暂时没有提出异议。"],
    },
    "en-US": {
        "deadpan": ["He decided to do something. So far, the decision was doing most of the work.", "He believed he was in control. The narrator generously postponed the correction."],
        "documentary": ["Here we observe the human performing an ancient ritual: hoping things improve on their own.", "In this habitat, looking busy is sometimes the most exhausting activity."],
        "bureaucratic": ["Preparations for the preliminary preparations have been completed. Remarkable progress.", "This minor achievement clearly warrants a major meeting."],
        "epic": ["At last, the wheels of destiny turned. Half a notch. The atmosphere was excellent.", "The great journey was about to begin. First, another discussion about the first step."],
        "unreliable": ["Clearly, a grand plan was unfolding. Unless he had simply forgotten what he came here for.", "Everything was under control. At least, nobody had objected yet."],
    },
}


class NarrationService:
    def __init__(self, provider):
        self.provider = provider

    async def run(self, images: list[bytes], metadata: BatchMetadata) -> dict:
        started = time.perf_counter()
        style = choose_style(metadata)
        audio = None
        warning = None
        vision_ms = tts_ms = 0
        if metadata.mode == "demo":
            lines = DEMO_LINES[metadata.config.narration.language][style["id"]]
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
            if result.should_speak and metadata.config.audio.provider == "openai":
                tts_started = time.perf_counter()
                try:
                    remaining = metadata.config.loop.request_timeout_seconds - (tts_started - started) - 1
                    if remaining <= 0:
                        raise ProviderError("语音合成的时间预算不足。")
                    audio = await asyncio.wait_for(
                        self.provider.synthesize(result.narration, metadata.config.narration.language, style),
                        timeout=remaining,
                    )
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
            **result.model_dump(),
            "audio_base64": base64.b64encode(audio.data).decode() if audio else None,
            "audio_mime_type": audio.mime_type if audio else None,
            "audio_source": "openai" if audio else ("browser" if result.should_speak else "none"),
            "warning": warning,
            "timings": {"vision_ms": vision_ms, "tts_ms": tts_ms, "total_ms": round((time.perf_counter() - started) * 1000)},
        }
