# 验证记录

本源码包的验证结果：

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
