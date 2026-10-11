import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './audio';
import { cloneConfig, DEFAULT_CONFIG } from './config';
import type { NarrationResponse } from './types';

class TestUtterance {
  lang = ''; volume = 1; rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

const online = { name: 'Online voice', voiceURI: 'online-zh', lang: 'zh-CN', localService: false } as SpeechSynthesisVoice;
const local = { name: 'Local voice', voiceURI: 'local-zh', lang: 'zh-CN', localService: true } as SpeechSynthesisVoice;
const narration: NarrationResponse = {
  batch_id: 'audio-test', mode: 'live', vision_provider: 'deepseek',
  style: { id: 'deadpan', label: 'test' }, should_speak: true, observation: 'a cup', narration: '你好。',
  audio_base64: null, audio_mime_type: null, audio_source: 'browser', warning: null,
  timings: { vision_ms: 0, tts_ms: 0, total_ms: 0 },
};

function browserSpeech() {
  vi.useFakeTimers();
  let utterance!: TestUtterance;
  const synth = {
    paused: false,
    getVoices: () => [online, local],
    cancel: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn((next: TestUtterance) => { utterance = next; }),
  };
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance);
  const config = cloneConfig(DEFAULT_CONFIG);
  config.narration.language = 'zh-CN';
  config.audio.browser_voice_uri = online.voiceURI;
  return { player: new AudioPlayer(), config, synth, utterance: () => utterance };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser voice playback', () => {
  it('reports an online voice that never starts after 15 seconds', async () => {
    const { player, config, utterance } = browserSpeech();
    const playing = player.play(narration, config, new AbortController().signal);
    const failed = expect(playing).rejects.toThrow('Online voice（在线）在15秒内未开始播放');
    expect(utterance().voice).toBe(online);
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
    expect(utterance().onstart).toBeNull();
    expect(utterance().onerror).toBeNull();
  });

  it('clears the startup deadline when speech starts and waits for its end', async () => {
    const { player, config, utterance } = browserSpeech();
    const playing = player.play(narration, config, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(14000);
    utterance().onstart!();
    await vi.advanceTimersByTimeAsync(2000);
    utterance().onend!();
    await playing;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('distinguishes an unfinished playback from a failure to start', async () => {
    const { player, config, utterance } = browserSpeech();
    const playing = player.play(narration, config, new AbortController().signal);
    const failed = expect(playing).rejects.toThrow('已开始播放，但未正常结束');
    await vi.advanceTimersByTimeAsync(1000);
    utterance().onstart!();
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports the browser error code and a network explanation', async () => {
    const { player, config, utterance } = browserSpeech();
    const playing = player.play(narration, config, new AbortController().signal);
    const failed = expect(playing).rejects.toThrow('播放失败（network）：语音服务网络连接失败');
    utterance().onerror!({ error: 'network' });
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles an explicit stop even if the browser sends no cancellation event', async () => {
    const { player, config, utterance } = browserSpeech();
    const playing = player.play(narration, config, new AbortController().signal);
    player.stop();
    await playing;
    expect(vi.getTimerCount()).toBe(0);
    expect(utterance().onerror).toBeNull();
  });

  it('aborts pending online speech without reporting a playback error', async () => {
    const { player, config } = browserSpeech();
    const controller = new AbortController();
    const playing = player.play(narration, config, controller.signal);
    controller.abort();
    await playing;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resumes a paused speech queue and prefers a local voice in automatic mode', async () => {
    const { player, config, synth, utterance } = browserSpeech();
    synth.paused = true;
    config.audio.browser_voice_uri = '';
    const playing = player.play(narration, config, new AbortController().signal);
    expect(synth.resume).toHaveBeenCalledOnce();
    expect(utterance().voice).toBe(local);
    utterance().onend!();
    await playing;
  });

  it('previews the selected voice with a short phrase and skips aborted previews', async () => {
    const { player, config, synth, utterance } = browserSpeech();
    const controller = new AbortController();
    const playing = player.previewBrowserVoice(config, controller.signal);
    expect(utterance().text).toBe('你好，这是一段浏览器语音测试。');
    expect(utterance().voice).toBe(online);
    utterance().onend!();
    await playing;
    controller.abort();
    await player.previewBrowserVoice(config, controller.signal);
    expect(synth.speak).toHaveBeenCalledOnce();
  });
});
