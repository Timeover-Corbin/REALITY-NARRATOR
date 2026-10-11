import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestVoicePreview } from './api';
import { cloneConfig, DEFAULT_CONFIG, loadSavedConfig, validateConfig } from './config';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('character preferences', () => {
  it('migrates saved preferences without discarding camera, language or volume choices', () => {
    const saved = cloneConfig(DEFAULT_CONFIG);
    saved.capture.frame_count = 6;
    saved.narration.language = 'zh-CN';
    saved.audio.volume = 0.35;
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.narration.character;
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) });
    const migrated = loadSavedConfig();
    expect(migrated.narration.character).toBe('grandma');
    expect(migrated.narration.language).toBe('zh-CN');
    expect(migrated.capture.frame_count).toBe(6);
    expect(migrated.audio.volume).toBe(0.35);
  });
  it('rejects unknown characters', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    Object.assign(config.narration, { character: 'unknown' });
    expect(validateConfig(config)).toContain('不支持的旁白角色');
  });
});

describe('ElevenLabs preview', () => {
  const sample = { character: 'skeptic', narration: 'You with the mug.', audio_base64: 'UklGRg==', audio_mime_type: 'audio/wav', audio_source: 'elevenlabs' };
  it('sends only the selected character and language to the local backend', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(sample)));
    vi.stubGlobal('fetch', fetch);
    expect(await requestVoicePreview('skeptic', 'en-US', new AbortController().signal)).toEqual(sample);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/voices/preview');
    expect(JSON.parse(options.body as string)).toEqual({ character: 'skeptic', language: 'en-US' });
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });
  it('rejects mismatched voices instead of playing an unexpected preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...sample, character: 'grandma' }))));
    await expect(requestVoicePreview('skeptic', 'en-US', new AbortController().signal)).rejects.toThrow('无效音频');
  });
  it('reports account errors without substituting browser speech', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Voice access denied' }), { status: 502 })));
    await expect(requestVoicePreview('skeptic', 'en-US', new AbortController().signal)).rejects.toThrow('Voice access denied');
  });
  it('cancels an in-flight preview when stopped', async () => {
    let requestSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      requestSignal = options.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    })));
    const controller = new AbortController();
    const request = requestVoicePreview('skeptic', 'en-US', controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(requestSignal.aborted).toBe(true);
  });
  it('times out a stalled preview', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const rejected = expect(requestVoicePreview('grandma', 'zh-CN', new AbortController().signal)).rejects.toThrow('声音试听请求超时');
    await vi.advanceTimersByTimeAsync(50000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
