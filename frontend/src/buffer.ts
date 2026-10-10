import type { Frame, RuntimeConfig } from './types';

export class FrameBuffer {
  private frames: Frame[] = [];
  private bytes = 0;
  constructor(private config: RuntimeConfig['capture']) {}
  push(frame: Frame) {
    if (this.frames.length && frame.capturedAtMs <= this.frames[this.frames.length - 1].capturedAtMs) return;
    this.frames.push(frame);
    this.bytes += frame.blob.size;
    const cutoff = frame.capturedAtMs - this.config.window_seconds * 1000;
    // Retain one boundary frame; selection still uses only frames inside the window.
    while (this.frames.length > 1 && (this.frames[1].capturedAtMs <= cutoff || this.bytes > this.config.max_buffer_mb * 1024 * 1024)) {
      this.bytes -= this.frames.shift()!.blob.size;
    }
  }
  stats(now: number) {
    const available = this.frames.filter(f => f.capturedAtMs >= now - this.config.window_seconds * 1000);
    const span = available.length > 1 ? (available[available.length - 1].capturedAtMs - available[0].capturedAtMs) / 1000 : 0;
    return { count: available.length, spanSeconds: span, bytes: this.bytes };
  }
  select(now: number): Frame[] | null {
    const frames = this.frames.filter(f => f.capturedAtMs >= now - this.config.window_seconds * 1000);
    if (frames.length < this.config.frame_count) return null;
    const tolerance = 2 * 1000 / this.config.sample_fps;
    if (frames[frames.length - 1].capturedAtMs - frames[0].capturedAtMs < this.config.window_seconds * 1000 - tolerance) return null;
    if (now - frames[frames.length - 1].capturedAtMs > Math.max(tolerance, this.config.max_frame_gap_seconds * 1000)) return null;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].capturedAtMs - frames[i - 1].capturedAtMs > Math.max(3 * 1000 / this.config.sample_fps, this.config.max_frame_gap_seconds * 1000)) return null;
    }
    const count = this.config.frame_count;
    // Uniformly select unique frames, including first and last, across the whole window.
    return Array.from({ length: count }, (_, i) => frames[Math.round(i * (frames.length - 1) / (count - 1))]);
  }
  clear() { this.frames = []; this.bytes = 0; }
}

export class CameraSampler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private canvas = document.createElement('canvas');
  private sequence = 0;
  constructor(private video: HTMLVideoElement, private buffer: FrameBuffer, private config: RuntimeConfig['capture'], private onError: (message: string) => void) {}
  start() { this.active = true; void this.tick(); }
  stop() { this.active = false; clearTimeout(this.timer); }
  private async tick() {
    const started = performance.now();
    try {
      if (this.video.readyState >= 2 && this.video.videoWidth) {
        this.canvas.width = Math.min(this.config.image_width, this.video.videoWidth);
        this.canvas.height = Math.round(this.canvas.width * this.video.videoHeight / this.video.videoWidth);
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error('无法创建画面采集画布');
        context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        const capturedAtMs = performance.now();
        const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/jpeg', this.config.jpeg_quality));
        if (!blob) throw new Error('JPEG画面压缩失败');
        if (this.active) this.buffer.push({ id: this.sequence++, capturedAtMs, blob });
      }
    } catch (error) {
      this.stop();
      this.onError(error instanceof Error ? error.message : '采集画面失败');
      return;
    }
    if (this.active) this.timer = setTimeout(() => void this.tick(), Math.max(10, 1000 / this.config.sample_fps - (performance.now() - started)));
  }
}
