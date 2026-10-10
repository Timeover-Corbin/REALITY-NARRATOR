import { ApiError, requestNarration } from './api';
import type { Speaker } from './audio';
import { FrameBuffer } from './buffer';
import type { BatchRequest, Frame, Mode, NarrationResponse, RuntimeConfig, Status, StyleId, Transcript } from './types';

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export interface EngineCallbacks {
  onStatus(status: Status): void;
  onBatch(frames: Frame[]): void;
  onResult(result: Transcript): void;
  onWarning(message: string): void;
  onFatal(message: string): void;
}

export class NarratorEngine {
  private controller = new AbortController();
  private recentLines: string[] = [];
  private recentStyles: StyleId[] = [];
  private lastFrameAt = -1;
  private failures = 0;
  private active = false;
  done: Promise<void> = Promise.resolve();

  constructor(
    private buffer: FrameBuffer,
    private config: RuntimeConfig,
    private mode: Mode,
    private speaker: Speaker,
    private callbacks: EngineCallbacks,
    private request = requestNarration,
    private now = () => performance.now(),
  ) {}

  start() {
    if (this.active || this.controller.signal.aborted) return;
    this.active = true;
    this.done = this.run().finally(() => { this.active = false; });
  }
  stop() { this.controller.abort(); this.speaker.stop(); }

  private async run() {
    const signal = this.controller.signal;
    while (!signal.aborted) {
      const frames = this.buffer.select(this.now());
      if (!frames || frames[frames.length - 1].capturedAtMs <= this.lastFrameAt) {
        this.callbacks.onStatus('observing');
        await pause(200, signal);
        continue;
      }
      this.lastFrameAt = frames[frames.length - 1].capturedAtMs;
      const metadata: BatchRequest = {
        batch_id: crypto.randomUUID(), mode: this.mode, config: this.config,
        frame_timestamps_ms: frames.map(frame => frame.capturedAtMs),
        recent_narrations: this.recentLines, recent_styles: this.recentStyles,
      };
      try {
        this.callbacks.onBatch(frames);
        this.callbacks.onStatus('analyzing');
        const result: NarrationResponse = await this.request(metadata, frames, signal);
        if (signal.aborted) break;
        if (result.batch_id !== metadata.batch_id) throw new ApiError('旁白批次编号不匹配', 502);
        const age = (this.now() - this.lastFrameAt) / 1000;
        if (age > this.config.loop.max_result_age_seconds) {
          this.callbacks.onWarning('这条旁白对应的画面已经过时，已跳过并重新观察');
        } else {
          this.callbacks.onResult({ ...result, receivedAt: Date.now(), capturedAgeSeconds: age,
            frameCount: frames.length, windowSeconds: (this.lastFrameAt - frames[0].capturedAtMs) / 1000 });
          if (result.warning) this.callbacks.onWarning(result.warning);
          if (result.should_speak) {
            this.callbacks.onStatus('speaking');
            await this.speaker.play(result, this.config, signal);
            if (signal.aborted) break;
            this.recentLines = this.config.loop.history_size ? [...this.recentLines, result.narration].slice(-this.config.loop.history_size) : [];
            this.recentStyles = [...this.recentStyles, result.style.id].slice(-10);
          }
        }
        this.failures = 0;
        this.callbacks.onStatus('cooldown');
        await pause(this.config.loop.cooldown_seconds * 1000, signal);
      } catch (error) {
        if (signal.aborted) break;
        this.failures++;
        const message = error instanceof Error ? error.message : '旁白生成失败';
        if (this.failures >= this.config.loop.max_consecutive_errors) {
          this.callbacks.onFatal(`${message}；已达到连续错误上限，暂停运行`);
          this.stop();
          break;
        }
        this.callbacks.onWarning(`${message}（${this.failures}/${this.config.loop.max_consecutive_errors}）`);
        this.callbacks.onStatus('cooldown');
        const retryDelay = error instanceof ApiError && error.status === 429 ? 10000 : Math.min(8000, 2000 * this.failures);
        await pause(retryDelay, signal);
      }
    }
  }
}
