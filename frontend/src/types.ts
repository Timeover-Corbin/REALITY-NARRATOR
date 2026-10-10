export type StyleId = 'deadpan' | 'documentary' | 'bureaucratic' | 'epic' | 'unreliable';
export type Mode = 'live' | 'demo';
export type VisionProvider = 'openai' | 'deepseek';
export type Status = 'idle' | 'starting' | 'observing' | 'analyzing' | 'speaking' | 'cooldown' | 'error';
export interface RuntimeConfig {
  capture: { frame_count: number; sample_fps: number; window_seconds: number; image_width: number; jpeg_quality: number; max_buffer_mb: number; max_frame_gap_seconds: number };
  loop: { cooldown_seconds: number; request_timeout_seconds: number; max_result_age_seconds: number; history_size: number; max_consecutive_errors: number };
  narration: { provider: VisionProvider; language: 'zh-CN' | 'en-US'; style_mode: 'random' | 'fixed'; fixed_style: StyleId; style_pool: StyleId[]; max_characters: number };
  audio: { provider: 'browser' | 'openai'; browser_voice_uri: string; volume: number; speech_rate: number };
}
export interface Frame { id: number; capturedAtMs: number; blob: Blob }
export interface Health {
  status: string; demo_available: boolean;
  providers: Record<VisionProvider, { configured: boolean; model: string }>;
  tts: { configured: boolean; model: string; voice: string };
}
export interface Style { id: StyleId; label: string; description: string }
export interface NarrationResponse {
  batch_id: string; mode: Mode; style: { id: StyleId; label: string };
  vision_provider: VisionProvider | null;
  should_speak: boolean; observation: string; narration: string;
  audio_base64: string | null; audio_mime_type: string | null;
  audio_source: 'openai' | 'browser' | 'none'; warning: string | null;
  timings: { vision_ms: number; tts_ms: number; total_ms: number };
}
export interface BatchRequest {
  batch_id: string; mode: Mode; config: RuntimeConfig;
  frame_timestamps_ms: number[]; recent_narrations: string[]; recent_styles: StyleId[];
}
export interface Transcript extends NarrationResponse { receivedAt: number; capturedAgeSeconds: number; frameCount: number; windowSeconds: number }
