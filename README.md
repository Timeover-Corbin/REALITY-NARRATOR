# Reality Narrator · 现实嘲讽旁白 AI

摄像头观察现实，截取一组图片，AI 理解可见动作并生成简短旁白，TTS 合成语音，浏览器播放。播放完再处理最新画面。没有固定一分钟延迟，也不需要录制或回放视频。

## 快速启动（Windows / macOS / Linux）

需要 **Python 3.11+（建议3.12）和 Node.js 20+**。先解压整个目录，终端进入 `reality-narrator`。

```bash
python scripts/start.py --demo
```

第一次会创建 Python 虚拟环境、安装前后端依赖、复制 `backend/.env.example` 为 `backend/.env`，并启动两项服务。打开 `http://localhost:5173?mode=demo`，允许摄像头，点击开始。

**演示模式使用预设示例和浏览器语音，不进行图像识别，界面会明确标注。** 浏览器语音取决于本机安装的声音；建议在最终演示电脑上检查中文/英文声音。

实时模式：在 `backend/.env` 填入 `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY`，只用哪家就填哪家的 Key。检查对应视觉模型名，重新启动：

```bash
python scripts/start.py --skip-install
```

选择“实时识别 · AI 旁白”，再选择 GPT 或 DeepSeek。语音默认是浏览器朗读，可以独立切换为 OpenAI 云端语音。API Key 始终留在后端，页面不会接收或保存它。每个批次调用一次所选视觉模型；浏览器语音不调用云端TTS，云端语音则额外调用一次 OpenAI TTS。模型决定保持沉默时不合成或播放语音。

前端默认地址：`http://localhost:5173`。后端接口文档：`http://localhost:8000/docs`。Ctrl+C 同时关闭两项服务。`--open` 可以自动打开浏览器。

构建后只运行一个服务：

```bash
python scripts/start.py --production --skip-install
```

打开 `http://localhost:8000`。启动脚本会先构建前端，再让 FastAPI 提供静态页面和API。

## 三个独立的采样超参数

统一默认值在 `config/defaults.json`。页面也能修改，保存为本浏览器偏好，下次开始生效。修改默认JSON后重启/重建；页面“恢复默认参数”可清除旧偏好的影响。

| 参数 | 默认值 | 含义 |
|---|---:|---|
| `capture.frame_count` | 12 | 实际上传的图片数量，范围6～18 |
| `capture.sample_fps` | 3 | 每秒截图次数，范围0.5～10 |
| `capture.window_seconds` | 6 | 观察最近多少秒，范围2～30 |
| `capture.image_width` | 640 | 上传图片宽度，保持摄像头原始比例 |
| `capture.jpeg_quality` | 0.7 | JPEG质量 |
| `capture.max_buffer_mb` | 24 | 压缩图片缓存的字节预算，不包括浏览器解码开销 |
| `capture.max_frame_gap_seconds` | 2 | 原始采样的间隔容忍值，另有低帧率容差 |
| `loop.cooldown_seconds` | 1 | 一条旁白结束后的间隔 |
| `loop.request_timeout_seconds` | 50 | 单批次视觉＋TTS的整体超时 |
| `loop.max_result_age_seconds` | 60 | 结果返回时最新输入图片的年龄上限；这是过时结果门槛，不是固定延迟 |
| `loop.history_size` | 4 | 提供给AI的最近旁白数量 |
| `loop.max_consecutive_errors` | 3 | 连续失败达到此值后停止 |
| `narration.provider` | openai | GPT 或 DeepSeek，页面可切换 |
| `narration.language` | zh-CN | 中文或英文 |
| `narration.style_mode` | random | 随机或固定风格 |
| `narration.fixed_style` | deadpan | 固定风格ID |
| `narration.style_pool` | 五种风格 | 参与随机选择的风格池 |
| `narration.max_characters` | 90 | 旁白字符上限，英文也按字符计算 |
| `audio.provider` | browser | 浏览器朗读或 OpenAI 云端语音 |
| `audio.browser_voice_uri` | 空字符串 | 浏览器声音标识，留空则优先所选语言的本机声音 |
| `audio.volume` | 0.9 | 播放音量 |
| `audio.speech_rate` | 1 | 播放速率；云端WAV加速会同时改变音高 |

参数约束：`sample_fps × window_seconds >= frame_count`。例如3fps×6秒约有18张候选图片，再均匀选12张。采样定时器有误差，因此用真实时间戳判断覆盖范围，不通过图片数量推算时间。

摄像头显示保持正常帧率；上传给AI的是JPEG截图。首次积累约一个观察窗口。请求和播报期间继续采样，只保留最新窗口。当前旁白结束后再请求新批次，避免请求并发和语音排队。采样出现大间断、缓存不足或画面过旧时，不提交不完整批次。

## 修改 Prompt 和风格

- `backend/prompts/base.md`：共用指令、事实约束、语言、字数、最近旁白。
- `backend/prompts/styles.json`：五种原始旁白风格的文字指令和语音方向。
- `backend/app/prompts.py`：风格选择与模板组装。

初始风格是冷面游戏旁白、人类纪录片、日常行政报告、小事史诗、不可靠解说员。随机模式有多种可选风格时避免紧邻重复；Prompt也接收最近几句文案来减少内容重复。它们是初稿，后续可以集中改进幽默感。

Prompt文件每次请求读取，修改内容不需要重启。模板保留 `${style_instruction}`、`${language}`、`${max_characters}`、`${recent_narrations}` 四个占位符。新增风格ID时同步修改 `models.py` 的 `StyleId` 和前端类型/校验；改现有风格的文案无需修改代码。

## GPT / DeepSeek 与独立语音配置

页面中的“旁白模型”只选择一家进行图像识别和旁白生成，不会同时调用两家，也不会在视觉失败时自动切换供应商。6～18张截图按时间顺序一次发送给所选模型。

`backend/.env` 的配置示例：

```dotenv
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_VISION_MODEL=gpt-4.1-mini
DEEPSEEK_VISION_MODEL=deepseek-flash
OPENAI_API_BASE=https://api.openai.com/v1
DEEPSEEK_API_BASE=https://api.deepseek.com
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=onyx
```

默认值依据2026-10-10的官方文档：GPT默认使用支持图片输入和结构化输出的 `gpt-4.1-mini`；DeepSeek默认使用官方视觉文档中的 `deepseek-flash`。可以改成账号可用且支持相应输入/输出接口的模型，不要随意使用纯文字模型。实际账户权限、配额和调用延迟需要真实Key验证，当前未进行付费调用。

- GPT 通过 OpenAI Responses API 接收截图，并以严格JSON结构输出客观观察、旁白和是否播报。
- DeepSeek 通过其 OpenAI兼容 Chat Completions 接口接收截图，启用JSON输出并关闭思考模式，减少不必要的推理等待。
- 两个供应商都使用HTTPX直接调用REST接口，不额外安装OpenAI或DeepSeek SDK。

语音与视觉模型独立：

| 图片理解与旁白 | 语音 | 所需Key |
| --- | --- | --- |
| GPT | 浏览器 | OpenAI |
| DeepSeek | 浏览器 | DeepSeek |
| GPT | OpenAI云端 | OpenAI，账号同时有视觉与TTS权限 |
| DeepSeek | OpenAI云端 | DeepSeek + OpenAI |

**浏览器语音**使用Web Speech API，零额外Python/npm语音依赖，不需要单独的语音API Key。页面列出当前语言可用的声音，标注“本机”或“在线”，默认优先本机声音。在线声音仍需要网络；是否能离线朗读取决于设备上安装的本机声音。图像理解仍是云端调用，因此整个项目并非离线运行。设备缺少目标语言声音时，安装对应系统声音或选择云端TTS。

**OpenAI云端语音**把旁白文字发送至 `/audio/speech`，使用各风格中的 `voice_direction` 控制读法；返回24kHz单声道PCM，由后端包装为WAV，再由浏览器播放。不需要本地TTS模型、GPU或FFmpeg。修改音色可编辑 `OPENAI_TTS_VOICE`。如果合成超时、缺少OpenAI Key或服务失败，会保留真实识别的文字并明确提示尝试浏览器语音。浏览器语音失败则保留字幕并提示检查声音。

修改 `.env` 后重启后端。修改默认JSON后重启/重建，并在页面恢复默认参数。旧版浏览器参数会重置一次，以加载新的模型和语音配置。升级已有项目时，按新的 `.env.example` 添加上面的变量，原Gemini Key不用于这版代码。

官方参考：[OpenAI图片理解](https://developers.openai.com/api/docs/guides/images-vision)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[语音生成](https://developers.openai.com/api/docs/guides/text-to-speech)、[DeepSeek视觉接口](https://api-docs.deepseek.com/guides/vision/)、[浏览器本机声音](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)。

## 代码导航

| 文件 | 职责 |
|---|---|
| `frontend/src/App.tsx` | 界面、摄像头启动与释放、参数和旁白记录 |
| `frontend/src/buffer.ts` | JPEG采样、缓存上限、按时间均匀选帧 |
| `frontend/src/engine.ts` | 串行循环、停止、历史、超时后重试、过时结果丢弃 |
| `frontend/src/audio.ts` | 用户点击解锁Web Audio、云端音频、浏览器TTS、播放结束与中断 |
| `frontend/src/api.ts` | 图片上传、批次匹配、请求取消和超时 |
| `frontend/src/config.ts` | 默认配置、浏览器偏好、客户端配置校验 |
| `backend/app/main.py` | FastAPI接口、图片校验、并发限制、断开时取消任务 |
| `backend/app/provider.py` | GPT / DeepSeek视觉适配、独立OpenAI TTS与PCM包装 |
| `backend/app/service.py` | 视觉→旁白→语音，明确标注的演示模式 |
| `backend/app/models.py` | 配置与上传元数据校验 |
| `scripts/start.py` | 跨平台安装和启动 |

后端主要接口是 `POST /api/narrate`：multipart的 `metadata` 是JSON字符串，重复的 `frames` 字段是JPEG文件。返回旁白、风格、音频Base64、音频来源、批次编号及耗时。`GET /api/config` 返回非敏感默认参数和风格；`GET /api/health` 返回两家视觉供应商各自的Key配置状态、模型名和OpenAI TTS配置，但不返回Key本身。

## 手动启动与测试

后端（Windows虚拟环境目录为 `.venv/Scripts`，macOS/Linux为 `.venv/bin`）：

```bash
cd backend
python -m venv .venv
# Activate the virtual environment, then:
python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开终端启动前端：

```bash
cd frontend
npm ci
npm run dev
```

后端测试和前端检查：

```bash
# In backend, with its virtual environment active
python -m pytest -q
# In frontend
npm test
npm run build
```

测试使用模拟AI响应，覆盖图片与时间戳校验、GPT / DeepSeek请求与响应格式、PCM包装为有效WAV、保持沉默时跳过TTS、语音失败的明确回退、断开取消、停止后丢弃结果、串行播放、图片选择与缓存边界。运行记录见 `VALIDATION.md`。

## 演示检查

1. 在最终电脑选择正确摄像头和播报语言，确认扬声器可听。
2. 实时模式分别验证计划使用的供应商和语音组合；首次跑通后再缩短超时或窗口。
3. 做持续几秒的明显动作，例如拿杯子、转身或整理物品。
4. 查看批次缩略图和客观观察，判断识别是否与画面一致。
5. 播报中点击停止，确认声音与摄像头一起停止；再开始确认不会播放旧结果。

界面进入后台会暂停，返回后手动开始。摄像头需要localhost或HTTPS；本机服务默认只监听127.0.0.1。项目不保存摄像头录像，图片在浏览器和后端短暂处理，实时模式会把所选图片发送给配置的AI服务。

## 常见问题

- **后端未连接**：检查8000端口日志，确认两项服务都运行；点击刷新。
- **页面提示缺少Key**：编辑 `backend/.env`，重启。仅刷新页面不会让后端重新读取环境变量。
- **模型请求失败/404**：检查所选供应商的视觉模型是否支持图片输入，以及账户权限和接口地址。GPT需要Responses及结构化输出支持；DeepSeek需要兼容Chat Completions、图片输入及JSON输出。
- **429**：检查配额。程序有退避等待，连续失败会停止，避免不断发送请求。
- **浏览器语音没有声音**：确认对应语言声音已安装、页面由点击开始、音量大于0。云端语音也可以减少设备差异。
- **一直积累窗口**：检查参数关系、浏览器是否前台、JPEG宽度和缓存上限；低性能设备可降低截图频率或分辨率。
- **更新Prompt后随机没选到某风格**：暂时切到固定风格便于比较。

退出项目目录后再次运行，需要先回到解压后的 `reality-narrator` 根目录。源码包不包含API Key或已安装依赖。
