import type { StyleId } from './types';

export type UiLanguage = 'zh-CN' | 'en-US';
export const UI_LANGUAGE_KEY = 'reality-narrator-ui-language';

export function loadUiLanguage(): UiLanguage {
  try { return localStorage.getItem(UI_LANGUAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}

export function saveUiLanguage(language: UiLanguage) {
  try { localStorage.setItem(UI_LANGUAGE_KEY, language); } catch { /* UI still works without storage. */ }
}

const zh = {
  pageTitle: 'Reality Narrator — 不请自来的旁白',
  uiLanguage: '界面语言', connecting: '连接后端中', connected: '本机服务已连接', disconnected: '后端未连接', refresh: '刷新',
  introEyebrow: '为平凡日常，多加一句旁白', heroFirst: '你的日常。', heroSecond: '不请自来的旁白。',
  introFirst: '现实负责发生。', introSecond: '旁白负责多嘴。', introDetail: '摄像头观察日常，AI 发表不必要但具体的评论。',
  backendNotice: '后端尚未连接。请启动 FastAPI 服务，然后点击上方“刷新”。',
  keyNotice: '所选模型需要在 backend/.env 填入 {key} 并重启后端。', demoSuggestion: '先用演示模式验证摄像头和播放',
  ttsNotice: 'OpenAI 云端语音需要 OPENAI_API_KEY。当前将回退到浏览器语音。',
  demo: '演示模式', demoNotice: '旁白为预设示例，使用浏览器语音，未进行图像识别。',
  status_idle: '等待开场', status_starting: '正在启动摄像头', status_observing: '观察现实', status_analyzing: '酝酿不必要的评论',
  status_speaking: '旁白正在发言', status_cooldown: '短暂保持礼貌', status_error: '运行已暂停',
  liveVision: '实时识别', demoVision: '演示 / 未识别画面', liveCamera: '正在观察现实', demoCamera: '演示摄像头',
  previewLabel: '实时摄像头画面', frameAlt: '本批次历史画面 {index}',
  cameraEmptyTitle: '故事还没开始。', cameraEmptyDetail: '点击开始，让旁白观察你的日常。',
  captureProgress: '积累观察窗口', frameStats: '{count} 张画面 · {mb} MB', videoOnly: '只采集画面，不采集麦克风',
  narrator: '旁白', firstComment: '等待第一句评论', silence: '旁白暂时保持沉默。毕竟，偶尔也需要一点礼貌。',
  initialCaption: '“他即将允许一个陌生声音，对自己的人生指手画脚。”',
  latestObservation: '最新观察', timings: '视觉 {vision}s / 语音 {tts}s', batchSize: '{count} 张图片 / 批次',
  observationEmpty: '每轮均匀抽取当前观察窗口中的图片，上一条说完后再处理最新画面。',
  director: '导演工作台', configBadge: '01 / 参数', controlsTitle: '给现实配个旁白。',
  runMode: '运行模式', liveMode: '实时识别 · AI 旁白', demoMode: '演示示例 · 浏览器语音',
  visionProvider: '旁白模型', keyMissing: ' · 未配置 Key', currentModel: '当前模型：{model}',
  camera: '摄像头', defaultCamera: '系统默认摄像头', cameraNumber: '摄像头 {index}',
  frameCount: '上传图片', framesUnit: '张', sampleFps: '截图频率', windowSeconds: '观察窗口', secondsUnit: '秒',
  samplingNote: '在 {seconds} 秒中采样约 {samples} 张，再均匀选择 {count} 张上传。',
  style: '旁白风格', randomStyle: '随机切换 · 避免连续同风格', stylePool: '参与随机的风格',
  speechLanguage: '播报语言', chinese: '中文', english: 'English', audioProvider: '语音来源',
  browserAudio: '浏览器语音 · 无额外 API', openaiAudio: 'OpenAI 云端语音', browserVoice: '浏览器声音',
  automaticVoice: '自动选择 · 优先本机声音', localVoice: '本机', onlineVoice: '在线',
  testVoice: '试听所选声音', stopTest: '■ 停止试听',
  voiceNote: '试听无需启动摄像头或调用 AI。在线声音依赖浏览器的远程语音服务；连接失败时可改用本机声音。',
  cloudVoiceNote: '云端声音：{voice}。按旁白风格控制语气；合成失败会尝试浏览器语音。',
  advanced: '高级超参数', imageWidth: '图片宽度', jpegQuality: 'JPEG质量', maxCharacters: '字数上限', charactersUnit: '字',
  cooldown: '播报间隔', requestTimeout: '请求超时', maxAge: '画面年龄上限', historySize: '历史旁白', linesUnit: '条',
  speechRate: '语速', rateUnit: '倍', volume: '音量', resetDefaults: '恢复默认参数',
  start: '▶ 开始旁白', stop: '■ 停止旁白', action: '开场。', cut: '停。', replay: '重播上一句', replaying: '正在重播…',
  settingsNote: '参数在停止时修改，下次开始生效。', promptNote: 'Prompt 独立存放在 backend/prompts/。',
  historyEyebrow: '那些没人请求的评论', historyCount: '{count} 条旁白', historyTitle: '旁白记录',
  demoSource: '演示示例', browserSource: '浏览器语音', openaiSource: 'OpenAI 云端语音',
  historyMeta: '{count} 张 / {seconds}s · 画面距返回 {age}s',
  historyEmpty: '目前还没有任何不必要的评论。这种安静即将结束。',
  footerEdition: 'REALITY NARRATOR / 黑客松版', footerTagline: '普通的生活。过度的解说。',
};

const en: Record<keyof typeof zh, string> = {
  pageTitle: 'Reality Narrator — Uninvited commentary',
  uiLanguage: 'Interface language', connecting: 'Connecting to backend', connected: 'Local service connected', disconnected: 'Backend disconnected', refresh: 'Refresh',
  introEyebrow: 'AN UNINVITED COMMENTARY ON THE EVERYDAY', heroFirst: 'Your life.', heroSecond: 'Unsolicited commentary.',
  introFirst: 'Life happens.', introSecond: 'The narrator weighs in.', introDetail: 'Your camera observes the everyday. AI adds oddly specific commentary.',
  backendNotice: 'The backend is disconnected. Start FastAPI, then click Refresh above.',
  keyNotice: 'Add {key} to backend/.env for the selected model, then restart the backend.', demoSuggestion: 'Try the camera and playback in demo mode',
  ttsNotice: 'OpenAI speech needs OPENAI_API_KEY. Browser speech will be used as a fallback.',
  demo: 'Demo mode', demoNotice: 'Preset examples with browser speech. Images are not analyzed.',
  status_idle: 'Waiting for the opening', status_starting: 'Starting the camera', status_observing: 'Observing reality', status_analyzing: 'Preparing an unnecessary comment',
  status_speaking: 'The narrator is speaking', status_cooldown: 'A brief moment of courtesy', status_error: 'Paused after an error',
  liveVision: 'LIVE VISION', demoVision: 'DEMO / NO VISION', liveCamera: 'OBSERVING REALITY', demoCamera: 'DEMO CAMERA',
  previewLabel: 'Live camera preview', frameAlt: 'Captured frame {index} from this batch',
  cameraEmptyTitle: 'The story has not started.', cameraEmptyDetail: 'Press Start and let the narrator observe your day.',
  captureProgress: 'Gathering the observation window', frameStats: '{count} FRAMES · {mb} MB', videoOnly: 'Video only. No microphone capture.',
  narrator: 'THE NARRATOR', firstComment: 'Waiting for the first comment', silence: 'The narrator is keeping quiet. A little courtesy, for once.',
  initialCaption: '“He is about to let a stranger comment on his every decision.”',
  latestObservation: 'LATEST OBSERVATION', timings: 'Vision {vision}s / Speech {tts}s', batchSize: '{count} images / batch',
  observationEmpty: 'Each round samples the latest observation window. The next batch follows after playback ends.',
  director: "DIRECTOR’S DESK", configBadge: '01 / CONFIG', controlsTitle: 'Give life a narrator.',
  runMode: 'Run mode', liveMode: 'Live vision · AI narration', demoMode: 'Demo examples · Browser speech',
  visionProvider: 'Narration model', keyMissing: ' · No API key', currentModel: 'Current model: {model}',
  camera: 'Camera', defaultCamera: 'System default camera', cameraNumber: 'Camera {index}',
  frameCount: 'Upload frames', framesUnit: 'frames', sampleFps: 'Sample rate', windowSeconds: 'Window', secondsUnit: 's',
  samplingNote: 'Sample about {samples} frames over {seconds}s, then evenly select {count} to upload.',
  style: 'Narration style', randomStyle: 'Random · Avoid consecutive repeats', stylePool: 'Styles in the random pool',
  speechLanguage: 'Speech language', chinese: 'Chinese', english: 'English', audioProvider: 'Speech source',
  browserAudio: 'Browser speech · No extra API', openaiAudio: 'OpenAI cloud speech', browserVoice: 'Browser voice',
  automaticVoice: 'Automatic · Prefer local voices', localVoice: 'Local', onlineVoice: 'Online',
  testVoice: 'Preview selected voice', stopTest: '■ Stop preview',
  voiceNote: 'Preview needs no camera or AI request. Online voices depend on a remote browser service; try a local voice if it fails.',
  cloudVoiceNote: 'Cloud voice: {voice}. Delivery follows the narration style; failures fall back to browser speech.',
  advanced: 'Advanced settings', imageWidth: 'Image width', jpegQuality: 'JPEG quality', maxCharacters: 'Character limit', charactersUnit: 'chars',
  cooldown: 'Cooldown', requestTimeout: 'Request timeout', maxAge: 'Maximum frame age', historySize: 'History size', linesUnit: 'lines',
  speechRate: 'Speech rate', rateUnit: '×', volume: 'Volume', resetDefaults: 'Restore defaults',
  start: '▶ Start narration', stop: '■ Stop narration', action: 'ACTION.', cut: 'CUT.', replay: 'Replay last line', replaying: 'Replaying…',
  settingsNote: 'Change settings while stopped. They apply on the next start.', promptNote: 'Prompts are stored in backend/prompts/.',
  historyEyebrow: 'THINGS NOBODY ASKED TO HEAR', historyCount: '{count} LINES', historyTitle: 'Narration history',
  demoSource: 'Demo example', browserSource: 'Browser speech', openaiSource: 'OpenAI cloud speech',
  historyMeta: '{count} frames / {seconds}s · Frame age on return {age}s',
  historyEmpty: 'No unsolicited comments yet. This peace is temporary.',
  footerEdition: 'REALITY NARRATOR / HACKATHON EDITION', footerTagline: 'Ordinary life. Excessive commentary.',
};

export function createTranslator(language: UiLanguage) {
  const messages = language === 'en-US' ? en : zh;
  return (key: keyof typeof zh, values: Record<string, string | number> = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (token, name: string) => values[name] === undefined ? token : String(values[name]));
}

const ENGLISH_STYLES: Record<StyleId, { label: string; description: string }> = {
  deadpan: { label: 'Deadpan game narrator', description: 'Treat an ordinary choice as a major player decision, then question your own interpretation.' },
  documentary: { label: 'Human documentary', description: 'Describe everyday human behavior as a curious survival ritual.' },
  bureaucratic: { label: 'Daily progress report', description: 'Announce tiny accomplishments with the solemnity of an official report.' },
  epic: { label: 'Everyday epic', description: 'Give a small action the stakes of an epic quest.' },
  unreliable: { label: 'Unreliable narrator', description: 'Confidently explain the action, then correct yourself.' },
};

export function localizeStyle<T extends { id: StyleId; label: string; description?: string }>(style: T, language: UiLanguage): T {
  return language === 'en-US' ? { ...style, ...ENGLISH_STYLES[style.id] } : style;
}

// Translate application notices at render time, so existing notices follow a UI switch.
// Model-generated narration and observations are never passed through this function.
const NOTICE_TRANSLATIONS: Record<string, string> = {
  '页面进入后台，已暂停摄像头和旁白；返回后点击开始即可继续': 'The page moved to the background. Camera and narration are paused; press Start to resume.',
  '摄像头需要在 localhost 或 HTTPS 页面中使用': 'The camera requires localhost or an HTTPS page.',
  '摄像头显示区域尚未准备好': 'The camera preview is not ready yet.',
  '摄像头已断开，请检查连接后重新开始': 'The camera disconnected. Check its connection and start again.',
  '摄像头权限被拒绝，请在浏览器地址栏允许访问后重新开始': 'Camera access was denied. Allow it in the browser address bar, then start again.',
  '没有找到可用摄像头': 'No available camera was found.',
  '摄像头可能被其他应用占用': 'Another application may be using the camera.',
  '摄像头启动失败': 'The camera could not start.',
  '运行中断': 'The session was interrupted.',
  '试听播放已完成。如果没有听到声音，请检查标签页静音和系统声音输出。': 'Voice preview completed. If you heard nothing, check tab muting and the system audio output.',
  '浏览器声音试听失败': 'The browser voice preview failed.',
  '播放失败': 'Playback failed.',
  '旁白批次编号不匹配': 'The narration batch ID does not match.',
  '这条旁白对应的画面已经过时，已跳过并重新观察': 'These frames are too old. Skipping this narration and observing again.',
  '旁白生成失败': 'Narration generation failed.',
  '已达到连续错误上限，暂停运行': 'The consecutive error limit was reached. The session is paused.',
  '无法连接后端服务': 'Cannot connect to the backend.',
  '后端返回了无效或不匹配的批次': 'The backend returned an invalid or mismatched batch.',
  '本批次处理超时，请减少图片数量或更换模型': 'This batch timed out. Use fewer frames or a different model.',
  '本批次处理超时，请减少图片数量或使用更快的模型。': 'This batch timed out. Use fewer frames or a faster model.',
  '客户端已停止本次请求。': 'The client stopped this request.',
  '批次元数据过大。': 'Batch metadata is too large.',
  '配置或批次元数据无效：': 'Invalid configuration or batch metadata: ',
  '实际图片数量与配置不一致。': 'The actual frame count does not match the configuration.',
  '后端未启用演示模式。': 'Demo mode is not enabled on the backend.',
  '图片超出大小限制，请降低分辨率或JPEG质量。': 'The image exceeds the size limit. Reduce its resolution or JPEG quality.',
  '图片必须是有效且尺寸不超过2048×2048的JPEG。': 'Images must be valid JPEGs no larger than 2048×2048.',
  '后端正在处理其他批次，请稍后重试。': 'The backend is processing another batch. Try again shortly.',
  '无法创建画面采集画布': 'Cannot create the frame capture canvas.',
  'JPEG画面压缩失败': 'JPEG frame compression failed.',
  '采集画面失败': 'Frame capture failed.',
  '声音尚未启用，请停止后重新点击开始': 'Audio is not enabled. Stop, then press Start again.',
  '音频播放超时，已释放当前旁白': 'Audio playback timed out. The current narration was released.',
  '此浏览器不支持语音合成；字幕已保留': 'This browser does not support speech synthesis. Captions are still available.',
  '语音服务网络连接失败，请检查浏览器网络或改用本机声音': 'The speech service connection failed. Check the browser network or try a local voice.',
  '浏览器没有可用的语音引擎，请改选本机声音': 'No speech engine is available. Try a local voice.',
  '语音引擎合成失败，请改选其他声音': 'The speech engine failed to synthesize audio. Try another voice.',
  '所选声音当前不可用，请重新选择声音': 'The selected voice is unavailable. Choose another voice.',
  '没有可用于当前语言的声音': 'No voice is available for the selected language.',
  '浏览器阻止了语音启动，请重新点击试听或开始按钮': 'The browser blocked speech. Click Preview or Start again.',
  '声音输出设备正被占用': 'The audio output device is busy.',
  '浏览器无法访问声音输出设备，请检查扬声器设置': 'The browser cannot access audio output. Check the speaker settings.',
  '语音播放被中断': 'Speech was interrupted.', '语音播放被取消': 'Speech was canceled.',
  '在线声音需要连接浏览器的远程语音服务，请检查网络或改用本机声音': 'Online voices need a remote browser speech service. Check the network or try a local voice.',
  '请检查系统语音组件或改选其他本机声音': 'Check the system speech components or try another local voice.',
  '浏览器语音服务异常': 'The browser speech service failed.',
  '已开始播放，但未正常结束': ' started playing but did not finish normally',
  '在15秒内未开始播放': ' did not start playing within 15 seconds',
  '未能启动：': ' could not start: ', '播放失败（': ' playback failed (',
  '）；字幕已保留': '); captions are still available', '；字幕已保留': '; captions are still available',
  '）：': '): ', '（本机）': ' (Local)', '（在线）': ' (Online)', '系统默认声音': 'System default voice',
  '观察窗口 × 截图频率必须至少等于图片数量': 'Window length × sample rate must be at least the frame count.',
  '不支持的语言': 'Unsupported speech language.', '请选择 GPT 或 DeepSeek': 'Choose GPT or DeepSeek.',
  '不支持的语音来源': 'Unsupported speech source.', '浏览器声音标识无效': 'Invalid browser voice identifier.',
  '不支持的风格模式': 'Unsupported style mode.', '不支持的旁白风格': 'Unsupported narration style.',
  '随机风格池必须包含1～5种有效风格': 'The random style pool must contain 1–5 valid styles.',
  '演示模式：使用预设示例文案和浏览器语音，没有进行图像识别。': 'Demo mode uses preset examples and browser speech. No image analysis was performed.',
  '云端语音合成超时，将尝试浏览器语音。': 'Cloud speech synthesis timed out. Trying browser speech.',
  '将尝试浏览器语音。': 'Trying browser speech.', '云端语音合成超时。': 'Cloud speech synthesis timed out.',
  '无法连接云端语音服务。': 'Cannot connect to the cloud speech service.',
  'TTS音频为空或超过大小限制。': 'Speech audio is empty or exceeds the size limit.',
  'TTS返回了无效WAV文件。': 'Speech synthesis returned an invalid WAV file.',
  'TTS返回了无效或过长的PCM音频。': 'Speech synthesis returned invalid or excessively long PCM audio.',
  'TTS音频超过大小限制。': 'Speech audio exceeds the size limit.',
  '语音合成的时间预算不足。': 'Not enough time remains for speech synthesis.',
  '视觉模型没有返回旁白内容，请检查模型、配额或图片。': 'The vision model returned no narration. Check the model, quota or images.',
  'DeepSeek没有返回旁白内容。': 'DeepSeek returned no narration content.',
  'DeepSeek未完成旁白，请检查输出限制或图片。': 'DeepSeek did not finish. Check the output limit or images.',
  'GPT未完成本次生成，请检查模型、输出限制或图片。': 'GPT did not finish. Check the model, output limit or images.',
  'GPT未能为本批次生成旁白，请更换画面后重试。': 'GPT could not narrate this batch. Try a different scene.',
  '返回的旁白格式不正确：': ' returned invalid narration data: ', '。请重试。': '. Please try again.',
  '缺少字段 ': 'Missing field: ', '包含约定之外的字段': 'Contains unexpected fields',
  'should_speak 必须是布尔值 true 或 false': 'should_speak must be a boolean (true or false)',
  ' 必须是字符串，不能是 null、数组或对象': ' must be a string, not null, an array or an object',
  ' 超过1000个字符': ' exceeds 1000 characters',
  'should_speak=true 时，observation 和 narration 都不能为空': 'When should_speak=true, observation and narration must both be non-empty',
  'JSON字段不符合约定格式': 'JSON fields do not match the required format',
  'JSON顶层必须是对象': 'The top-level JSON value must be an object',
};

const FIELD_NAMES: Record<string, string> = {
  '图片数量': 'Frame count', '截图频率': 'Sample rate', '观察窗口': 'Window length', '图片宽度': 'Image width',
  'JPEG质量': 'JPEG quality', '缓存上限': 'Buffer limit', '最大采样间隔': 'Maximum sampling gap',
  '播报间隔': 'Cooldown', '请求超时': 'Request timeout', '最大画面年龄': 'Maximum frame age',
  '历史条数': 'History size', '连续错误上限': 'Consecutive error limit', '旁白字数上限': 'Narration character limit',
  '音量': 'Volume', '语速': 'Speech rate',
};
const noticeEntries = Object.entries(NOTICE_TRANSLATIONS).sort(([a], [b]) => b.length - a.length);

export function localizeNotice(message: string, language: UiLanguage): string {
  if (language === 'zh-CN') return message;
  const range = message.match(/^(.+)必须在 (.+)～(.+) 之间(，且为整数)?$/);
  if (range) return `${FIELD_NAMES[range[1]] || range[1]} must be between ${range[2]} and ${range[3]}${range[4] ? ', and an integer' : ''}.`;
  let result = message
    .replace(/不是有效JSON（第(\d+)行，第(\d+)列）/g, 'Invalid JSON (line $1, column $2)')
    .replace(/请求失败（HTTP (\d+)）/g, ' request failed (HTTP $1)')
    .replace(/，请检查模型名、接口地址及账户可用性。/g, '. Check the model name, endpoint and account availability.')
    .replace(/请先在 backend\/\.env 设置 (\w+)，然后重启后端。/g, 'Set $1 in backend/.env, then restart the backend.')
    .replace(/拒绝访问，请检查API Key及模型权限。/g, ' denied access. Check the API key and model permissions.')
    .replace(/配额或请求频率超限，请稍后再试。/g, ' quota or rate limit exceeded. Try again later.')
    .replace(/响应超时，请稍后再试。/g, ' response timed out. Try again later.')
    .replace(/无法连接(.+?)，请检查后端网络。/g, 'Cannot connect to $1. Check the backend network.')
    .replace(/返回了无法解析的数据。/g, ' returned unreadable data.')
    .replace(/OpenAI云端语音需要 OPENAI_API_KEY。/g, 'OpenAI cloud speech requires OPENAI_API_KEY.');
  for (const [source, translated] of noticeEntries) result = result.split(source).join(translated);
  return result.trim();
}
