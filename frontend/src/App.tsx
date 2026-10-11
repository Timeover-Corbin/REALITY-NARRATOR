import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConfig, fetchHealth, requestVoicePreview } from './api';
import { AudioPlayer } from './audio';
import { CameraSampler, FrameBuffer } from './buffer';
import { cloneConfig, DEFAULT_CONFIG, DEFAULT_STYLES, loadSavedConfig, validateConfig } from './config';
import { NarratorEngine } from './engine';
import { createTranslator, loadUiLanguage, localizeNotice, localizeStyle, saveUiLanguage } from './i18n';
import type { UiLanguage } from './i18n';
import type { Frame, Health, Mode, RuntimeConfig, Status, Style, StyleId, Transcript } from './types';

function CameraIcon() {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 15h8l4-6h10l4 6h6v24H8V15Z" stroke="currentColor" strokeWidth="1.5"/><circle cx="24" cy="26" r="8" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

function BatchPreview({ frames, language }: { frames: Frame[]; language: UiLanguage }) {
  const t = createTranslator(language);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const selected = frames.filter((_, index) => index % Math.max(1, Math.ceil(frames.length / 6)) === 0).slice(0, 6);
    const next = selected.map(frame => URL.createObjectURL(frame.blob));
    setUrls(next);
    return () => next.forEach(url => URL.revokeObjectURL(url));
  }, [frames]);
  return <div className="frame-strip">{urls.length ? urls.map((url, index) => <img key={url} src={url} alt={t('frameAlt', { index: index + 1 })} />) : Array.from({ length: 6 }, (_, index) => <div className="frame-placeholder" key={index}>{String(index + 1).padStart(2, '0')}</div>)}</div>;
}

function NumberField({ label, value, unit, min, max, step = 1, disabled, onChange }: {
  label: string; value: number; unit?: string; min: number; max: number; step?: number; disabled: boolean; onChange(value: number): void;
}) {
  return <label className="number-field"><span>{label}</span><div><input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} /><small>{unit}</small></div></label>;
}

export default function App() {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(loadUiLanguage);
  const t = createTranslator(uiLanguage);
  const [config, setConfig] = useState<RuntimeConfig>(() => loadSavedConfig());
  const [styles, setStyles] = useState<Style[]>(DEFAULT_STYLES);
  const [health, setHealth] = useState<Health | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [mode, setMode] = useState<Mode>(() => new URLSearchParams(window.location.search).get('mode') === 'demo' ? 'demo' : 'live');
  const [status, setStatus] = useState<Status>('idle');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [stats, setStats] = useState({ count: 0, spanSeconds: 0, bytes: 0 });
  const [batchFrames, setBatchFrames] = useState<Frame[]>([]);
  const [history, setHistory] = useState<Transcript[]>([]);
  const [latest, setLatest] = useState<Transcript | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [previewKind, setPreviewKind] = useState<'browser' | 'elevenlabs' | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const sampler = useRef<CameraSampler | null>(null);
  const buffer = useRef<FrameBuffer | null>(null);
  const engine = useRef<NarratorEngine | null>(null);
  const audio = useRef(new AudioPlayer());
  const replayController = useRef<AbortController | null>(null);
  const voiceTestController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const runningRef = useRef(false);
  const serverDefaults = useRef(DEFAULT_CONFIG);

  const release = useCallback(() => {
    generation.current++;
    runningRef.current = false;
    replayController.current?.abort();
    voiceTestController.current?.abort();
    engine.current?.stop(); engine.current = null;
    sampler.current?.stop(); sampler.current = null;
    audio.current.stop();
    media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    buffer.current?.clear(); buffer.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release(); setRunning(false); setStatus('idle'); setStats({ count: 0, spanSeconds: 0, bytes: 0 });
  }, [release]);

  const refreshBackend = useCallback(async () => {
    setConnecting(true);
    try {
      const [nextHealth, nextConfig] = await Promise.all([fetchHealth(), fetchConfig()]);
      if (validateConfig(nextConfig.defaults).length) throw new Error('后端默认配置无效');
      setHealth(nextHealth); setStyles(nextConfig.styles);
      serverDefaults.current = nextConfig.defaults;
      setConfig(loadSavedConfig(nextConfig.defaults));
    } catch {
      setHealth(null);
    } finally { setConnecting(false); }
  }, []);

  useEffect(() => { void refreshBackend(); }, [refreshBackend]);
  useEffect(() => {
    saveUiLanguage(uiLanguage);
    document.documentElement.lang = uiLanguage;
    document.title = createTranslator(uiLanguage)('pageTitle');
  }, [uiLanguage]);
  useEffect(() => {
    if (!validateConfig(config).length) {
      try { localStorage.setItem('reality-narrator-config-v2', JSON.stringify(config)); } catch { /* Preferences are optional. */ }
    }
  }, [config]);
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices?.enumerateDevices().then(list => { if (alive) setDevices(list.filter(device => device.kind === 'videoinput')); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (buffer.current) setStats(buffer.current.stats(performance.now()));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden && runningRef.current) {
        stop(); setWarning('页面进入后台，已暂停摄像头和旁白；返回后点击开始即可继续');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); release(); void audio.current.close(); };
  }, [release, stop]);

  const update = <K extends keyof RuntimeConfig>(section: K, key: keyof RuntimeConfig[K], value: unknown) => {
    setConfig(previous => ({ ...previous, [section]: { ...previous[section], [key]: value } }));
  };
  const configErrors = validateConfig(config);
  const selectedProvider = health?.providers[config.narration.provider];
  const canStart = !!health && !configErrors.length && (mode === 'demo' ? health.demo_available : !!selectedProvider?.configured);
  const availableVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith(config.narration.language.split('-')[0]));
  const elevenlabsReady = !!health?.elevenlabs?.configured && !!health.elevenlabs.voices[config.narration.character]?.configured;
  const characterLabel = (character: RuntimeConfig['narration']['character']) => t(character === 'grandma' ? 'grandmaCharacter' : 'skepticCharacter');

  async function start() {
    if (runningRef.current || voiceTestController.current || replaying || !canStart) return;
    release();
    const session = ++generation.current;
    const runtimeConfig = cloneConfig(config);
    const current = () => generation.current === session;
    const fatal = (message: string) => {
      if (!current()) return;
      stop(); setError(message); setStatus('error');
    };
    runningRef.current = true;
    setRunning(true); setStatus('starting'); setError(''); setWarning(''); setLatest(null); setBatchFrames([]);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要在 localhost 或 HTTPS 页面中使用');
      // Resume audio synchronously from the user's start action before awaiting the camera.
      await audio.current.unlock();
      if (!current()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 },
      } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      const element = video.current;
      if (!element) throw new Error('摄像头显示区域尚未准备好');
      element.srcObject = stream;
      await element.play();
      if (!current()) return;
      for (const track of stream.getVideoTracks()) track.onended = () => fatal('摄像头已断开，请检查连接后重新开始');
      void navigator.mediaDevices.enumerateDevices().then(list => { if (current()) setDevices(list.filter(device => device.kind === 'videoinput')); });
      buffer.current = new FrameBuffer(runtimeConfig.capture);
      sampler.current = new CameraSampler(element, buffer.current, runtimeConfig.capture, fatal);
      engine.current = new NarratorEngine(buffer.current, runtimeConfig, mode, audio.current, {
        onStatus: next => { if (current()) setStatus(next); },
        onBatch: frames => { if (current()) { setBatchFrames(frames); setWarning(''); } },
        onResult: result => {
          if (!current()) return;
          setLatest(result);
          if (result.should_speak) setHistory(previous => [result, ...previous].slice(0, 20));
        },
        onWarning: message => { if (current()) setWarning(message); },
        onFatal: fatal,
      });
      sampler.current.start(); engine.current.start();
      void engine.current.done.catch(cause => fatal(cause instanceof Error ? cause.message : '运行中断'));
    } catch (cause) {
      if (!current()) return;
      const name = cause instanceof DOMException ? cause.name : '';
      const message = name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器地址栏允许访问后重新开始'
        : name === 'NotFoundError' ? '没有找到可用摄像头'
        : name === 'NotReadableError' ? '摄像头可能被其他应用占用'
        : cause instanceof Error ? cause.message : '摄像头启动失败';
      fatal(message);
    }
  }

  async function replayLatest() {
    if (!latest?.should_speak || running || replaying || voiceTestController.current) return;
    const controller = new AbortController();
    replayController.current = controller; setReplaying(true);
    try { await audio.current.unlock(); await audio.current.play(latest, config, controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setWarning(cause instanceof Error ? cause.message : '播放失败'); }
    finally { setReplaying(false); }
  }

  async function testBrowserVoice() {
    if (runningRef.current || replaying || voiceTestController.current) return;
    const controller = new AbortController();
    const runtimeConfig = cloneConfig(config);
    voiceTestController.current = controller;
    setPreviewKind('browser');
    setTestingVoice(true); setWarning('');
    try {
      await audio.current.unlock();
      await audio.current.previewBrowserVoice(runtimeConfig, controller.signal);
      if (!controller.signal.aborted) setWarning('试听播放已完成。如果没有听到声音，请检查标签页静音和系统声音输出。');
    } catch (cause) {
      if (!controller.signal.aborted) setWarning(cause instanceof Error ? cause.message : '浏览器声音试听失败');
    } finally {
      if (voiceTestController.current === controller) voiceTestController.current = null;
      setTestingVoice(false); setPreviewKind(null);
    }
  }

  async function testCharacterVoice() {
    if (runningRef.current || replaying || voiceTestController.current || !elevenlabsReady) return;
    const controller = new AbortController();
    const runtimeConfig = cloneConfig(config);
    voiceTestController.current = controller;
    setPreviewKind('elevenlabs'); setTestingVoice(true); setWarning('');
    try {
      await audio.current.unlock();
      if (controller.signal.aborted) return;
      const sample = await requestVoicePreview(runtimeConfig.narration.character, runtimeConfig.narration.language, controller.signal);
      await audio.current.play(sample, runtimeConfig, controller.signal);
      if (!controller.signal.aborted) setWarning('试听播放已完成。如果没有听到声音，请检查标签页静音和系统声音输出。');
    } catch (cause) {
      if (!controller.signal.aborted) setWarning(cause instanceof Error ? cause.message : 'ElevenLabs 声音试听失败');
    } finally {
      if (voiceTestController.current === controller) voiceTestController.current = null;
      setTestingVoice(false); setPreviewKind(null);
    }
  }

  const progress = Math.min(1, stats.count / config.capture.frame_count, stats.spanSeconds / Math.max(.1, config.capture.window_seconds - 2 / config.capture.sample_fps));
  const styleSelection = config.narration.style_mode === 'random' ? 'random' : config.narration.fixed_style;
  const uiStyles = styles.map(style => localizeStyle(style, uiLanguage));

  return <main className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="#"><span className="brand-mark">rn.</span> REALITY NARRATOR</a>
      <div className="header-tools">
        <div className="connection"><span className={`dot ${health ? 'green' : ''}`} />{t(connecting ? 'connecting' : health ? 'connected' : 'disconnected')}<button className="text-button" onClick={() => void refreshBackend()} disabled={connecting || running}>{t('refresh')}</button></div>
        <div className="ui-language" role="group" aria-label={t('uiLanguage')}>
          <span>{t('uiLanguage')}</span>
          <button type="button" lang="zh-CN" aria-pressed={uiLanguage === 'zh-CN'} onClick={() => setUiLanguage('zh-CN')}>中文</button>
          <button type="button" lang="en" aria-pressed={uiLanguage === 'en-US'} onClick={() => setUiLanguage('en-US')}>English</button>
        </div>
      </div>
    </header>

    <section className="intro"><div><p className="eyebrow">{t('introEyebrow')}</p><h1>{t('heroFirst')}<br /><em>{t('heroSecond')}</em></h1></div><p className="intro-copy">{t('introFirst')}<br />{t('introSecond')}<br /><span>{t('introDetail')}</span></p></section>

    {!health && !connecting && <div className="notice warning">{t('backendNotice')}</div>}
    {health && !selectedProvider?.configured && mode === 'live' && <div className="notice warning">{t('keyNotice', { key: config.narration.provider === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY' })}{health.demo_available && <button className="text-button" onClick={() => setMode('demo')}>{t('demoSuggestion')}</button>}</div>}
    {health && mode === 'live' && config.audio.provider === 'openai' && !health.tts.configured && <div className="notice warning">{t('ttsNotice')}</div>}
    {health && mode === 'live' && config.audio.provider === 'elevenlabs' && !elevenlabsReady && <div className="notice warning">{t('elevenlabsNotice')}</div>}
    {mode === 'demo' && <div className="notice demo"><strong>{t('demo')}</strong> · {t('demoNotice')}</div>}
    {error && <div className="notice error" role="alert">{localizeNotice(error, uiLanguage)}</div>}

    <div className="workspace">
      <section className="stage">
        <div className="panel-heading"><span><i className={`dot ${running ? 'orange' : ''}`} /> {t(`status_${status}`)}</span><span className="mono">{t(mode === 'live' ? 'liveVision' : 'demoVision')}</span></div>
        <div className={`camera-stage ${running ? 'active' : ''}`}>
          <video ref={video} autoPlay playsInline muted aria-label={t('previewLabel')} />
          {!running && <div className="camera-empty"><CameraIcon /><p>{t('cameraEmptyTitle')}</p><span>{t('cameraEmptyDetail')}</span></div>}
          {running && <><div className="camera-tag"><span className="dot orange" /> {t(mode === 'live' ? 'liveCamera' : 'demoCamera')}</div><div className="corner top-left" /><div className="corner top-right" /><div className="corner bottom-left" /><div className="corner bottom-right" /></>}
          {running && status === 'observing' && <div className="capture-progress"><span>{t('captureProgress')} <b>{Math.round(progress * 100)}%</b></span><div><i style={{ width: `${progress * 100}%` }} /></div></div>}
        </div>
        <div className="stage-footer"><span className="mono">{t('frameStats', { count: stats.count, mb: (stats.bytes / 1024 / 1024).toFixed(1) })}</span><span>{t('videoOnly')}</span></div>
        <div className="caption-card" aria-live="polite"><div className="caption-meta"><span className="eyebrow">{t('narrator')}</span><span>{latest ? (latest.character ? characterLabel(latest.character) : localizeStyle(latest.style, uiLanguage).label) : t('firstComment')}</span></div><p>{latest?.should_speak ? latest.narration : t(latest ? 'silence' : 'initialCaption')}</p><div className={`sound-bars ${status === 'speaking' || replaying ? 'playing' : ''}`} aria-hidden="true">{Array.from({ length: 22 }, (_, index) => <i key={index} style={{ animationDelay: `${index * .07}s`, height: `${6 + (index * 13 % 22)}px` }} />)}</div></div>
        {warning && <div className="inline-warning" role="status">{localizeNotice(warning, uiLanguage)}</div>}
        <div className="batch-panel"><div className="section-row"><span className="eyebrow">{t('latestObservation')}</span><span>{latest ? t('timings', { vision: (latest.timings.vision_ms / 1000).toFixed(1), tts: (latest.timings.tts_ms / 1000).toFixed(1) }) : t('batchSize', { count: config.capture.frame_count })}</span></div><BatchPreview frames={batchFrames} language={uiLanguage} /><p className="observation-text">{latest?.observation || t('observationEmpty')}</p></div>
      </section>

      <aside className="controls"><div className="section-row"><span className="eyebrow">{t('director')}</span><span className="mono">{t('configBadge')}</span></div><h2>{t('controlsTitle')}</h2>
        <label className="select-field">{t('runMode')}<select value={mode} disabled={running || testingVoice} onChange={event => setMode(event.target.value as Mode)}><option value="live">{t('liveMode')}</option><option value="demo" disabled={!health?.demo_available}>{t('demoMode')}</option></select></label>
        <label className="select-field">{t('visionProvider')}<select value={config.narration.provider} disabled={running || mode === 'demo'} onChange={event => update('narration', 'provider', event.target.value)}><option value="openai">GPT / OpenAI{health && !health.providers.openai.configured ? t('keyMissing') : ''}</option><option value="deepseek">DeepSeek{health && !health.providers.deepseek.configured ? t('keyMissing') : ''}</option></select></label>
        {mode === 'live' && selectedProvider && <p className="field-note">{t('currentModel', { model: selectedProvider.model })}</p>}
        <label className="select-field">{t('camera')}<select value={deviceId} disabled={running} onChange={event => setDeviceId(event.target.value)}><option value="">{t('defaultCamera')}</option>{devices.filter(device => device.deviceId).map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || t('cameraNumber', { index: index + 1 })}</option>)}</select></label>
        <div className="parameter-grid"><NumberField label={t('frameCount')} value={config.capture.frame_count} min={6} max={18} unit={t('framesUnit')} disabled={running} onChange={value => update('capture', 'frame_count', value)} /><NumberField label={t('sampleFps')} value={config.capture.sample_fps} min={.5} max={10} step={.5} unit="fps" disabled={running} onChange={value => update('capture', 'sample_fps', value)} /><NumberField label={t('windowSeconds')} value={config.capture.window_seconds} min={2} max={30} step={.5} unit={t('secondsUnit')} disabled={running} onChange={value => update('capture', 'window_seconds', value)} /></div>
        <p className="field-note">{t('samplingNote', { seconds: config.capture.window_seconds, samples: Math.floor(config.capture.sample_fps * config.capture.window_seconds), count: config.capture.frame_count })}</p>
        <label className="select-field">{t('character')}<select value={config.narration.character} disabled={running || testingVoice} onChange={event => update('narration', 'character', event.target.value)}><option value="grandma">{t('grandmaCharacter')}</option><option value="skeptic">{t('skepticCharacter')}</option></select></label>
        <p className="field-note">{t(config.narration.character === 'grandma' ? 'grandmaNote' : 'skepticNote')}</p>
        <button className="secondary-button" disabled={running || replaying || !elevenlabsReady || (testingVoice && previewKind !== 'elevenlabs')} onClick={() => previewKind === 'elevenlabs' ? voiceTestController.current?.abort() : void testCharacterVoice()}>{t(previewKind === 'elevenlabs' ? 'stopTest' : 'testCharacterVoice')}</button>
        <p className="field-note">{t(elevenlabsReady ? 'characterPreviewNote' : 'elevenlabsSetupNote')}</p>
        <label className="select-field">{t('style')}<select value={styleSelection} disabled={running} onChange={event => setConfig(previous => ({ ...previous, narration: { ...previous.narration, style_mode: event.target.value === 'random' ? 'random' : 'fixed', fixed_style: event.target.value === 'random' ? previous.narration.fixed_style : event.target.value as StyleId } }))}><option value="random">{t('randomStyle')}</option>{uiStyles.map(style => <option value={style.id} key={style.id}>{style.label}</option>)}</select></label>
        {config.narration.style_mode === 'random' ? <fieldset className="style-pool" disabled={running}><legend>{t('stylePool')}</legend>{uiStyles.map(style => <label key={style.id}><input type="checkbox" checked={config.narration.style_pool.includes(style.id)} onChange={event => update('narration', 'style_pool', event.target.checked ? [...config.narration.style_pool, style.id] : config.narration.style_pool.filter(id => id !== style.id))} />{style.label}</label>)}</fieldset> : <p className="field-note">{uiStyles.find(style => style.id === config.narration.fixed_style)?.description}</p>}
        <label className="select-field">{t('speechLanguage')}<select value={config.narration.language} disabled={running || testingVoice} onChange={event => setConfig(previous => ({ ...previous, narration: { ...previous.narration, language: event.target.value as 'zh-CN' | 'en-US' }, audio: { ...previous.audio, browser_voice_uri: '' } }))}><option value="zh-CN">{t('chinese')}</option><option value="en-US">{t('english')}</option></select></label>
        <label className="select-field">{t('audioProvider')}<select value={mode === 'demo' ? 'browser' : config.audio.provider} disabled={running || testingVoice || mode === 'demo'} onChange={event => update('audio', 'provider', event.target.value)}><option value="browser">{t('browserAudio')}</option><option value="openai">{t('openaiAudio')}</option><option value="elevenlabs">{t('elevenlabsAudio')}</option></select></label>
        {mode === 'demo' || config.audio.provider === 'browser' ? <>
          <label className="select-field">{t('browserVoice')}<select value={availableVoices.some(voice => voice.voiceURI === config.audio.browser_voice_uri) ? config.audio.browser_voice_uri : ''} disabled={running || testingVoice} onChange={event => update('audio', 'browser_voice_uri', event.target.value)}><option value="">{t('automaticVoice')}</option>{availableVoices.map(voice => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {t(voice.localService ? 'localVoice' : 'onlineVoice')}</option>)}</select></label>
          <button className="secondary-button" disabled={running || replaying || (testingVoice && previewKind !== 'browser')} onClick={() => previewKind === 'browser' ? voiceTestController.current?.abort() : void testBrowserVoice()}>{t(previewKind === 'browser' ? 'stopTest' : 'testVoice')}</button>
          <p className="field-note">{t('voiceNote')}</p>
        </> : <p className="field-note">{config.audio.provider === 'elevenlabs' ? t('elevenlabsVoiceNote', { voice: characterLabel(config.narration.character) }) : t('cloudVoiceNote', { voice: health?.tts.voice || 'onyx' })}</p>}
        <details className="advanced"><summary>{t('advanced')}</summary><div className="advanced-grid"><NumberField label={t('imageWidth')} value={config.capture.image_width} min={320} max={1280} step={160} unit="px" disabled={running} onChange={value => update('capture', 'image_width', value)} /><NumberField label={t('jpegQuality')} value={config.capture.jpeg_quality} min={.2} max={.95} step={.05} disabled={running} onChange={value => update('capture', 'jpeg_quality', value)} /><NumberField label={t('maxCharacters')} value={config.narration.max_characters} min={20} max={240} unit={t('charactersUnit')} disabled={running} onChange={value => update('narration', 'max_characters', value)} /><NumberField label={t('cooldown')} value={config.loop.cooldown_seconds} min={0} max={30} step={.5} unit={t('secondsUnit')} disabled={running} onChange={value => update('loop', 'cooldown_seconds', value)} /><NumberField label={t('requestTimeout')} value={config.loop.request_timeout_seconds} min={10} max={120} unit={t('secondsUnit')} disabled={running} onChange={value => update('loop', 'request_timeout_seconds', value)} /><NumberField label={t('maxAge')} value={config.loop.max_result_age_seconds} min={5} max={180} unit={t('secondsUnit')} disabled={running} onChange={value => update('loop', 'max_result_age_seconds', value)} /><NumberField label={t('historySize')} value={config.loop.history_size} min={0} max={10} unit={t('linesUnit')} disabled={running} onChange={value => update('loop', 'history_size', value)} /><NumberField label={t('speechRate')} value={config.audio.speech_rate} min={.6} max={1.5} step={.1} unit={t('rateUnit')} disabled={running} onChange={value => update('audio', 'speech_rate', value)} /></div><label className="volume-label">{t('volume')} {Math.round(config.audio.volume * 100)}%<input type="range" min={0} max={1} step={.05} value={config.audio.volume} disabled={running} onChange={event => update('audio', 'volume', Number(event.target.value))} /></label><button className="text-button" disabled={running} onClick={() => setConfig(cloneConfig(serverDefaults.current))}>{t('resetDefaults')}</button></details>
        {configErrors.length > 0 && <div className="config-errors" role="alert">{configErrors.map(message => <p key={message}>{localizeNotice(message, uiLanguage)}</p>)}</div>}
        <button className={`primary-button ${running ? 'stop-button' : ''}`} disabled={!running && (!canStart || connecting || replaying || testingVoice)} onClick={() => running ? stop() : void start()}>{t(running ? 'stop' : 'start')}<span>{t(running ? 'cut' : 'action')}</span></button><button className="secondary-button" disabled={running || replaying || testingVoice || !latest?.should_speak} onClick={() => void replayLatest()}>{t(replaying ? 'replaying' : 'replay')}</button>
        <p className="control-footnote">{t('settingsNote')}<br />{t('promptNote')}</p>
      </aside>
    </div>

    <section className="transcript-section"><div className="section-row"><span className="eyebrow">{t('historyEyebrow')}</span><span className="mono">{t('historyCount', { count: history.length })}</span></div><h2>{t('historyTitle')}</h2>{history.length ? <div className="transcript-list">{history.map((item, index) => <article className="transcript" key={item.batch_id}><span className="transcript-number">{String(history.length - index).padStart(2, '0')}</span><div><p>{item.narration}</p><span>{item.character && <>{characterLabel(item.character)} · </>}{localizeStyle(item.style, uiLanguage).label} · {item.mode === 'demo' ? t('demoSource') : item.vision_provider === 'deepseek' ? 'DeepSeek' : 'GPT'} · {t(item.audio_source === 'elevenlabs' ? 'elevenlabsSource' : item.audio_source === 'openai' ? 'openaiSource' : 'browserSource')} · {t('historyMeta', { count: item.frameCount, seconds: item.windowSeconds.toFixed(1), age: item.capturedAgeSeconds.toFixed(1) })}</span></div><time>{new Date(item.receivedAt).toLocaleTimeString(uiLanguage, { hour12: false })}</time></article>)}</div> : <div className="history-empty">{t('historyEmpty')}</div>}</section>
    <footer className="footer"><span>{t('footerEdition')}</span><span>{t('footerTagline')}</span></footer>
  </main>;
}
