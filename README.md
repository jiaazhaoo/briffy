# DailyLogs 🐱

> **briffy 桌面端。** briffy 是这一系列产品的统称，核心只有一件事：**把你一天里看到的、听到的、收到的东西记下来**。
> 本仓库当前存放桌面端（Windows / macOS，Electron，MIT）。移动端（iOS / Android）和更早的版本另行保管。

一只常驻在屏幕右下角的小猫，帮你把一天里看到的、听到的、收到的东西自动记进工作区：

| 动作 | 效果 |
| --- | --- |
| **单击小猫** | 截整个屏幕，原图保存 + OCR，同时复制到系统剪贴板 |
| **双击小猫** | 框选截图：屏幕冻结后拖拽选区，回车确认、Esc 取消，同样保存 + OCR + 复制 |
| **中键点击小猫**（或长按 0.55 秒） | 开始 / 结束录音。触控板没有中键，长按是等价操作 |
| Ctrl+Alt+A（macOS Cmd+Shift+A） | 框选截图 |
| Ctrl+Alt+S（macOS Cmd+Shift+S） | 整屏截图 |
| Ctrl+Alt+V（macOS Cmd+Shift+V） | 开始 / 结束录音 |
| 把图片 / 文件 / 链接 / 文字拖到小猫身上 | 存入工作区（图片会 OCR，PDF 和网页会读取内容） |
| 右键小猫 / 托盘图标 | 打开工作区、设置、手动生成摘要、隐藏小猫、退出 |
| 复制任何东西（Ctrl+C / Cmd+C） | 剪贴板里的文字、图片、文件都会实时存入工作区并打五个词 |
| 浏览器里按 Alt+Shift+D | 浏览器扩展列出当前网页所有图片 / 视频 / 音频，勾选后一键存入工作区 |

所有存进工作区的东西都会被 AI 概括成 **五个词**（外加一个标题和一句话摘要）。每天到设定时间（默认 08:00）小猫会为昨天的记录生成一份摘要，并弹出通知。

截图会同时进系统剪贴板（像微信截图那样，截完可以直接粘贴），但**不会因此被记录两次**——程序会让剪贴板监听器跳过自己刚放进去的那张图。不想进剪贴板可以在 设置 › 截图快捷键 里关掉。

**不做任何翻译**：OCR 文字、语音转写、五个词、标题和摘要都保持内容本身的语言；每日摘要用你选的第一语言书写，但引用的标题和词条原样保留。

AI 服务可以四选一（设置 › AI 服务）：

| 来源 | 说明 |
| --- | --- |
| Claude (Anthropic) | 填 API Key，或选「已登录的 Claude 账号」：点按钮在终端里运行 `ant auth login` 用浏览器登录一次，之后 SDK 自动使用该账号 |
| OpenRouter | 点「用 OpenRouter 账号登录」在浏览器里授权即可拿到 Key（OAuth PKCE，不用手抄），模型任选（默认 `anthropic/claude-opus-5`，列表可刷新、带图片能力和价格） |
| 本地模型 (Ollama) | 自动检测 CPU / 内存 / 显卡，推荐一个跑得动的 Qwen 3.5 尺寸（0.8b～27b），一键下载；没装 Ollama 会给下载链接 |
| 自定义 OpenAI 兼容接口 | LM Studio、llama.cpp server、vLLM、DeepSeek 等，填 base URL + 模型名（+ 可选 Key） |

支持 Windows 和 macOS（Apple Silicon；Intel Mac 缺少本地语音识别的预编译库，其它功能可用）。

## 运行

```bash
npm install
npm start
```

`npm install` 里的 `postinstall` 会自动下载 Electron 运行时（约 367 MB，只需一次）。**Electron 44 起官方删掉了自己的 postinstall 钩子**，装完不会自带二进制，所以这一步由本项目的 `package.json` 接管；如果哪次漏了，手动补一句 `npx install-electron` 即可。

只有打包才需要 `npm run fetch-models`（`npm run dist:*` 会自动先跑）。日常开发不用——缺什么模型程序会在第一次用到时自己下。

**不需要任何配置步骤**：第一次启动时程序自己检查这台电脑并准备好本地的文字识别和语音识别引擎，需要下载时小猫会在气泡里说一声。设置 › 本机准备情况 里能看到结果，每一项都可以自己改，也能点「重新检查」再跑一遍。

其余可以手动调整的：

1. 右键小猫 → **设置**，选择两个语言包（默认 简体中文 + English）。语言包同时用于 OCR、语音识别和界面语言；第一个语言决定界面与摘要用什么语言写。
2. 在 **AI 服务** 里选一种来源并点 **测试**。所有 Key 都用系统密钥库（Windows DPAPI / macOS Keychain）加密保存；也可以通过环境变量提供（`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`）。什么都不配时程序仍可用：五个词退化为本地关键词提取，摘要退化为清单。
3. macOS 需要在「系统设置 › 隐私与安全性」里给应用 **屏幕录制** 和 **麦克风** 权限（开发时授权对象是 Electron）。为了让小猫能浮在全屏应用之上，macOS 上程序以菜单栏（托盘）应用的形式运行，点击托盘小猫图标可打开菜单。
4. 语音识别默认用 `whisper-small`（约 250 MB，首次录音时下载）。设置里的「识别语言」默认为「自动检测（所有语言）」：每次录音先判断说的是 Whisper 支持的 99 种语言里的哪一种，再按该语言原样转写；也可以改成只在两个语言包之间判断（更稳），或固定成某一种。`tiny`/`base` 更快但中文准确率明显更低。

## 工作区目录

默认在 `<用户数据目录>/workspace`（Windows：`%APPDATA%\dailylogs\workspace`，macOS：`~/Library/Application Support/dailylogs/workspace`），可在设置里改：

```
workspace/
  entries/2026-09-03.json     # 每天一个索引：标题、五个词、OCR/转写文字、状态
  screenshots/2026-09-03/     # 截图原图 PNG
  audio/2026-09-03/           # 录音原始 webm + 16kHz wav
  files/2026-09-03/           # 拖入的文件副本、笔记 .txt、下载的 PDF
  summaries/2026-09-02.md     # 每日摘要（Markdown）+ .json 元数据
```

超过 200 MB 的文件不复制，只记录原路径。

## 技术组成

- **Electron 44**：浮动透明窗口（小猫）+ 免点击的气泡窗口 + 工作区窗口 + 托盘。
- **OCR（和大模型完全无关）**：**PP-OCR（PaddleOCR）v6** 的 ONNX 模型，通过 `onnxruntime-node` 本地推理。`v6-tiny`（6 MB）和 `v6-small`（30 MB）**两个模型都内置在安装包里**，启动时自动选一个：

  - 判据是内存、核心数和一次约 160 ms 的 CPU 测速（`hardware.js` 里的 `cpuProbe`，跑一次 384×384 矩阵乘法）。内存 ≥ 8 GB、核心 ≥ 4、测速不超过参考机三倍（≤ 160 ms）就用 `v6-small`，否则 `v6-tiny`。
  - 结果写进设置（`ocrModelAuto`），可在设置里手动指定覆盖。
  - 会自我纠正：如果自动选中的模型连续多次单张超过 6 秒（取中位数），自动降回 `v6-tiny` 并在气泡里说明一次。
  - 语言优先于性能：选了日文 / 韩文这类 tiny 覆盖不了的语言时，会用能覆盖该语言的模型（必要时下载）。

  其他语种（日、韩、阿拉伯、泰、俄、拉丁语系）的专用模型按需下载到 `<用户数据目录>/ocr-models`。OCR 只做文字识别，任何 AI 服务的切换都不影响识别结果。

  运行参数是按笔记本调的，不是按跑分调的：线程数取核心数的一半（2～4 个）、关掉 onnxruntime 的内存池、检测输入最长边压到 1280 px。在一张 2560×1440 的中文截图上实测（Ryzen 5 5600X）：

  | 模型 | 单次耗时 | 内存峰值 | 说明 |
  | --- | --- | --- | --- |
  | v6-tiny（默认） | 约 0.8 秒 | 约 420 MB | 内置，中英够用 |
  | v6-small | 约 2.7 秒 | 约 650 MB | 更准，多语言 |

  用默认参数（占满所有核心、开内存池、不限尺寸）时 v6-tiny 要 750 MB 和 4.5 秒 CPU 时间，识别结果反而不比现在好。空闲 2 分钟后模型会被卸载，内存归还系统。
- **语音转文字**：`@huggingface/transformers` + `onnxruntime-node` 本地运行 Whisper（默认 `whisper-small`，可换 tiny/base/medium）。模型首次录音时下载到 `<用户数据目录>/models`，之后离线。国内网络可在设置里填镜像 `https://hf-mirror.com/`。转写前先在两个语言包之间做一次语言判别（transformers.js 本身不会自动检测语言，不指定就会当成英文并把中文“翻译”掉）；中文结果用 `opencc-js` 统一成你选的简体 / 繁体。
- **五个词 & 摘要**：`src/main/llm.js` 统一调度四种来源。Claude 走 Anthropic SDK（默认 `claude-opus-5`，结构化输出 + 服务端 refusal fallback，PDF 直接作为文档送入）；OpenRouter 和自定义接口走 OpenAI 兼容的 chat/completions（JSON schema 不支持时自动降级）；Ollama 走原生 `/api/chat`（`format` 结构化输出、自动关闭 Qwen 的 thinking、非视觉模型自动去掉图片）。截图以图片 + OCR 文本送入；PDF 先用 `pdf-parse` 本地抽文字（也用于搜索）；网页抓正文后送入。本地模型的输入会按上下文长度截断。
- **硬件检测 & 推荐**：`src/main/hardware.js` 读取 CPU / 内存 / 显卡（Windows 用 nvidia-smi 或注册表里的显存大小，macOS 用 system_profiler，Apple Silicon 按统一内存算），按显存 / 内存预算推荐 `qwen3.5:0.8b / 2b / 4b / 9b / 27b`，备选 `gemma3:4b`。

## 体积

| | 大小 |
| --- | --- |
| Windows 安装包（`DailyLogs Setup 0.1.0.exe`） | **171 MB** |
| 安装后占用 | 562 MB |
| 其中 Electron 运行时本身 | 约 300 MB（安装包里约 100 MB），无法再压缩 |

安装包里已经**内置**英文语音转文字（Whisper tiny.en，42 MB）和两档中英文字识别（PP-OCRv6 tiny 6 MB + small 30 MB，按机器性能自动选），装完断网也能直接用。其他语言的模型（中文语音、日韩阿拉伯文识别、更大的 Whisper）按需下载到用户数据目录，不进安装包。

为了控制体积做的取舍：去掉 Tesseract（PP-OCR 更好且更小）、排除 onnxruntime 的浏览器版和非当前平台的二进制、排除 DirectML 执行提供程序（我们跑 CPU）、Chromium 只保留 en-US / zh-CN / zh-TW 三个语言包。

## 打包

```bash
npm run fetch-models   # 下载要内置进安装包的英文语音 + 中英 OCR 模型（约 47 MB，只需一次）
npm run dist:win       # Windows NSIS 安装包，输出到 release/
npm run dist:mac       # macOS dmg（需在 macOS 上执行）
```

`dist:*` 会自动先跑 `fetch-models`。`bundled-models/` 不进版本库。

原生依赖（onnxruntime、tesseract 的 wasm）已在 `package.json > build.asarUnpack` 中声明。

## 浏览器扩展（采集网页图片 / 视频）

`extension/` 是一个 Chrome / Edge 扩展（Manifest V3），原理和 AixDownloader 一类工具一样：**扫描页面 DOM**（`img` / `video` / `audio` / `srcset` / 懒加载属性 / CSS 背景图 / 指向媒体文件的链接，含 iframe）+ **监听网络响应**（按 Content-Type 抓 mp4、m3u8、mpd、图片，过滤掉 ts 分片和追踪像素），两边合并去重后列出来。

**安装**：记录页右上角有一个状态灯——没装时显示「装浏览器扩展」，点一下会在你的默认浏览器里打开一个引导页（`http://127.0.0.1:47831/install`），上面有可复制的 `chrome://extensions/` 地址和扩展文件夹路径，装好后那个页面**自己变绿**，App 里的状态灯也变成「扩展已连接」。

（浏览器出于安全不允许外部程序直接跳转到 `chrome://extensions`，所以只能复制粘贴这一步需要手动。默认浏览器是 Edge 时地址会自动换成 `edge://extensions/`。）

手动的三步是：

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本项目的 `extension/` 文件夹（或用 App 里的「导出扩展文件夹…」复制一份到别处）。
3. 在任意网页点扩展图标，或按 `Alt+Shift+D`。

扩展装好后每 5 分钟向 App 报一次到（`chrome.alarms`），所以状态灯不需要你先打开扩展面板就能变绿；连续两次没报到（11 分钟）就算断开。

判断"是不是真的扩展"只认浏览器自己写的请求头（`Origin: chrome-extension://…` 加上 `Sec-Fetch-*`），网页脚本和命令行都伪造不了，所以状态灯不会假绿。这条有回归测试：`node dev/api-test.js` 会在独立端口上跑一遍五种伪造场景。

面板里可以按类型（图片 / 视频 / 音频）和最小边长筛选、全选、单选，勾好后「发送到 DailyLogs」。图片由扩展带着页面 cookie 和 Referer 下载后传给 App（能拿到防盗链的图）；视频默认只记录地址和来源页面，勾上「同时下载视频 / 音频文件」才会真的下载。

App 这边监听 `http://127.0.0.1:47831`（只绑定本机，要求扩展带自定义请求头，端口可在设置里改，也可以整个关掉）。收到的条目会标记来源为「🧩 网页」，并带上来源页面标题、图片的 alt 文本，一起交给 AI 生成五个词。

## 小动物形象

小猫是**一张图片套一个圆框**：可见的圆 54px，窗口 80×80——多出来的 13px 透明边是给投影、录音红圈和每个动作留的余量，不然放大一下就会被窗口的矩形边裁掉。圆形、白边、投影和所有状态特效（录音红圈 + 麦克风角标、思考小点、快门闪光、摘要角标）都在 `pet.css` 里画，跟图片内容无关——所以换一张图就换了一只宠物，不用重画任何东西。同一张图也是工作区左上角的头像，选了就一起变。

它会动，但很克制：平时只是慢慢呼吸（从底部往上微微涨），每 7.5 秒蹦一小下，每 11 秒往上探一下头；录音时随红圈一起微微鼓动，处理时歪头往上看，截图时吓一跳，成功时蹦一下，失败时抖一抖。圆框里的东西**一律不加 transform、一律自己就是圆的**（探头是改 `top`）——Chromium 会让带 transform 的子元素逃出父级的圆形裁剪，露出方角。

**所有消息都从它嘴里说**：录音计时、已存入、摘要好了、出错了……全部走漫画式的对话气泡（白底、墨线描边、硬阴影、尾巴斜着指向小猫）。系统通知只在小猫被隐藏、没气泡可说的时候才作为兜底出现。

**朝向统一**：库里的形象一半从左下角冒出来、一半从右下角。我们统一成**从右下往左上**——换装时 `src/main/orient.js` 看图片两侧边缘哪边"贴"着角色，贴左边的就水平镜像（`nativeImage` 位图直接翻，无损）。设置网格里的缩略图也按同样的规则预先标好了（`catalog.json` 里的 `f: 1`，`npm run pet:orient` 重算，3448 张里 1511 张需要镜像）。

**在设置里挑**：右键小猫 → 设置 → 小动物形象，[ipaslogo.com](https://ipaslogo.com) 上 3448 个免费形象（可免费商用）全在里面，每个都套着和小猫一样的圆框，搜 `cat` / `owl` / `fox` 再点一下就换上了。

实现分三块：

| 文件 | 干什么 |
| --- | --- |
| [scripts/pet-catalog.js](scripts/pet-catalog.js) | `npm run pet:catalog`，把整个库快照成 [assets/pet/catalog.json](assets/pet/catalog.json)。站点是纯静态 SPA，目录直接烤在它的 bundle 里，没有接口可调，所以是从首页找到 bundle 再解析出来的。只存 id、名字和每张图的背景色（约 250 KB） |
| [src/main/petskin.js](src/main/petskin.js) | 目录读取 + 换装。挑中一个才下载那一张原图，`nativeImage` 缩到 240×240 存进 userData（安装后 `assets/` 是只读的），装好之后小猫再也不碰网络 |
| 设置里的网格 | 只有 id 和背景色过 IPC，图片从 CDN 懒加载，网格滚到底再续 240 个，所以 3448 条也是秒开。没加载出来之前先用各自的背景色占位 |

内置的默认形象是库里的 `Cat 3`（深蓝猫 + 珊瑚红底，小尺寸下最清楚）。想换内置默认：

```bash
npm run pet:avatar -- https://cdn.ipaslogo.com/logos/xxxx.png   # 或者本地图片
npm run pet:avatar -- --default                                 # 重新生成内置默认
```

原来那只手绘的猫还留在 [assets/pet/default-cat.svg](assets/pet/default-cat.svg)，想要的话 `npm run pet:avatar -- assets/pet/default-cat.svg`。

**注意**：设置里的缩略图是直接连 ipaslogo.com 的 CDN 的（`img-src` 里放行了那一个域名），也就是说浏览形象时会走他们的流量。只有浏览时需要联网，选中之后那张图就落到本地了。

### 想要透明底、全身、多表情的那种

如果不满足于圆框头像，`.claude/skills/pet-as-character/` 里有一套完整的生成流程——改自公开项目 [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill)，但**不生成图标**：改成透明底、居中全身、一只角色画 8 帧表情（`idle` `blink` `capture` `think` `listen` `happy` `sad` `sleep`），且每帧都拿选定的那张当参考图，保证是同一只。三个方向和每帧姿势写在 [scripts/pet-brief.json](scripts/pet-brief.json)。

```bash
npm run pet -- identity --dry-run   # 只写出提示词，不调 API（assets/pet/raw/*.txt）
npm run pet -- identity             # 六个候选：A1 A2 B1 B2 C1 C2
npm run pet:cutout                  # 抠图 + 裁切 + 缩放，并拼出 assets/pet/candidates.png
npm run pet -- frames --from assets/pet/raw/B1.png   # 选定后画 8 帧
```

需要画图模型的 Key：`OPENAI_API_KEY`（`gpt-image-2`，能直接出透明底）、`GEMINI_API_KEY` 或 `OPENROUTER_API_KEY`（出纯色底，由 `scripts/pet-cutout.js` 抠掉）。`npm run pet:electron -- identity` 会走 Electron，直接复用设置里存好的 OpenRouter Key。抠图是从四条边往里漫水填充，角色内部和背景同色的地方不会被误抠，边缘按颜色距离给半透明并反解掉溢色。走这条路要另外改 `pet.css`，把圆框换成透明贴图。

## 界面预览（改样式用）

```bash
node dev/preview/serve.js
```

然后在浏览器打开 http://localhost:5173/ （工作区，带假数据）、/pet （小猫，可加 `?zoom=3&state=success` 看各状态）、/bubble （气泡）。这些页面直接引用 `src/renderer` 里的真实 CSS / JS，只是把 Electron 的 IPC 换成了 `dev/preview/mock-*.js`，改完样式刷新即可看到。

## 开发自检

无人值守的自测模式，会自动打开工作区、执行一次动作、等处理完成后把结果打印到终端（`SMOKE_RESULT …`）并退出：

```bash
# bash / zsh
DAILYLOGS_SMOKE=1 DAILYLOGS_SMOKE_OUT=./smoke.png npm start
```

```powershell
# PowerShell
$env:DAILYLOGS_SMOKE='1'; $env:DAILYLOGS_SMOKE_OUT='.\smoke.png'; npm start
```

| `DAILYLOGS_SMOKE` | 动作 | 额外变量 |
| --- | --- | --- |
| `1` | 截图 + OCR + 五个词 | — |
| `audio` | 用一个 wav 文件走语音转文字 | `DAILYLOGS_SMOKE_WAV=<wav>` |
| `url` | 抓取网页并打标签 | `DAILYLOGS_SMOKE_URL=<url>` |
| `files` | 拖入文件（用分号分隔多个路径） | `DAILYLOGS_SMOKE_FILES=a;b` |
| `summary` | 生成某天的摘要 | `DAILYLOGS_SMOKE_DATE=YYYY-MM-DD` |

`DAILYLOGS_SMOKE_TAB=entries|summaries|settings` 决定退出前停在哪个页面，`DAILYLOGS_SMOKE_OUT` 会把最终屏幕截图存成 PNG。

开发时终端里会出现一行 tesseract 的 `Failed loading language '…'` 提示，是 tesseract.js 7 同时加载两个语言包时的已知噪音，不影响识别结果。
