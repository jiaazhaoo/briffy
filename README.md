# briffy 🐱

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
| 复制任何东西（Ctrl+C / Cmd+C） | 剪贴板里的文字、图片、文件都会实时存入工作区 |
| 浏览器里按 Alt+Shift+D | 浏览器扩展列出当前网页所有图片 / 视频 / 音频，勾选后一键存入工作区 |

存进工作区的东西会拿到一个标题和一句话摘要；一张没有文字的图片，还会由本机的图像分类器说出画面里有什么。每天到设定时间（默认 08:00）小猫会为昨天的记录生成一份摘要，并弹出通知。

存进去的东西可以直接**问出来**：记录页旁边的「问」用一句话提问（「上周那个 Postgres 报错是怎么回事？」），程序先把问题里的时间和词翻成一批记录，再让 AI 只读这批记录作答，答案里每句话都标着它依据的第几条。

截图会同时进系统剪贴板（像微信截图那样，截完可以直接粘贴），但**不会因此被记录两次**——程序会让剪贴板监听器跳过自己刚放进去的那张图。不想进剪贴板可以在 设置 › 截图快捷键 里关掉。

**采集的原文一字不动，软件自己写的东西跟着你的语言**：OCR 文字和语音转写保持采集时的样子；而标题、摘要、每日摘要、以及一张没有文字的图片被识别出的内容，这些是软件对内容的描述、不是内容本身，一律用你选的第一语言书写。引用标题、人名、产品名和术语时原样保留，不做翻译。

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

同一个 `postinstall` 还会把界面用的五套字体（思源黑 / 思源宋 / Source Sans / Source Serif / IBM Plex Mono，全部 OFL，约 10 MB）下载到 `assets/fonts/`——应用离线运行，字体随包带走，不联网取字。断网装的话界面会退回系统字，之后补一句 `npm run fetch-fonts` 即可。

只有打包才需要 `npm run fetch-models`（`npm run dist:*` 会自动先跑）。日常开发不用——缺什么模型程序会在第一次用到时自己下。

**不需要任何配置步骤**：第一次启动时程序自己检查这台电脑并准备好本地的文字识别和语音识别引擎，需要下载时小猫会在气泡里说一声。设置 › 本机准备情况 里能看到结果，每一项都可以自己改，也能点「重新检查」再跑一遍。

其余可以手动调整的：

1. 右键小猫 → **设置**，选择两个语言包（默认 简体中文 + English）。语言包同时用于 OCR、语音识别和界面语言；第一个语言决定界面与摘要用什么语言写。
2. 在 **AI 服务** 里选一种来源并点 **测试**。所有 Key 都用系统密钥库（Windows DPAPI / macOS Keychain）加密保存；也可以通过环境变量提供（`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`）。什么都不配时程序仍可用：标题退回文件名，摘要退化为清单。
3. macOS 需要在「系统设置 › 隐私与安全性」里给应用 **屏幕录制** 和 **麦克风** 权限（开发时授权对象是 Electron）。macOS 上程序以菜单栏（托盘）应用的形式运行，点击托盘小猫图标可打开菜单。**小猫不会出现在全屏应用之上**——看电影或放 PPT 时整个屏幕就是内容本身，角落里蹲一只猫是碍事的。macOS 上全屏应用有自己的 Space，一个窗口标志就够了；Windows / Linux 没有对应机制，改成看屏幕本身：有窗口全屏时任务栏会跟着消失、可用区域涨到整块屏幕，据此隐藏。
4. 语音识别默认用 `whisper-small`（约 250 MB，首次录音时下载）。设置里的「识别语言」默认为「自动检测（所有语言）」：每次录音先判断说的是 Whisper 支持的 99 种语言里的哪一种，再按该语言原样转写；也可以改成只在两个语言包之间判断（更稳），或固定成某一种。`tiny`/`base` 更快但中文准确率明显更低。

## 第一次打开

第一次启动会走一个六步的引导（[src/renderer/onboarding/](src/renderer/onboarding/)），一屏一件事：**这是什么 → 两个语言包 → 权限 → 谁来读这些记录 → 准备本机引擎 → 手势速查**。做完写进 `setupDone`，之后不再出现；想重看就删掉设置里的这一项。

权限那一步是它存在的主要理由。macOS 上这两项权限的行为完全不同，一个「授权」按钮糊不过去：

| | 能不能由程序发起 | 之后 |
| --- | --- | --- |
| **麦克风** | 能。`askForMediaAccess` 会弹出系统对话框 | 点一下就好了 |
| **屏幕录制** | **不能**。只有先尝试过一次截图，macOS 才会把这个应用列进系统设置；开关要用户自己拨 | **必须重启应用**才生效 |

所以卡片会分别说清楚将要发生什么，屏幕录制那张点完会打开对应的系统设置面板并提示需要重启。从源码运行时还会额外提醒一句：系统设置里要找的是「Electron」而不是 briffy——授权是挂在可执行文件上的。

不授权也能继续，只是对应的功能关着，其它照常。界面预览：`node dev/preview/serve.js` 然后开 http://localhost:5173/onboarding （`?perm=mic|all` 看不同的授权状态，`?lang=en` 看英文）。

## 工作区目录

默认在 `<用户数据目录>/workspace`（Windows：`%APPDATA%\briffy\workspace`，macOS：`~/Library/Application Support/briffy/workspace`），可在设置里改：

```
workspace/
  entries/2026-09-03.json     # 每天一个索引：标题、OCR/转写文字、画面内容、状态
  screenshots/2026-09-03/     # 截图原图 PNG
  audio/2026-09-03/           # 录音原始 webm + 16kHz wav
  files/2026-09-03/           # 拖入的文件副本、笔记 .txt、下载的 PDF
  summaries/2026-09-02.md     # 每日摘要（Markdown）+ .json 元数据
```

超过 200 MB 的文件不复制，只记录原路径。

## 问自己的记录

记录页左边第二个标签是 **问**。输入一句话，右边列出它依据的记录，左边是答案，答案里的 ①② 点一下就跳到对应那条，卡片点一下就打开原始记录。

问题分两半读：

- **时间**当过滤条件。认得 今天 / 昨天 / 前天、本周 / 上周（周一到周日）、本月 / 上个月、最近三天 / 过去 10 天、9月3日、`2026-08-27`，以及对应的英文（today、last week、last 5 days…）。「上周我都在忙什么」这类只有时间没有关键词的问题，直接把那一整段时间的记录交出去，不做筛选。
- **词**当检索条件。时间词会先从问题里删掉，不然「上周」还会去正文里找「上周」两个字。中文按**字符二元组**匹配（ICU 的分词会把「报错」切成「报」和「错」，单字又到处命中，所以 `报错截图` 变成 `报错 / 错截 / 截图`，配不上的那个自然没人理），英文按词，`AI`、`PR` 这种两个字母的也留着。命中位置有权重：画面内容 3.5、标题 3、一句话摘要 2、OCR/转写正文 1；一个词在大部分记录里都出现（常驻的应用名、你自己的用户名）就自动降权；答上了问题里更多词的记录排在前面。

排在前面的至多 40 条送给 AI，附上时间、类型、标题和正文摘录（没有文字的图片则附上画面内容），要求它**只依据这些作答**、答不上来就直说、引用时原样保留标题和词条不做翻译。答案用问题本身的语言写。

**没有配 AI 服务、或者调用失败时，这一页照样有用**：检索到的记录会照常列出来，只是没人替你读它们。检索这一层完全在本地，不联网、不用模型。

回归测试：`node dev/ask-test.js`（纯 node，不需要 Electron），把日期表达式、分词和排序的行为都钉住了。

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
- **分片流下载**：`src/main/ffmpeg.js` 负责找到 / 安装 / 调用 ffmpeg，`src/main/stream.js` 负责按清单下载并合并。见上面「分片流怎么变回一个文件」。
- **问记录**：`src/main/recall.js` 只做检索（时间表达式 + 加权打分，无依赖、无网络），`src/main/ask.js` 把选中的记录交给 `llm.js` 作答并要求它标注引用。见上面「问自己的记录」。
- **标题 & 摘要**：`src/main/llm.js` 统一调度四种来源。Claude 走 Anthropic SDK（默认 `claude-opus-5`，结构化输出 + 服务端 refusal fallback，PDF 直接作为文档送入）；OpenRouter 和自定义接口走 OpenAI 兼容的 chat/completions（JSON schema 不支持时自动降级）；Ollama 走原生 `/api/chat`（`format` 结构化输出、自动关闭 Qwen 的 thinking、非视觉模型自动去掉图片）。截图以图片 + OCR 文本送入；PDF 先用 `pdf-parse` 本地抽文字（也用于搜索）；网页抓正文后送入。本地模型的输入会按上下文长度截断。
- **硬件检测 & 推荐**：`src/main/hardware.js` 读取 CPU / 内存 / 显卡（Windows 用 nvidia-smi 或注册表里的显存大小，macOS 用 system_profiler，Apple Silicon 按统一内存算），按显存 / 内存预算推荐 `qwen3.5:0.8b / 2b / 4b / 9b / 27b`，备选 `gemma3:4b`。

## 体积

| | 大小 |
| --- | --- |
| Windows 安装包（`briffy Setup 0.1.0.exe`） | **171 MB** |
| 安装后占用 | 562 MB |
| 其中 Electron 运行时本身 | 约 300 MB（安装包里约 100 MB），无法再压缩 |

安装包里已经**内置**英文语音转文字（Whisper tiny.en，42 MB）和两档中英文字识别（PP-OCRv6 tiny 6 MB + small 30 MB，按机器性能自动选），装完断网也能直接用。其他语言的模型（中文语音、日韩阿拉伯文识别、更大的 Whisper）按需下载到用户数据目录，不进安装包。

为了控制体积做的取舍：去掉 Tesseract（PP-OCR 更好且更小）、排除 onnxruntime 的浏览器版和非当前平台的二进制、排除 DirectML 执行提供程序（我们跑 CPU）、Chromium 只保留 en-US / zh-CN / zh-TW 三个语言包。

## 打包

```bash
npm run fetch-models   # 下载要内置进安装包的英文语音 + 中英 OCR 模型（约 47 MB，只需一次）
npm run dist:win       # Windows NSIS 安装包，输出到 release/
npm run release:mac    # macOS：签名 + 公证 + dmg，然后自动验一遍（需在 macOS 上执行）
npm run pack           # 本地快包：签名但不公证，用来试一下打出来的东西
npm run verify:mac     # 单独验一个已经打好的 .app
```

`dist:*` / `release:mac` 会自动先跑 `fetch-models`。`bundled-models/` 不进版本库。

原生依赖（onnxruntime、tesseract 的 wasm）已在 `package.json > build.asarUnpack` 中声明。

**macOS 发布**见 [docs/RELEASE.md](docs/RELEASE.md)：签名用 `Developer ID Application`，包 arm64、最低 macOS 13，公证要三个环境变量——**缺了 electron-builder 只打印一行 `skipped macOS notarization` 就继续**，打出来的包在本机照样打开，到别人机器上打不开。`npm run verify:mac`（[dev/mac-release-check.js](dev/mac-release-check.js)）就是拦这个的：它按 Gatekeeper 的顺序把签名、嵌进签名里的 entitlements、Info.plist 里每条权限说明、`app.asar.unpacked` 里 11 个原生库的签名、公证票和 `spctl` 判定全过一遍，全绿才发。

**Mac App Store 过不了**，原因不是配置而是沙箱：滚动长截图要辅助功能、窗口归属和 Vision 要 Apple 事件、分片流合并要 ffmpeg、扩展要侧载——沙箱一个都不给。逐条的替代方案、砍完之后 MAS 版长什么样、以及构建侧要补的证书和描述文件，都在 [docs/app-store/mas-blockers.md](docs/app-store/mas-blockers.md)。隐私政策 [docs/PRIVACY.md](docs/PRIVACY.md)，App Privacy 逐项申报 [docs/app-store/app-privacy.md](docs/app-store/app-privacy.md)。

## 浏览器扩展（采集网页图片 / 视频）

`extension/` 是一个 Chrome / Edge 扩展（Manifest V3），原理和 AixDownloader 一类工具一样，从三个地方找媒体，合并去重后列出来：

1. **扫描页面 DOM**（[scan.js](extension/scan.js)）：`img` / `video` / `audio` / `srcset` / 懒加载属性 / CSS 背景图 / 指向媒体文件的链接，含 iframe，也**穿透 open shadow root**——很多播放器是自定义元素，`<video>` 藏在影子树里，`querySelectorAll` 根本看不见。
2. **监听网络响应**（[background.js](extension/background.js) + [classify.js](extension/classify.js)）：抓 mp4、m3u8、mpd、图片，过滤掉追踪像素和图标。
3. **钩住页面自己的请求**（[hook.js](extension/hook.js)）：这是能不能发现现代视频的关键。用 MSE 的播放器，`<video>` 上挂的是 `blob:`，真正的流全靠页面 JS 的 `fetch` / `XMLHttpRequest` 拉分片——DOM 里什么都没有。所以在 `document_start`、页面代码跑起来之前，往**页面自己的世界**注入一段脚本包住 `fetch`、`XMLHttpRequest.open` 和 `URL.createObjectURL`，只**观察**经过的 URL：不拦截、不改写、不读响应体，且只上报形状像媒体或清单的那些，普通接口调用直接忽略。

判断清单不看 Content-Type 只看 URL：大量 CDN 把 m3u8 发成 `text/plain` 或 `application/octet-stream`，也有干脆没扩展名的（`/manifest`、`?format=m3u8`）。`.ts` / `.m4s` 分片不单独列出来（要的是播放列表），但**按目录计数**——一个页面只留下 300 个分片请求，那它照样是个有视频的页面，面板会显示「N 个分片」而不是一片空白。Service Worker 代发的请求 `tabId` 是 -1，按来源域归到对应标签页，不再直接丢弃。

什么都没找到时面板会说明**为什么**：页面里有几个 `<video>`、地址是不是 `blob:`、有没有检测到 MSE，以及「先让视频播几秒再打开面板」——分片请求出现之后才认得出来。

这层判断有回归测试：`node dev/media-detect-test.js`（纯 node，不需要浏览器），30 条用例覆盖了各种伪装成文本的清单、必须计数而非列出的分片、以及绝不能当成图片端上来的追踪像素。

**安装**：记录页右上角有一个状态灯——没装时显示「装浏览器扩展」，点一下会在你的默认浏览器里打开一个引导页（`http://127.0.0.1:47831/install`），上面有可复制的 `chrome://extensions/` 地址和扩展文件夹路径，装好后那个页面**自己变绿**，App 里的状态灯也变成「扩展已连接」。

（浏览器出于安全不允许外部程序直接跳转到 `chrome://extensions`，所以只能复制粘贴这一步需要手动。默认浏览器是 Edge 时地址会自动换成 `edge://extensions/`。）

手动的三步是：

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择本项目的 `extension/` 文件夹（或用 App 里的「导出扩展文件夹…」复制一份到别处）。
3. 在任意网页点扩展图标，或按 `Alt+Shift+D`。

扩展装好后每 5 分钟向 App 报一次到（`chrome.alarms`），所以状态灯不需要你先打开扩展面板就能变绿；连续两次没报到（11 分钟）就算断开。

判断"是不是真的扩展"只认浏览器自己写的请求头（`Origin: chrome-extension://…` 加上 `Sec-Fetch-*`），网页脚本和命令行都伪造不了，所以状态灯不会假绿。这条有回归测试：`node dev/api-test.js` 会在独立端口上跑一遍五种伪造场景。

面板里可以按类型（图片 / 视频 / 音频）和最小边长筛选、全选、单选，勾好后「发送到 briffy」。图片由扩展带着页面 cookie 和 Referer 下载后传给 App（能拿到防盗链的图）；视频默认只记录地址和来源页面，勾上「同时下载视频 / 音频文件」才会真的下载。

条目的名字按 URL 里的文件名取，取不到就用**页面标题**（剥掉 `_哔哩哔哩_bilibili`、`- YouTube` 这类站名后缀，但只在结尾那段确实是这个站的名字时才剥——不然 github.com 上一条「fix: bug in hub」会被砍掉半截）。

### 分片流怎么变回一个文件

网站上的视频通常不是一个文件：它是一个播放列表加几百个分片（HLS 的 `.ts` / DASH 的 `.m4s`），而且画面和声音常常是分开的两条轨。勾了下载之后，**扩展只把播放列表的地址交给 App**（去下载那个地址只会得到几 KB 的文本），由 App 这边用 **ffmpeg** 跟着清单把所有分片拉下来、把两条轨合成一个 `.mp4`（`-c copy`，只重封装不重编码，快且无损）。视频 CDN 基本都做防盗链，所以来源页会作为 `Referer` 传给 ffmpeg，否则分片全是 403。

**ffmpeg 不打包进安装包，也不会去下载来路不明的二进制。** 先在系统里找（PATH 以及 Homebrew / Program Files 这些包管理器常用的位置），找不到就在 设置 › 视频下载 里用**系统自己的包管理器**装（macOS `brew install ffmpeg`、Windows `winget install Gyan.FFmpeg`、Linux `apt-get install ffmpeg`），和安装 Ollama 走的是同一条路。没装的时候分片流照样能被**发现**，只是合并不了，条目会说明原因。

这条链路有端到端回归测试：`node dev/stream-test.js` 会用 ffmpeg 现场生成一段 5 秒的 HLS（视频 + 独立音轨），起一个**强制要求 Referer 的**本地服务器（也就是防盗链），走一遍真实的下载流程，再验证产物是一个 h264 + aac 都在、时长分辨率都对的可播文件，以及错误 Referer 时会如实报出 403。

App 这边监听 `http://127.0.0.1:47831`（只绑定本机，要求扩展带自定义请求头，端口可在设置里改，也可以整个关掉）。收到的条目会标记来源为「🧩 网页」，并带上来源页面标题、图片的 alt 文本，一起交给 AI 写标题。

## 收藏即存档

浏览器里点「收藏」的那一下，页面的**标题、正文和网址**就一起进了工作区。X 的 Bookmark、Reddit 的 Save、小红书和知乎的收藏、以及任何一个写着「收藏 / Save / Bookmark」的按钮，都算数；`Cmd/Ctrl+D` 也算。

**它不监视浏览。** 内容脚本平时什么都不做，只在一次保存手势发生之后才去读页面；其余的点击只被看一眼，够判断它不是收藏按钮就丢开。

正文是**在页面里**抽的（[extract.js](extension/extract.js)），不是把网址交给 App 去抓——真正值得收藏的页面大多要登录，从 App 这边请求只会拿到一个空壳。抽取先认站点自己的容器（X 的 `tweetText`、Reddit 的 `shreddit-post`、小红书的 `#detail-desc`），认不出来就走通用启发式：优先 `article` / `main` / `[role=main]` 这类语义容器，再按「正文长、段落多、链接少」打分，最后读文本时把目录、分享栏、相关推荐这些**藏在正文容器里面**的东西剔掉（Wikipedia 的目录就是这么混进来的）。

### 难的地方是分清「收藏」和「取消收藏」

几乎每个网站都用同一个按钮做这两件事，判错的代价是不对称的：**在你决定取消收藏的那一刻反而存了一份**。所以判定不看点击本身，看点完之后的状态——`aria-pressed`、按钮变成了什么字（「取消收藏」「Unsave」），以及站点专属选择器（X 的 `removeBookmark`）。措辞也不能太死板：X 的标签是 `Remove Tweet from Bookmarks`，动词和名词之间夹着别的词。

判定逻辑单独放在 [savedetect.js](extension/savedetect.js) 里，可以对着各站真实的按钮结构验证：把仓库根目录用 http 服务起来，打开 `dev/fixtures/save-gestures.html`，控制台里跑 `copy(window.runCases())`。19 条用例覆盖 X / Reddit / 小红书的收藏与取消、`aria-pressed` 两种朝向、图标套在按钮里的情况，以及**不该**被当成收藏的「分享」和「保存文件到本地」。

（夹具只能验判定，不能验事件通路：`HTMLElement.click()` 的 `isTrusted` 是 false，而 [bookmark.js](extension/bookmark.js) 特意只认真实点击——否则页面可以自己伪造一次收藏。）

同一个网址一天之内只存一次，所以连点两下星星不会存两份。收藏来的条目在记录页的**来源筛选**里自成一档。

## 小动物形象

小猫是**一张图片套一个圆框**：可见的圆 54px，窗口 80×80——多出来的 13px 透明边是给投影、录音红圈和每个动作留的余量，不然放大一下就会被窗口的矩形边裁掉。圆形、白边、投影和所有状态特效（录音红圈 + 麦克风角标、思考小点、快门闪光、摘要角标）都在 `pet.css` 里画，跟图片内容无关——所以换一张图就换了一只宠物，不用重画任何东西。同一张图也是工作区左上角的头像，选了就一起变。

它会动，但很克制：平时**完全静止**，每 7.5 秒蹦一小下，每 11 秒往上探一下头；录音时随红圈一起微微鼓动，处理时歪头往上看，截图时吓一跳，成功时蹦一下，失败时抖一抖。

平时静止不是偷懒，是量出来的：**一个正在跑的 CSS 动画，代价和它的值动不动无关**。这个窗口透明、置顶、开着就不关，它要的每一帧都是一次永不停止的 alpha 合成。在 M2 Max 上实测，三个 `infinite` 待机循环要占掉一个核的 11.4%，而完全静止的小猫只要 0.9%——更说明问题的是，蹦跳和探头有七八成周期都停在原地，却和持续呼吸一样贵。

所以待机动作改成了**只在真正动的那几秒存在**：[pet.js](src/renderer/pet/pet.js) 给它挂上一个 `g-` class，动画跑一遍，class 摘掉，窗口重新安静下来。探头还进一步拆成「抬头 → 静止保持 → 低头」三段，中间那段是纯静态 class（停住不需要动画）。原来那个缓慢的呼吸就是这么没的——它是唯一一个**停不下来**的动作。代价从 11.4% 降到 6.5%。圆框里的东西**一律不加 transform、一律自己就是圆的**（探头是改 `top`）——Chromium 会让带 transform 的子元素逃出父级的圆形裁剪，露出方角。

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

## 官网

**<https://briffy.cc>**（中文）· **<https://briffy.cc/en/>**（English）

`site/` 是一份双语源文件，发布出去是**两个真正的单语页面**——一个页面服务两种语言，
链接分不开、搜索引擎收不进去、分享出去的标题永远是其中一种。

```bash
node dev/preview/serve.js   # 看源文件：http://localhost:5173/site/
npm run site                # 切成两页：site-dist/
npm run deploy              # 切完直接发到 briffy.cc
```

发布走 **Workers 静态资源**（[wrangler.jsonc](wrangler.jsonc)），域名写在 `routes` 里，
部署时 Cloudflare 自己建 DNS 记录、签证书。站点服从和应用同一套视觉标准，
`site/paper/tokens.css` 和 `site/briffy-anim.js` 是 `assets/` 的拷贝（和 `extension/paper/` 同一个道理）。
细节见 [site/README.md](site/README.md)。

## 界面预览（改样式用）

```bash
node dev/preview/serve.js
```

界面的视觉标准（纸质拟物、全直角、中英文排版）在 [.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md)；两张样张：http://localhost:5173/lang （版面与字）和 /system （层 / 墨 / 空）。

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
| `1` | 截图 + OCR | — |
| `audio` | 用一个 wav 文件走语音转文字 | `DAILYLOGS_SMOKE_WAV=<wav>` |
| `url` | 抓取网页并打标签 | `DAILYLOGS_SMOKE_URL=<url>` |
| `files` | 拖入文件（用分号分隔多个路径） | `DAILYLOGS_SMOKE_FILES=a;b` |
| `summary` | 生成某天的摘要 | `DAILYLOGS_SMOKE_DATE=YYYY-MM-DD` |

`DAILYLOGS_SMOKE_TAB=entries|summaries|settings` 决定退出前停在哪个页面，`DAILYLOGS_SMOKE_OUT` 会把最终屏幕截图存成 PNG。

开发时终端里会出现一行 tesseract 的 `Failed loading language '…'` 提示，是 tesseract.js 7 同时加载两个语言包时的已知噪音，不影响识别结果。
