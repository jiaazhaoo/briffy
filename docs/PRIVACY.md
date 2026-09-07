# briffy 隐私政策 / Privacy Policy

**生效日期 / Effective:** 2026-09-07 · **版本 / Version:** 1.0 · 适用于 briffy 桌面端 (macOS / Windows)

---

## 一句话 / In one sentence

briffy 没有服务器。你的截图、录音、剪贴板和文件都留在你自己的电脑上；只有你自己配置了 AI 服务或外部连接时，被处理的那一条记录才会离开这台机器，直接发给**你自己的**账号。

briffy has no server. Your screenshots, recordings, clipboard and files stay on your own computer. Something leaves this machine only when you have configured an AI service or an external connection yourself — and then it goes directly to **your own** account with that provider, never to us.

---

## 1. briffy 收集什么 / What briffy records

briffy 把以下内容写进**你电脑上**的工作区目录（默认 `~/Library/Application Support/briffy/workspace`，可在设置里改）：

| 内容 | 来源 | 存在哪里 |
| --- | --- | --- |
| 截图原图 | 你点小猫、按快捷键、或框选 | `workspace/screenshots/` |
| 截图里的文字 | 本机 OCR（PP-OCRv6 + onnxruntime） | `workspace/entries/*.json` |
| 录音 | 你主动开始的语音笔记；**或者**你打开了「自动录音」之后，任何时候有人说话 | `workspace/audio/` |
| 语音转写、说话人分段 | 本机 Whisper / sherpa-onnx | `workspace/entries/*.json` |
| 剪贴板里的文字、图片、文件 | 你按 Cmd+C（可在设置里关掉） | `workspace/entries/`、`workspace/files/` |
| 拖进来的文件、链接、笔记 | 你拖到小猫身上 | `workspace/files/` |
| 你当时在看哪个应用、哪个窗口 | macOS 的窗口信息 | `workspace/entries/*.json` |
| 没有文字的图片里有什么 | 本机图像分类器 / macOS Vision | `workspace/entries/*.json` |
| 每日摘要 | 见第 2 节 | `workspace/summaries/` |
| 检索索引 | 上面这些的派生数据 | 工作区内 |
| 设置、以及你填的 API Key | 你自己填 | 设置文件；**Key 用 macOS 钥匙串加密**（`safeStorage`） |

**briffy 没有账号，不需要注册，也不认识你是谁。** 上面每一项都只写在磁盘上，删除工作区目录即全部消失。

---

## 2. 什么会离开这台电脑 / What leaves this machine

只有你自己开启的功能才会联网。默认安装、什么都不配的情况下，briffy 除了下载它需要的本地模型之外不发送任何东西。

### 2.1 AI 服务（写标题、摘要、回答提问）

你在 设置 › AI 服务 里四选一。选定之后，**被处理的那一条记录的内容**会发给该服务：截图图片本身、OCR 文字、PDF 正文、抓取到的网页正文，以及你在「问」里输入的问题和被检索到的记录摘录。

| 你选的 | 数据去哪 | 谁的隐私政策管这段 |
| --- | --- | --- |
| Claude (Anthropic) | `api.anthropic.com`，用你自己的 API Key 或你自己登录的 Claude 账号 | [Anthropic](https://www.anthropic.com/legal/privacy) |
| OpenRouter | `openrouter.ai`，用你自己授权得到的 Key，再由它转发给你选的模型提供方 | [OpenRouter](https://openrouter.ai/privacy) + 该模型提供方 |
| 自定义 OpenAI 兼容接口 | 你自己填的 base URL（LM Studio / vLLM / DeepSeek 等） | 你填的那一方 |
| 本地模型 (Ollama) | `127.0.0.1:11434`，**不出本机** | 无第三方 |

**这是转发，不是我们收集。** briffy 不保存、不代理、也看不到这些请求——它们从你的电脑直连服务商，用的是你自己的凭据。不想让任何内容离开本机，就选 Ollama，或者干脆不配 AI 服务：不配时程序照常可用，标题退回文件名，摘要退化为清单，「问」这一页仍然能在本地检索。

### 2.2 你主动接入的外部服务

| 服务 | 权限范围 | 做什么 |
| --- | --- | --- |
| Notion | 你在授权页勾选的页面 | 读取页面内容存进工作区 |
| Gmail | `gmail.readonly`（**只读**，不发信、不改标签、不删邮件） | 读取邮件存进工作区 |

OAuth 授权用的是你自己的凭据，令牌用系统钥匙串加密保存在本机。可以在 设置 里断开。

### 2.3 下载（不含任何用户数据）

| 目的地 | 为什么 |
| --- | --- |
| `huggingface.co`（或你填的 `hf-mirror.com`） | 下载语音识别模型 |
| `github.com/k2-fsa/sherpa-onnx/releases` | 下载说话人分段模型 |
| `ollama.com` | 列出可用的本地模型 |
| `api.zeroeval.com/leaderboard` | 一天一次读取公开的模型评测榜，用来推荐模型 |
| 你保存的那个网址本身 | 你存了一个链接，就得去读它 |

这些请求里**没有你的任何数据**——只有一个 `user-agent: briffy`。

### 2.4 本机端口

briffy 在 `127.0.0.1:47831` 上监听，只为浏览器扩展把当前网页的图片/视频交进来。只绑定本机、要求扩展自己的请求头，端口可改，也可以在设置里整个关掉。

---

## 2.5 自动录音，单独说 / Automatic listening, stated plainly

briffy 里有一个开关叫**自动录音**（设置 › 录音）。打开之后，briffy 会一直持有麦克风，**只要有人说话就存一段录音**——不需要你按任何键。

这是 briffy 唯一一件不问就做的事，所以把它讲全：

- **默认关闭。** 不打开它，麦克风只在你主动开始一段语音笔记时打开。
- 打开之后，**会议和通话会进工作区，不管当时有没有人打算记它**，包括房间里其他人的声音。
- macOS 会在菜单栏显示橙色的麦克风指示点，只要它在跑就一直亮着。
- 录音和转写**依然只写在本机**（`workspace/audio/`、本机 Whisper 转写）。但转写出来的文字会和其它记录一样，在你配了云端 AI 服务时被送去写标题和摘要。
- **录音别人是否合法，取决于你在哪里。** 有些国家和地区要求所有被录的人都同意。这一层 briffy 不能替你判断，也不替你承担；开这个开关之前请自己确认。

briffy 里有一个开关叫**剪贴板监听**，性质类似但只涉及你自己的操作：你每次 Cmd+C，内容会进工作区。可以在设置里关掉。

---

## 3. 我们不做什么 / What briffy does not do

- **没有遥测、没有分析、没有崩溃上报。** 代码里没有任何统计 SDK；这一条可以自己 `grep` 验证。
- **没有 briffy 的服务器。** 上面所有目的地都是第三方或本机，没有一个是我们的。
- **不做广告、不做画像、不追踪、不卖数据、不与任何人共享。**
- **不因为「同步」而上传。** briffy 不做云同步。
- **图片不会因为写摘要而被送去模型两次**；没有配 AI 服务时一次都不送。

---

## 4. 权限 / Permissions

| 权限 | 为什么 | 不给会怎样 |
| --- | --- | --- |
| 屏幕录制 | 截图 | 截图功能关闭，其它照常 |
| 麦克风 | 语音笔记 | 录音功能关闭，其它照常 |
| 自动化（Apple 事件） | 知道你当时在看哪个窗口；用 macOS 自带的图像识别描述图片 | 记录不带来源；无文字图片不描述 |
| 辅助功能 | 只有滚动长截图需要 | 长截图关闭 |
| 桌面/文档/下载文件夹 | 复制你拖进来或批量导入的文件 | 那些位置的文件导不进来 |

每一项都可以在「系统设置 › 隐私与安全性」里随时收回。

---

## 5. 你的数据由你处置 / Your data is yours

- **看**：工作区就是普通的文件夹，JSON + PNG + WAV + Markdown，用任何工具都能打开。
- **导出**：直接拷贝那个文件夹。
- **删**：删除工作区目录，或在应用内删除单条记录。没有回收站，没有副本。
- **搬**：在 设置 里换一个工作区位置。

**卸载**：删掉 briffy.app，再删掉 `~/Library/Application Support/briffy/`。钥匙串里名为 briffy 的条目可在「钥匙串访问」中删除。

---

## 6. 儿童 / Children

briffy 不面向 13 岁以下儿童，也不有意收集他们的信息。

## 7. 变更 / Changes

政策变更会更新本文顶部的版本与日期，并写进发布说明。实质性变更（例如新增一个会发送数据的目的地）会在应用内说明。

## 8. 联系 / Contact

<zhaojia789456@gmail.com> · [github.com/jiaazhaoo/briffy/issues](https://github.com/jiaazhaoo/briffy/issues)

---

## English summary

briffy is a local-first desktop app with **no backend, no account, and no telemetry**. Screenshots, voice notes, clipboard items, dropped files, on-device OCR text, on-device transcripts and daily summaries are written to a folder on your own computer and nowhere else.

Content leaves your machine only for features you turn on yourself:

- **The AI service you choose** (Anthropic, OpenRouter, a custom OpenAI-compatible endpoint, or a local Ollama) receives the content of the record being processed — the screenshot image, its OCR text, PDF or web-page text, and questions you type in Ask. The request goes straight from your computer to that provider under **your own** credentials; briffy neither stores nor proxies it. Choose Ollama, or configure nothing at all, and nothing leaves the machine.
- **Notion and Gmail**, if you connect them, are read with your own OAuth authorisation. The Gmail scope is `gmail.readonly` only.
- **Model downloads** from huggingface.co, github.com and ollama.com, plus one daily read of a public model leaderboard, carry no user data.

**One feature listens without being asked, and it is off by default.** With *automatic recording* turned on (Settings › Recording), briffy holds the microphone and files a recording whenever somebody speaks — meetings and calls end up in the workspace whether or not anyone meant them to, other people's voices included, and macOS shows the orange microphone indicator the whole time. Recordings and their on-device transcripts still never leave your machine. Whether recording other people is lawful depends on where you are; some jurisdictions require everyone's consent. That judgement is yours, not briffy's.

briffy runs no analytics, no crash reporting and no tracking of any kind, shares data with no one, and has no server of its own. Your workspace folder is plain JSON, PNG, WAV and Markdown: copy it to export, delete it to erase. Questions: <zhaojia789456@gmail.com>.
