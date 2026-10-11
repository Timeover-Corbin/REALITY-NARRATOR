import type { BatchRequest, CharacterId, Frame, Health, NarrationResponse, RuntimeConfig, Style, VoicePreviewResponse } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function jsonRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new ApiError('无法连接后端服务', response.status);
  return response.json() as Promise<T>;
}

export const fetchHealth = () => jsonRequest<Health>('/api/health');
export const fetchConfig = () => jsonRequest<{ defaults: RuntimeConfig; styles: Style[] }>('/api/config');

export async function requestVoicePreview(character: CharacterId, language: RuntimeConfig['narration']['language'], signal: AbortSignal): Promise<VoicePreviewResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 50000);
  try {
    const response = await fetch('/api/voices/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character, language }), signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(typeof payload.detail === 'string' ? payload.detail : `请求失败（HTTP ${response.status}）`, response.status);
    }
    const result = await response.json() as VoicePreviewResponse;
    if (result.character !== character || result.audio_source !== 'elevenlabs' || typeof result.narration !== 'string'
      || typeof result.audio_base64 !== 'string' || !result.audio_base64 || result.audio_mime_type !== 'audio/wav') {
      throw new ApiError('声音试听返回了无效音频', 502);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new ApiError('声音试听请求超时', 504);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function requestNarration(metadata: BatchRequest, frames: Frame[], signal: AbortSignal): Promise<NarrationResponse> {
  const body = new FormData();
  body.append('metadata', JSON.stringify(metadata));
  frames.forEach((frame, index) => body.append('frames', frame.blob, `frame_${index}.jpg`));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, metadata.config.loop.request_timeout_seconds * 1000);
  try {
    const response = await fetch('/api/narrate', { method: 'POST', body, signal: controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(typeof payload.detail === 'string' ? payload.detail : `请求失败（HTTP ${response.status}）`, response.status);
    }
    const result = await response.json() as NarrationResponse;
    if (result.batch_id !== metadata.batch_id || result.mode !== metadata.mode || typeof result.narration !== 'string' || typeof result.should_speak !== 'boolean') throw new ApiError('后端返回了无效或不匹配的批次', 502);
    return result;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new ApiError('本批次处理超时，请减少图片数量或更换模型', 504);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
