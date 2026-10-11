import asyncio
import io
import json
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from .models import BatchMetadata, RuntimeConfig, VoicePreviewRequest
from .prompts import load_styles
from .provider import AIProvider, ProviderError
from .service import NarrationService
from .settings import ROOT, Settings

MAX_IMAGE_BYTES = 512 * 1024
MAX_BATCH_BYTES = 8 * 1024 * 1024


async def watch_disconnect(request: Request):
    while True:
        message = await request.receive()
        if message["type"] == "http.disconnect":
            return


async def run_cancellable(request: Request, awaitable, timeout: float,
                          timeout_message: str = "本批次处理超时，请减少图片数量或使用更快的模型。"):
    work = asyncio.create_task(awaitable)
    disconnected = asyncio.create_task(watch_disconnect(request))
    try:
        done, _ = await asyncio.wait({work, disconnected}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return await work
        if disconnected in done:
            raise HTTPException(499, "客户端已停止本次请求。")
        raise HTTPException(504, timeout_message)
    finally:
        for task in (work, disconnected):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, disconnected, return_exceptions=True)


def create_app(settings: Settings | None = None, service=None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient() as client:
            app.state.service = service or NarrationService(AIProvider(settings, client))
            yield

    app = FastAPI(title="Reality Narrator", version="1.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    slots = asyncio.Semaphore(settings.max_concurrent_requests)

    @app.get("/api/health")
    async def health():
        return {
            "status": "ok", "demo_available": settings.allow_demo,
            "providers": {provider: {"configured": bool(settings.key_for(provider)), "model": settings.model_for(provider)}
                          for provider in ("openai", "deepseek")},
            "tts": {"configured": bool(settings.openai_api_key), "model": settings.openai_tts_model,
                    "voice": settings.openai_tts_voice},
            "elevenlabs": {"configured": bool(settings.elevenlabs_api_key), "model": settings.elevenlabs_tts_model,
                           "voices": {character: {"configured": bool(settings.elevenlabs_voice_for(character))}
                                      for character in ("grandma", "skeptic")}},
        }

    @app.get("/api/config")
    async def config():
        defaults = RuntimeConfig.model_validate_json((ROOT / "config" / "defaults.json").read_text())
        styles = [{key: item[key] for key in ["id", "label", "description"]} for item in load_styles()]
        return {"defaults": defaults.model_dump(), "styles": styles}

    @app.post("/api/narrate")
    async def narrate(request: Request, metadata: str = Form(...), frames: list[UploadFile] = File(...)):
        try:
            if len(metadata) > 20000:
                raise HTTPException(413, "批次元数据过大。")
            try:
                batch = BatchMetadata.model_validate_json(metadata)
            except ValidationError as exc:
                raise HTTPException(422, "配置或批次元数据无效：" + "; ".join(error["msg"] for error in exc.errors())) from exc
            if len(frames) != batch.config.capture.frame_count:
                raise HTTPException(422, "实际图片数量与配置不一致。")
            if batch.mode == "demo" and not settings.allow_demo:
                raise HTTPException(403, "后端未启用演示模式。")
            selected = batch.config.narration.provider
            if batch.mode == "live" and not settings.key_for(selected) and service is None:
                raise HTTPException(503, f"请先在 backend/.env 设置 {selected.upper()}_API_KEY，然后重启后端。")
            images, total = [], 0
            for frame in frames:
                image = await frame.read(MAX_IMAGE_BYTES + 1)
                total += len(image)
                if len(image) > MAX_IMAGE_BYTES or total > MAX_BATCH_BYTES:
                    raise HTTPException(413, "图片超出大小限制，请降低分辨率或JPEG质量。")
                try:
                    with Image.open(io.BytesIO(image)) as decoded:
                        if decoded.format != "JPEG" or decoded.width > 2048 or decoded.height > 2048:
                            raise ValueError("Unsupported image")
                        decoded.verify()
                except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                    raise HTTPException(422, "图片必须是有效且尺寸不超过2048×2048的JPEG。") from exc
                images.append(image)
            acquired = False
            try:
                await asyncio.wait_for(slots.acquire(), timeout=0.5)
                acquired = True
                return await run_cancellable(request, app.state.service.run(images, batch), batch.config.loop.request_timeout_seconds)
            except TimeoutError as exc:
                raise HTTPException(429, "后端正在处理其他批次，请稍后重试。") from exc
            except ProviderError as exc:
                raise HTTPException(exc.status_code, str(exc)) from exc
            finally:
                if acquired:
                    slots.release()
        finally:
            for frame in frames:
                await frame.close()

    @app.post("/api/voices/preview")
    async def preview_voice(request: Request, payload: VoicePreviewRequest):
        # Fixed, short samples; share the narration concurrency limit and cancellation.
        acquired = False
        try:
            await asyncio.wait_for(slots.acquire(), timeout=0.5)
            acquired = True
            return await run_cancellable(request, app.state.service.preview_voice(payload), 45, "声音试听请求超时")
        except TimeoutError as exc:
            raise HTTPException(429, "后端正在处理其他批次，请稍后再试。") from exc
        except ProviderError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        finally:
            if acquired:
                slots.release()

    dist = ROOT / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
