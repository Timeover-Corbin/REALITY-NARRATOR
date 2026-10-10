import defaults from '../../config/defaults.json';
import type { RuntimeConfig, Style } from './types';

export const DEFAULT_CONFIG = defaults as RuntimeConfig;
export const DEFAULT_STYLES: Style[] = [
  { id: 'deadpan', label: '冷面游戏旁白', description: '把普通动作当成玩家的重大决定。' },
  { id: 'documentary', label: '人类纪录片', description: '把人类日常行为讲成生存仪式。' },
  { id: 'bureaucratic', label: '日常行政报告', description: '庄严宣布微不足道的进展。' },
  { id: 'epic', label: '小事史诗', description: '每一件小事都值得一部史诗。' },
  { id: 'unreliable', label: '不可靠解说员', description: '自信解说，随后自我纠正。' },
];
export const cloneConfig = (config: RuntimeConfig): RuntimeConfig => structuredClone(config);
const STYLE_IDS = DEFAULT_STYLES.map(style => style.id);

export function validateConfig(config: RuntimeConfig): string[] {
  const errors: string[] = [];
  const range = (value: number, min: number, max: number, name: string, integer = false) => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) errors.push(`${name}必须在 ${min}～${max} 之间${integer ? '，且为整数' : ''}`);
  };
  const c = config.capture, l = config.loop, n = config.narration, a = config.audio;
  range(c.frame_count, 6, 18, '图片数量', true);
  range(c.sample_fps, .5, 10, '截图频率');
  range(c.window_seconds, 2, 30, '观察窗口');
  range(c.image_width, 320, 1280, '图片宽度', true);
  range(c.jpeg_quality, .2, .95, 'JPEG质量');
  range(c.max_buffer_mb, 4, 128, '缓存上限', true);
  range(c.max_frame_gap_seconds, .5, 10, '最大采样间隔');
  range(l.cooldown_seconds, 0, 30, '播报间隔');
  range(l.request_timeout_seconds, 10, 120, '请求超时');
  range(l.max_result_age_seconds, 5, 180, '最大画面年龄');
  range(l.history_size, 0, 10, '历史条数', true);
  range(l.max_consecutive_errors, 1, 10, '连续错误上限', true);
  range(n.max_characters, 20, 240, '旁白字数上限', true);
  range(a.volume, 0, 1, '音量');
  range(a.speech_rate, .6, 1.5, '语速');
  if (c.sample_fps * c.window_seconds < c.frame_count) errors.push('观察窗口 × 截图频率必须至少等于图片数量');
  if (!['zh-CN', 'en-US'].includes(n.language)) errors.push('不支持的语言');
  if (!['openai', 'deepseek'].includes(n.provider)) errors.push('请选择 GPT 或 DeepSeek');
  if (!['browser', 'openai'].includes(a.provider)) errors.push('不支持的语音来源');
  if (typeof a.browser_voice_uri !== 'string' || a.browser_voice_uri.length > 500) errors.push('浏览器声音标识无效');
  if (!['fixed', 'random'].includes(n.style_mode)) errors.push('不支持的风格模式');
  if (!STYLE_IDS.includes(n.fixed_style)) errors.push('不支持的旁白风格');
  if (!Array.isArray(n.style_pool) || !n.style_pool.length || n.style_pool.length > 5 || n.style_pool.some(id => !STYLE_IDS.includes(id))) errors.push('随机风格池必须包含1～5种有效风格');
  return errors;
}

export function loadSavedConfig(fallback = DEFAULT_CONFIG): RuntimeConfig {
  try {
    const saved = localStorage.getItem('reality-narrator-config-v2');
    if (saved) {
      const config = JSON.parse(saved) as RuntimeConfig;
      if (!validateConfig(config).length) return config;
    }
  } catch { /* Ignore stale browser preferences, including incompatible shapes. */ }
  return cloneConfig(fallback);
}
