# briffy 🐱

> **briffy 桌面端。** briffy 是这一系列产品的统称，核心只有一件事：**把你一天里看到的、听到的、收到的东西记下来**。
> 本仓库当前存放桌面端（Windows / macOS，Electron）。移动端（iOS / Android）和更早的版本另行保管。
> 源码公开，个人与非营利用途自由使用，**禁止商用**——见 [许可](#许可)。

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

存进工作区的东西会拿到一个标题和一句话摘要；一张没有文字的图片，还会由本机的图像分类器说出画面里有什么。每天到设定时间（默认 08:00）小猫会为昨天的记录生成一份摘要，好了之后小猫身上出现一个角标；小猫被隐藏时改用系统通知。

存进去的东西可以直接**问出来**：记录页旁边的「问」用一句话提问（「上周那个 Postgres 报错是怎么回事？」），程序先把问题里的时间和词翻成一批记录，再让 AI 只读这批记录作答，答案里每句话都标着它依据的第几条。搜索框除了精确命中，还会另外给出**意思相近**的——搜「跑步」出得来那场 walking 挑战——但它们一律标着「相近」，不和精确命中混在一起。见 [问自己的记录](#问自己的记录)。

点开工作区里的一张图，它有[自己的窗口](#看图)：画笔、马赛克、裁切、翻译、置顶、复制。另外两样**默认关着、要你自己打开**：[会议自己录下来](#会议自己录下来)（别的软件开麦克风时才跟着录，录完转成文字并分出说话人 1 / 2 / 3）和[路过](#路过)（今天都在看什么，写进工作区里另一个地方，不混进记录页）。

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

**不需要任何配置步骤**：第一次启动时程序自己检查这台电脑并准备好本地的文字识别和语音识别引擎，需要下载时小猫会切到「在忙」的样子。设置 › 本机准备情况 里能看到结果，每一项都可以自己改，也能点「重新检查」再跑一遍。

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
  trail/                      # 「路过」那一层，默认不写；不进 entries/
```

超过 200 MB 的文件不复制，只记录原路径。

## 问自己的记录

记录页左边第二个标签是 **问**。输入一句话，右边列出它依据的记录，左边是答案，答案里的 ①② 点一下就跳到对应那条，卡片点一下就打开原始记录。

问题分两半读：

- **时间**当过滤条件。认得 今天 / 昨天 / 前天、本周 / 上周（周一到周日）、本月 / 上个月、最近三天 / 过去 10 天、9月3日、`2026-08-27`，以及对应的英文（today、last week、last 5 days…）。「上周我都在忙什么」这类只有时间没有关键词的问题，直接把那一整段时间的记录交出去，不做筛选。
- **词**当检索条件。时间词会先从问题里删掉，不然「上周」还会去正文里找「上周」两个字。中文按**字符二元组**匹配（ICU 的分词会把「报错」切成「报」和「错」，单字又到处命中，所以 `报错截图` 变成 `报错 / 错截 / 截图`，配不上的那个自然没人理），英文按词，`AI`、`PR` 这种两个字母的也留着。命中位置有权重：画面内容 3.5、标题 3、一句话摘要 2、OCR/转写正文 1；一个词在大部分记录里都出现（常驻的应用名、你自己的用户名）就自动降权；答上了问题里更多词的记录排在前面。

排在前面的至多 40 条送给 AI，附上时间、类型、标题和正文摘录（没有文字的图片则附上画面内容），要求它**只依据这些作答**、答不上来就直说、引用时原样保留标题和词条不做翻译。答案用问题本身的语言写。

**没有配 AI 服务、或者调用失败时，这一页照样有用**：检索到的记录会照常列出来，只是没人替你读它们。挑记录这一步**完全不经过模型**——这不是省事，是这个功能能成立的前提：换掉 OpenRouter 换成本地 Ollama，索引不受影响；断网也照样定位得到；延迟是确定的，不取决于对方的网络。

回归测试：`node dev/ask-test.js`、`node dev/retrieval-test.js`（都是纯 node，不需要 Electron），把日期表达式、分词、排序和融合的行为都钉住了。

### 记录多了以后：一个磁盘上的索引

原来每问一次就 `store.listEntries({ limit: Infinity })`，把工作区每一天都读进内存拼成一个数组。20 万条实测占 **215 MB 堆、打分 707 ms**；按真实平均长度外推到 185 万条约 7 GB——那不是慢，是每问一次崩一次。而模型那头始终只看 40 条，从来不是瓶颈。

所以有了 [src/main/index-db.js](src/main/index-db.js)：一个住在用户数据目录里的 SQLite 倒排索引，**不加任何依赖**——Electron 44 自带的 Node 里 `node:sqlite` 就有 FTS5。20 万条、齐夫分布的语料上实测：

| | |
| --- | --- |
| 建索引 | 40 秒（一次性，之后只重读改过的那一天），库 115 MB，进程堆 **28 MB**（旧路径 215 MB） |
| 稀有词 | 1 ms，全库仅有的那一条准确命中 |
| 两个词 AND | 46 ms；常见词 73 ms；英文 14 ms |
| 按天取一周 | 1 ms；334 天的计数 0 ms |

三件量出来才知道的事：

- **中文必须自己分词。** FTS5 自带的 `unicode61` 把一整串中文当成一个词，`trigram` 又要求至少三个字符——两者搜「会议」都返回 0。所以入库和查询都先过 [segment.js](src/main/segment.js)（ICU），存空格分开的词流。
- **耗时跟命中行数走，不跟库大小走。** 命中 0.16% 时 2 ms，命中全部时 1427 ms，因为 `ORDER BY rank` 要给每一个命中打分。所以查询先用天和类型收窄范围，并丢掉过于常见的词。
- **索引是可以扔的。** 它住在用户数据目录而不是工作区——工作区会被搬走、拷贝、换掉，而索引里的一切都能从工作区重新算出来。`meta` 里记着它是照着哪个工作区、哪一版 schema 建的，对不上就重建。

### 词面之外：向量，以及它为什么不能单干

搜索框和「问」还有第二条腿：把问题和记录都算成向量，找**意思相近**的（[embed.js](src/main/embed.js) / [chunk.js](src/main/chunk.js) / [vector.js](src/main/vector.js)，模型是 `paraphrase-multilingual-MiniLM-L12-v2`，约 120 MB，跑在一个 utilityProcess 里，闲 3 分钟就退）。搜「跑步」出得来那场 walking 挑战，搜「屏幕」出得来那条讲 296 PPI 的笔记。这类结果一律标着「相近」，**不和精确命中混在一起假装是同一回事**——一个搜索框安静地返回一堆不含关键词的东西，看起来就是搜坏了。

`dev/semantic-bench.js` 在真实工作区上量过：六道有答案的日常题，**词面对四道、向量也对四道，但错的不是同几道**——向量找得到「显示器型号」（问题里没有一个字出现在那条英文记录里），却丢了「推荐跑哪个模型」（那条记录的标题里就写着答案）。并集是五道。所以两边都要，谁也别想单干。

更硬的一条理由是**向量不会说「找不到」**：同一次实测里，一条正确答案得 0.445，而一个工作区里根本没有的问题（「我上个月去哪里旅游了」）照样能凑出 0.432。分数没有绝对意义，没有可用的阈值。所以定死一条规则：**词面交白卷时，向量也不出手**。

切块不是优化，是必须的：这个模型一次只读 128 个 token，一条一万三千字的网页不切的话，只会被自己的**开头**代表——而存下来的网页开头永远是语言选择、Cookie 提示和面包屑。正文先剥一遍网页家具（[boilerplate.js](src/main/boilerplate.js)），实测去掉 17% 的字而地名桥词一条不少；**剥的只是喂给向量的那一份视图，存下来的记录一个字不动**，全文搜索照旧。

### 记录之间的边

[links.js](src/main/links.js) 把记录连起来，但**不是靠「一个更好的相似度」**。`dev/thames-link-probe.js` 在真实工作区上量过：「Windsor Road, Egham TW20 0AE」和它所属的那场徒步，向量相似度 **0.155**——而 0.4 上下就已经是瞎猜。门槛降到 0.30 连上 0/8，降到 0.20 连上 3/8，代价是每条记录连到全工作区 236 条里的 126 条。

而那几条停车记录的窗口标题和同一小时里那条书签的标题**一字不差**。关系一直写在记录里，那是「相等」不是「相似」——而 embedding 恰恰是唯一一种专门把字符串碾成近似含义、从而销毁精确匹配的工具。所以只有一条规则，用三次：**一条边只在能说出它的证据时才存在，而证据永远不合成一个数。**

| 边 | 连什么 | 怎么连 |
| --- | --- | --- |
| 同一处 | 页面 ↔ 从它上面摘下来的记录 | 按 key 分组。精确，无阈值无模型 |
| 同一程 | 页面 ↔ 页面 | 时间上一遍扫。结构性，会捞进不相干的 |
| 同一件事 | 记录 ↔ 记录 | 向量，≥ 0.70 才算数 |

前两种根本不是算法，是 join 和一维分段——它们精确、便宜、可解释，正因为它们不是相似度。这个文件里没有向量也没有模型，`node dev/links-test.js` 直接跑得起来。都不落库：存下来只会多一个会过期的东西，而这两种边在一百八十万条上仍然是一张哈希表和一遍扫。

## 看图

工作区里点开一张图，它有**自己的窗口**（[src/main/viewer.js](src/main/viewer.js) + [src/renderer/viewer/](src/renderer/viewer/)），而不是把详情面板撑大——一张图是用来看的，看图和读它的说明是两件事。和聊天软件点开一张照片是同一个动作：一扇自己的窗，图尽可能大，工具条在下面，右边一条是工作区里所有图片的胶片。

工具条：**画笔 / 方框 / 椭圆 / 马赛克 / 文字 / 裁切**，加上缩放、适应窗口、旋转、网格、撤销、置顶、复制。所有绘制都发生在图片上方的一层 canvas 里；主进程只做渲染进程做不到的四件事——把图片放进系统剪贴板、让窗口压在所有东西上面、翻译一段文字、保存一块裁切。

**一键翻译走的是文字，不是图片。** 图片从不出这台电脑（这是工作区那条规矩），而 OCR 早就把字读出来了，再把原图发一遍既慢又多余。

## 会议自己录下来

**这是 briffy 唯一一件不用你动手的事，所以它默认关着**（设置 › 自动录音）。别的东西都在等一次按键或一次复制，只有这一件在听。打开之后，会议和通话会进工作区，不论有没有人打算让它进去——包括别人的声音。要不要打开是用它的人自己的问题。

它**不听房间，它跟着麦克风**：别的软件打开了麦克风，briffy 才跟着录（[micwatch.js](src/main/micwatch.js)）。一直听着房间会把游戏语音、屋里另一个人说话、电视全都切成记录存起来——2026-09-05 就是这么录进 170 条游戏语音的。macOS 上不用写原生模块也能问到这件事：每有一个进程在采集音频，`coreaudiod` 就会持有一条带着**是谁**开的防休眠断言，`pmset -g assertions` 一次 10 ms，每 5 秒问一次的开销可以忽略，而且不需要任何权限。

要排除三类：briffy 自己（不排除就永远停不下来）、24 小时占着麦克风的常驻录音器（`corespeechd`、screenpipe 这类，算进来就退回成「一直录」），以及浏览器——**浏览器不作为应用进名单**，把 Chrome 整个放行等于放行它打开的每一个网页。浏览器带来的是它对应的**会议网站**。

白名单不是一串写死的名字。原来是的：Teams、Webex、Slack、飞书、钉钉……对着一台只装了 Zoom 和微信的电脑，十八项里十四项永远不会命中，打开设置看到的是一份别人的清单。现在名单从 [apps.js](src/main/apps.js) 长出来——扫一遍应用目录，把**真的装了的**会议软件作为默认白名单。

代价是在动手之前量出来的：

| | 一个核 |
| --- | --- |
| 麦克风打开、它自己的回声 / 降噪 / 增益处理都在跑 | 4.5% |
| 在这之上再加语音检测 | 1.4% |
| 两者都有，但关掉那些处理、采样率降到 16 kHz | **2.6%** ← 实际发布的 |

所以渲染进程里定死：不要回声消除、不要降噪、不要自动增益、16 kHz 单声道。Whisper 本来就要 16 kHz，而且是拿普通的嘈杂语音训练的，什么也没损失，成本省掉一半多。有一项成本不是数字：**只要它在跑，macOS 就一直亮着那个橙色的麦克风点**。

监听住在一扇自己的隐藏窗口里，不在小猫那扇——把小猫藏起来不该悄悄把它停掉。

**说话人分段**（[diarize.js](src/main/diarize.js)）：sherpa-onnx 跑 pyannote 分段和一个声纹模型，回答「这段录音里谁在什么时候说话」。本机实测，57 秒四人中文录音 3.8 秒（0.07x 实时）认出正好四个人，16 秒两人英文 0.6 秒认出正好两个——五分钟的会议约二十秒，和它旁边那个转写是同一个量级。标签在文件内部是任意的（实测四个人回来的编号是 0、1、2、7），所以按各自说话的多少重排成 说话人 1 / 2 / 3。

它**故意不跨录音记人**。原来有第二半：每个声音被平均成一枚声纹存下来，下次录音比对，认出来就能起名字。2026-09-06 砍掉了——**不同会议有不同的人**，周二会议里起的名字到周四就是噪音，而设置页里那份起了一半的名字清单，是应用向你要工时却不给回报。

## 路过

**你今天都在看什么**——这是 briffy 里第一样不是你有意存下的东西，所以它有自己的地方（`workspace/trail/`），**不进 `entries/`**。记录页是「你决定留下的」，把路过的东西混进去，那一页就不再是那个意思了。同样默认关着（设置 `recordTrail`）。

两条进料，成本天差地别：

- **焦点**：每两秒问一次前台是谁，变了才记一条。实测 0.31% 的一个核，每天约 0.2 MB。
- **网页**：浏览器扩展在页面里读 DOM 直接交上来。**0.2 ms 读出 12031 个字**，不截屏、不 OCR。

为什么不走 OCR：Vision 的 fast 档要 800 ms 才读出一千一百个字，而且是「认」出来的；页面内读 `innerText` 是 0.2 ms、一万两千字、原文——快四千倍，字多十倍，还准。辅助功能树那条更糟，用 AppleScript 走一遍 Chrome 是 8.8 秒、Claude 是 32 秒。

所以只有微信、Telegram 这类既不交出 DOM 也不交出辅助功能树的应用是 OCR 才能读的，而那恰好是私人聊天——这一层**只记它们的窗口标题，不碰内容**。机器闲着也不记：`powerMonitor.getSystemIdleTime()` 是免费的，超过一分钟没人动就停手。

## 技术组成

- **Electron 44**：浮动透明窗口（小猫）+ 工作区窗口 + 看图窗口 + 悬停货架 + 托盘。
- **OCR（和大模型完全无关）**：**PP-OCR（PaddleOCR）v6** 的 ONNX 模型，通过 `onnxruntime-node` 本地推理。`v6-tiny`（6 MB）和 `v6-small`（30 MB）**两个模型都内置在安装包里**，启动时自动选一个：

  - 判据是内存、核心数和一次约 160 ms 的 CPU 测速（`hardware.js` 里的 `cpuProbe`，跑一次 384×384 矩阵乘法）。内存 ≥ 8 GB、核心 ≥ 4、测速不超过参考机三倍（≤ 160 ms）就用 `v6-small`，否则 `v6-tiny`。
  - 结果写进设置（`ocrModelAuto`），可在设置里手动指定覆盖。
  - 会自我纠正：如果自动选中的模型连续多次单张超过 6 秒（取中位数），自动降回 `v6-tiny`。
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
- **检索**：三层，都在本地，都不经过模型。[recall.js](src/main/recall.js) 是时间表达式和加权打分，[retrieve.js](src/main/retrieve.js) 决定一个问题该给模型看哪几条（它不 require store 也不 require electron，所以 `dev/retrieval-test.js` 跑的就是这一份、不是它的复制品），[index-db.js](src/main/index-db.js) 是磁盘上的 SQLite/FTS5 倒排索引（`node:sqlite`，零依赖），中文先过 [segment.js](src/main/segment.js) 的 ICU 分词。[ask.js](src/main/ask.js) 把选中的记录交给 `llm.js` 作答并要求它标注引用。
- **向量**：[embed.js](src/main/embed.js) 在一个 utilityProcess 里跑 `paraphrase-multilingual-MiniLM-L12-v2`（约 120 MB，闲 3 分钟退出，跑不起来就静静退回数词），[chunk.js](src/main/chunk.js) 按 128 token 的上限切块，[vector.js](src/main/vector.js) 补向量和查相近，[links.js](src/main/links.js) 是记录之间的边。补向量挂在 ask.js 已有的那条限时预算循环上，不新建调度：实测每条 21 ms，攒十条约 0.2 秒。见上面「问自己的记录」。
- **自动录音**：[listen.js](src/main/listen.js) 在一扇隐藏窗口里持麦，[micwatch.js](src/main/micwatch.js) 靠 `pmset -g assertions` 问「谁在用麦克风」（一次 10 ms，不需要权限），[apps.js](src/main/apps.js) 扫应用目录长出白名单，[diarize.js](src/main/diarize.js) 用 sherpa-onnx 做录音内的说话人分段。默认全关。
- **路过**：[trail.js](src/main/trail.js) 每两秒问一次前台是谁（[foreground.js](src/main/foreground.js)），网页正文由浏览器扩展直接交上来。写进 `workspace/trail/`，不进 `entries/`。默认关。
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

原生依赖（onnxruntime、sharp、node-screenshots、sherpa-onnx）已在 `package.json > build.asarUnpack` 中声明。

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

小猫**就是它自己**：一整只回形针，透明底，由 [assets/brand/briffy-anim.js](assets/brand/briffy-anim.js)
以 `body: 'full'` 现画（[pet.js](src/renderer/pet/pet.js)）。窗口 80×80，画的内容不占满——
四周留出的透明边是给投影、录音红圈和每个动作的余量，不然放大一下就会被窗口的矩形边裁掉。
状态特效（录音红圈 + REC、思考小点、摘要角标、拖入时的虚线接框）都在
[pet.css](src/renderer/pet/pet.css) 里画，跟形象本身无关。

它会动，但很克制。这一点是量出来的：**一个正在跑的 CSS 动画，代价和它的值动不动无关**——
这个窗口透明、置顶、开着就不关，它要的每一帧都是一次永不停止的 alpha 合成。在 M2 Max 上实测，
三个 `infinite` 待机循环要占掉一个核的 11.4%，而完全静止时只要 0.9%；更说明问题的是，
蹦跳和探头有七八成周期都停在原地，却和持续呼吸一样贵。所以待机动作只在真正动的那几秒存在。

换内置形象（[scripts/pet-avatar.js](scripts/pet-avatar.js)，`src/main/orient.js` 会把
从左下角冒出来的图水平镜像成统一朝向）：

```bash
npm run pet:avatar -- ./somewhere/pic.png   # 换成本地的一张图
npm run pet:avatar -- --default             # 重新生成内置默认
```

原来那只手绘的猫还留在 [assets/pet/default-cat.svg](assets/pet/default-cat.svg)，
想要的话 `npm run pet:avatar -- assets/pet/default-cat.svg`。

### 想要透明底、全身、多表情的那种

如果想要一只画出来的动物而不是这根回形针，`.claude/skills/pet-as-character/` 里有一套完整的生成流程——改自公开项目 [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill)，但**不生成图标**：改成透明底、居中全身、一只角色画 8 帧表情（`idle` `blink` `capture` `think` `listen` `happy` `sad` `sleep`），且每帧都拿选定的那张当参考图，保证是同一只。三个方向和每帧姿势写在 [scripts/pet-brief.json](scripts/pet-brief.json)。

```bash
npm run pet -- identity --dry-run   # 只写出提示词，不调 API（assets/pet/raw/*.txt）
npm run pet -- identity             # 六个候选：A1 A2 B1 B2 C1 C2
npm run pet:cutout                  # 抠图 + 裁切 + 缩放，并拼出 assets/pet/candidates.png
npm run pet -- frames --from assets/pet/raw/B1.png   # 选定后画 8 帧
```

需要画图模型的 Key：`OPENAI_API_KEY`（`gpt-image-2`，能直接出透明底）、`GEMINI_API_KEY` 或 `OPENROUTER_API_KEY`（出纯色底，由 `scripts/pet-cutout.js` 抠掉）。`npm run pet:electron -- identity` 会走 Electron，直接复用设置里存好的 OpenRouter Key。抠图是从四条边往里漫水填充，角色内部和背景同色的地方不会被误抠，边缘按颜色距离给半透明并反解掉溢色。走这条路要另外改 `pet.css`，把自绘的回形针换成透明贴图。

## 官网

**<https://briffy.cc>**（中文）· **<https://briffy.cc/en/>**（English）

`site/` 是一份双语源文件，发布出去是**两个真正的单语页面**——一个页面服务两种语言，
链接分不开、搜索引擎收不进去、分享出去的标题永远是其中一种。

入口按浏览器语言自动落到其中一页；点过语言链接之后就不再替人决定
（否则从英文页点「中文」会被当场弹回英文）。

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

然后在浏览器打开 http://localhost:5173/ （工作区，带假数据）、/pet （小猫，可加 `?zoom=3&state=success` 看各状态）、/viewer （看图窗口）、/shelf （悬停货架）、/region （框选层）、/onboarding （引导）。这些页面直接引用 `src/renderer` 里的真实 CSS / JS，只是把 Electron 的 IPC 换成了 `dev/preview/mock-*.js`，改完样式刷新即可看到。

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

## 许可

**[PolyForm Noncommercial License 1.0.0](LICENSE)** — 源码公开，但禁止商业使用。

| | |
| --- | --- |
| **可以** | 个人使用、学习、研究、业余项目、修改、再分发（须随附 [LICENSE](LICENSE) 全文和里面的 `Required Notice:` 一行）；慈善机构、学校、公立研究机构、政府机构等非营利组织使用 |
| **不可以**（须先取得书面授权） | 任何商业用途——公司内部经营使用、以它或它的衍生作品提供付费服务、打包出售、嵌入收费产品 |
| **商业授权** | <zhaojia789456@gmail.com> |

需要说清楚的两件事：

1. **这不是 OSI 定义的「开源」。** 开源的定义（OSI 第 6 条、自由软件第 0 条）要求不得歧视任何使用领域，商业也在内；带商用限制的许可因此不算开源，GitHub 侧栏会把它显示成 “Other”，一些发行版和公司的合规流程会直接排除它。准确的说法是**源码公开 / source-available**。本文档和 [LICENSE](LICENSE) 都按这个口径写。
2. **限制只落在 briffy 自己的代码上。** 用到的依赖、模型、字体、素材各自沿用上游许可（多数是 MIT / Apache-2.0 / BSD / OFL，允许商用），清单和唯一一处 copyleft（libvips，LGPL，动态链接）见 [THIRD-PARTY.md](THIRD-PARTY.md)。

"briffy" 这个名字和小猫形象不在代码许可范围内；fork 请换个名字发布，别让人误以为是官方版本。

隐私说明见 [docs/PRIVACY.md](docs/PRIVACY.md)，安全问题的报告方式见 [SECURITY.md](SECURITY.md)，参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。
