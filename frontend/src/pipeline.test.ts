import { describe, expect, it, vi } from 'vitest';
import { FrameBuffer } from './buffer';
import { cloneConfig, DEFAULT_CONFIG, validateConfig } from './config';
import { NarratorEngine } from './engine';
import type { BatchRequest, NarrationResponse } from './types';

function populatedBuffer() {
  const config = cloneConfig(DEFAULT_CONFIG);
  const buffer = new FrameBuffer(config.capture);
  for (let timestamp = 0; timestamp <= 6000; timestamp += 250) buffer.push({ id: timestamp, capturedAtMs: timestamp, blob: new Blob(['jpeg']) });
  return { buffer, config };
}

const response = (batchId: string): NarrationResponse => ({
  batch_id: batchId, mode: 'live', vision_provider: 'openai', style: { id: 'deadpan', label: 'test' },
  should_speak: true, observation: 'cup', narration: 'a joke',
  audio_base64: null, audio_mime_type: null, audio_source: 'browser', warning: null,
  timings: { vision_ms: 1, tts_ms: 1, total_ms: 2 },
});

describe('observation windows', () => {
  it('uniformly selects unique frames across the whole configured window', () => {
    const { buffer } = populatedBuffer();
    const frames = buffer.select(6000)!;
    expect(frames).toHaveLength(12);
    expect(new Set(frames.map(frame => frame.id)).size).toBe(12);
    expect(frames[0].capturedAtMs).toBe(0);
    expect(frames.at(-1)!.capturedAtMs).toBe(6000);
  });
  it('rejects stale windows and does not submit an incomplete batch', () => {
    const { buffer, config } = populatedBuffer();
    expect(buffer.select(10000)).toBeNull();
    const empty = new FrameBuffer(config.capture);
    empty.push({ id: 1, capturedAtMs: 6000, blob: new Blob(['jpeg']) });
    expect(empty.select(6000)).toBeNull();
  });
  it('rejects sampling gaps even when there are enough frames', () => {
    const { config } = populatedBuffer();
    const buffer = new FrameBuffer(config.capture);
    for (let i = 0; i < 6; i++) buffer.push({ id: i, capturedAtMs: i * 100, blob: new Blob(['jpeg']) });
    for (let i = 0; i < 6; i++) buffer.push({ id: 6 + i, capturedAtMs: 5500 + i * 100, blob: new Blob(['jpeg']) });
    expect(buffer.select(6000)).toBeNull();
  });
  it('bounds memory and drops old frames', () => {
    const { config } = populatedBuffer();
    config.capture.max_buffer_mb = 4;
    const buffer = new FrameBuffer(config.capture);
    for (let i = 0; i < 12; i++) buffer.push({ id: i, capturedAtMs: i * 250, blob: new Blob([new Uint8Array(1024 * 1024)]) });
    expect(buffer.stats(3000).bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(buffer.select(3000)).toBeNull();
  });
  it('validates independent sampling parameters together', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    expect(validateConfig(config)).toEqual([]);
    config.capture.sample_fps = 1;
    expect(validateConfig(config).some(message => message.includes('观察窗口'))).toBe(true);
  });
  it('allows independent model and speech choices', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    config.narration.provider = 'deepseek';
    config.audio.provider = 'openai';
    expect(validateConfig(config)).toEqual([]);
    config.audio.provider = 'browser';
    expect(validateConfig(config)).toEqual([]);
    config.audio.provider = 'elevenlabs';
    config.narration.character = 'skeptic';
    expect(validateConfig(config)).toEqual([]);
  });
  it('rejects unsupported model and speech providers', () => {
    const config = cloneConfig(DEFAULT_CONFIG);
    Object.assign(config.narration, { provider: 'unsupported' });
    Object.assign(config.audio, { provider: 'unsupported' });
    expect(validateConfig(config)).toContain('请选择 GPT 或 DeepSeek');
    expect(validateConfig(config)).toContain('不支持的语音来源');
  });
});

describe('narration lifecycle', () => {
  const callbacks = () => ({ onStatus: vi.fn(), onBatch: vi.fn(), onResult: vi.fn(), onWarning: vi.fn(), onFatal: vi.fn() });
  it('never plays a late response after stop', async () => {
    const { buffer, config } = populatedBuffer();
    let resolve!: (value: NarrationResponse) => void;
    let batchId = '';
    const request = vi.fn((metadata: BatchRequest) => { batchId = metadata.batch_id; return new Promise<NarrationResponse>(r => { resolve = r; }); });
    const speaker = { play: vi.fn(async () => {}), stop: vi.fn() };
    const events = callbacks();
    const engine = new NarratorEngine(buffer, config, 'live', speaker, events, request, () => 6000);
    engine.start();
    expect(request).toHaveBeenCalledTimes(1);
    engine.stop();
    resolve(response(batchId));
    await engine.done;
    expect(speaker.play).not.toHaveBeenCalled();
    expect(events.onResult).not.toHaveBeenCalled();
  });
  it('keeps one request in flight and waits for audio playback', async () => {
    const { buffer, config } = populatedBuffer();
    let finishAudio!: () => void;
    const request = vi.fn(async (metadata: BatchRequest) => response(metadata.batch_id));
    const speaker = { play: vi.fn(() => new Promise<void>(resolve => { finishAudio = resolve; })), stop: vi.fn() };
    const engine = new NarratorEngine(buffer, config, 'live', speaker, callbacks(), request, () => 6000);
    engine.start();
    await Promise.resolve(); await Promise.resolve();
    expect(speaker.play).toHaveBeenCalledTimes(1);
    engine.start();
    expect(request).toHaveBeenCalledTimes(1);
    engine.stop(); finishAudio(); await engine.done;
  });
  it('discards responses older than the freshness threshold', async () => {
    const { buffer, config } = populatedBuffer();
    config.loop.cooldown_seconds = 0;
    let now = 6000;
    const request = vi.fn(async (metadata: BatchRequest) => { now = 70000; return response(metadata.batch_id); });
    const speaker = { play: vi.fn(async () => {}), stop: vi.fn() };
    const events = callbacks();
    const engine = new NarratorEngine(buffer, config, 'live', speaker, events, request, () => now);
    engine.start();
    await Promise.resolve(); await Promise.resolve();
    expect(events.onWarning).toHaveBeenCalled();
    expect(speaker.play).not.toHaveBeenCalled();
    engine.stop(); await engine.done;
  });
});
