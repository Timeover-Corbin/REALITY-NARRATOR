import type { NarrationResponse, RuntimeConfig } from './types';

export interface Speaker {
  play(result: NarrationResponse, config: RuntimeConfig, signal: AbortSignal): Promise<void>;
  stop(): void;
}

const BROWSER_SPEECH_ERRORS: Record<string, string> = {
  network: '语音服务网络连接失败，请检查浏览器网络或改用本机声音',
  'synthesis-unavailable': '浏览器没有可用的语音引擎，请改选本机声音',
  'synthesis-failed': '语音引擎合成失败，请改选其他声音',
  'voice-unavailable': '所选声音当前不可用，请重新选择声音',
  'language-unavailable': '没有可用于当前语言的声音',
  'not-allowed': '浏览器阻止了语音启动，请重新点击试听或开始按钮',
  'audio-busy': '声音输出设备正被占用',
  'audio-hardware': '浏览器无法访问声音输出设备，请检查扬声器设置',
  interrupted: '语音播放被中断',
  canceled: '语音播放被取消',
};

export class AudioPlayer implements Speaker {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private cancelBrowserSpeech: (() => void) | null = null;

  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
    // A user-initiated, silent one-sample buffer unlocks later Web Audio playback.
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.connect(this.context.destination);
    source.start();
    window.speechSynthesis?.getVoices();
  }

  async play(result: NarrationResponse, config: RuntimeConfig, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.stop();
    if (result.audio_base64) {
      this.context ??= new AudioContext();
      if (this.context.state !== 'running') throw new Error('声音尚未启用，请停止后重新点击开始');
      const binary = atob(result.audio_base64);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const decoded = await this.context.decodeAudioData(bytes.buffer);
      if (signal.aborted) return;
      const source = this.context.createBufferSource();
      source.buffer = decoded;
      source.playbackRate.value = config.audio.speech_rate;
      const gain = this.context.createGain();
      gain.gain.value = config.audio.volume;
      source.connect(gain).connect(this.context.destination);
      this.source = source;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          signal.removeEventListener('abort', abort);
          source.onended = null;
          try { source.stop(); } catch { /* Already stopped. */ }
          source.disconnect(); gain.disconnect();
          if (this.source === source) this.source = null;
          if (error) reject(error); else resolve();
        };
        const abort = () => finish();
        const watchdog = setTimeout(() => finish(new Error('音频播放超时，已释放当前旁白')), (decoded.duration / config.audio.speech_rate + 5) * 1000);
        source.onended = () => finish();
        signal.addEventListener('abort', abort, { once: true });
        source.start();
      });
    } else {
      await this.speakInBrowser(result.narration, config, signal);
    }
  }

  async previewBrowserVoice(config: RuntimeConfig, signal: AbortSignal) {
    if (signal.aborted) return;
    this.stop();
    const text = config.narration.language === 'zh-CN'
      ? '你好，这是一段浏览器语音测试。'
      : 'Hello. This is a browser voice test.';
    await this.speakInBrowser(text, config, signal);
  }

  private async speakInBrowser(text: string, config: RuntimeConfig, signal: AbortSignal) {
    if (signal.aborted) return;
    if (!window.speechSynthesis) throw new Error('此浏览器不支持语音合成；字幕已保留');
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = config.narration.language;
    utterance.volume = config.audio.volume;
    utterance.rate = config.audio.speech_rate;
    const language = config.narration.language.split('-')[0].toLowerCase();
    const voices = synth.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(language));
    const preferred = voices.find(voice => voice.voiceURI === config.audio.browser_voice_uri)
      || voices.find(voice => voice.localService) || voices[0];
    if (preferred) utterance.voice = preferred;
    const voiceName = preferred ? `${preferred.name}（${preferred.localService ? '本机' : '在线'}）` : '系统默认声音';
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let started = false;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      let playbackTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer); clearTimeout(playbackTimer);
        signal.removeEventListener('abort', abort);
        utterance.onstart = utterance.onend = utterance.onerror = null;
        if (this.cancelBrowserSpeech === abort) this.cancelBrowserSpeech = null;
        synth.cancel();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish();
      this.cancelBrowserSpeech = abort;
      startupTimer = setTimeout(() => {
        const advice = preferred && !preferred.localService
          ? '在线声音需要连接浏览器的远程语音服务，请检查网络或改用本机声音'
          : '请检查系统语音组件或改选其他本机声音';
        finish(new Error(`${voiceName}在15秒内未开始播放。${advice}；字幕已保留`));
      }, 15000);
      utterance.onstart = () => {
        if (settled || started) return;
        started = true;
        clearTimeout(startupTimer);
        playbackTimer = setTimeout(() => finish(new Error(`${voiceName}已开始播放，但未正常结束；字幕已保留`)),
          Math.min(90000, Math.max(15000, text.length * 700 / config.audio.speech_rate)));
      };
      utterance.onend = () => finish();
      utterance.onerror = event => finish(new Error(`${voiceName}播放失败（${event.error}）：${BROWSER_SPEECH_ERRORS[event.error] || '浏览器语音服务异常'}；字幕已保留`));
      signal.addEventListener('abort', abort, { once: true });
      try {
        synth.speak(utterance);
        if (synth.paused) synth.resume();
      } catch (cause) {
        finish(new Error(`${voiceName}未能启动：${cause instanceof Error ? cause.message : '浏览器语音服务异常'}；字幕已保留`));
      }
    });
  }

  stop() {
    try { this.source?.stop(); } catch { /* Safe when already ended. */ }
    this.source = null;
    if (this.cancelBrowserSpeech) this.cancelBrowserSpeech();
    else window.speechSynthesis?.cancel();
  }
  async close() { this.stop(); await this.context?.close(); this.context = null; }
}
