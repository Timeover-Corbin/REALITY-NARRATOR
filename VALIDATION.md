# 验证记录

## 2026-10-11：ElevenLabs 接入和旁白提示词修改

本次运行环境为 Windows、Python 3.13.3、Node.js 25.2.1。前后端通过 `scripts/start.py --skip-install` 实际启动。

| 检查 | 结果及边界 |
|---|---|
| 后端 pytest | 最后的提示词调整后，全套 106 项通过，其中 ElevenLabs 和 prompt 相关测试 40 项 |
| 前端 Vitest | 25 项通过 |
| TypeScript 与 Vite 生产构建 | 通过 |
| Edge 页面交互 | 两个角色、语音来源、语言切换、试听完成、取消、付费错误中英文提示、偏好保存、Demo 保持浏览器语音均通过 |
| 页面显示 | 检查桌面和 390px 移动视口截图，移动视口没有横向溢出 |
| DeepSeek 真实请求 | 6 张人工生成的 640×360 空白测试图返回 HTTP 200，正确选择不说话；没有上传真实摄像头画面 |
| ElevenLabs 真实请求 | 两个角色试听均未取得音频；诊断请求返回 HTTP 402 `payment_required`，明确提示免费账户不能通过 API 使用 Voice Library 声音 |

新增自动测试覆盖供应商及 Key 路由、两个角色与中英文组合、PCM 包装及损坏/过长音频、超时取消、TTS 失败保留旁白并回退、无视觉 Key 的独立声音试听、配置不泄漏 Key，以及历史文本占位符不会再次展开。前端测试覆盖旧偏好迁移、角色校验、试听请求与响应校验、取消和超时。

浏览器交互使用受控的测试 WAV 和错误响应，不证明真实 ElevenLabs 音色或扬声器可听性。账户权限处理完成后，还需要在用户设备上试听两个真实音色。真实动作识别质量、讽刺的自然程度、多人指代和摄像头体验尚未验收。

健康接口只检查本地配置是否填写。ElevenLabs 语音详情查询另返回 Key 缺少读取声音权限；实际 TTS 的付费限制由合成请求独立确认。两者不是同一个问题。[官方 Voice Library 文档](https://elevenlabs.io/docs/eleven-creative/voices/voice-library)说明免费套餐不能通过 API 使用共享库声音。

下方保留原源码包的历史记录，不代表此次 Windows 验证范围。

## 原源码包记录

原源码包的验证结果：

| 检查 | 结果 |
|---|---|
| TypeScript类型检查与Vite生产构建 | 通过 |
| 前端Vitest | 10项通过 |
| 后端pytest | 38项通过 |
| 构建页面、JS/CSS资源与API共存 | 通过，包含于后端测试 |
| 跨平台启动脚本参数入口 | `python scripts/start.py --help` 通过 |
| 后端依赖锁定 | 使用平台条件，Windows不会安装uvloop |

前端测试覆盖按时间均匀选帧、图片唯一性、采样缺口、缓存上限、不完整窗口、参数关系、模型与语音独立配置、停止后丢弃返回、单请求和单音频串行、过时结果丢弃。

后端测试覆盖参数与时间戳、随机风格紧邻去重、旁白和音频返回、保持沉默时跳过TTS、TTS失败的明确回退、演示模式标注、WAV/PCM、损坏音频、GPT Responses / DeepSeek Chat Completions适配、按供应商路由Key、仅DeepSeek Key配浏览器朗读、DeepSeek配OpenAI TTS、云端语音缺Key时保留真实观察、TTS前截断文本、JPEG校验、6和18张图片边界、缺Key时不冒充实时识别、公开配置不泄漏Key、断开和超时取消、静态资源路由。

AI请求使用受控模拟响应验证请求与解析逻辑；未使用真实API Key，也未进行付费模型调用。浏览器声音发现、来源标记和选音色代码已完成构建检查；当前环境没有用于摄像头和扬声器的浏览器验收，因此没有宣称真实摄像头权限、音色、扬声器或实际模型识别质量已验证。

启动脚本提供Windows/macOS/Linux路径和进程清理分支；本次代码测试运行于Linux/Python3.12，未在Windows或macOS上实际启动。正式演示前按README中的演示检查完成一次本机验收。

后端测试有一条上游TestClient对httpx的弃用提示，不影响这38项测试；生产AI请求使用httpx AsyncClient，项目没有依赖TestClient运行。
