# briffy 📎

**<https://briffy.cc>** · [下载](https://github.com/jiaazhaoo/briffy/releases) · [为什么这么做](NOTES.md) · [隐私](PRIVACY.md) · [English](../README.md)

> briffy 是这一系列产品的统称，核心只有一件事：**把你一天里看到的、听到的、收到的东西记下来**。
> 本仓库是桌面端（Windows / macOS，Electron）；移动端另行保管。
> 源码公开，个人与非营利用途自由使用，**禁止商用**——见 [许可](#许可)。

屏幕右下角常驻一枚回形针，**它就是 briffy 本人**——那两道弧是 logo 本身，由 [briffy-anim.js](../assets/brand/briffy-anim.js) 现画，不是一张贴上去的图片。

| 动作 | 效果 |
| --- | --- |
| **单击它** | 截整个屏幕，保存 + OCR，同时进系统剪贴板 |
| **双击它** | 框选截图；框旁边的**长截图**让它自己滚着拼一整页 |
| **中键点它**（或长按 0.55 秒） | 开始 / 结束录音 |
| 拖图片 / 文件 / 链接 / 文字到它身上 | 存入工作区（图片 OCR，PDF 和网页读正文） |
| 右键它 / 托盘图标 | 工作区、设置、生成摘要、隐藏、退出 |
| 复制任何东西 | 剪贴板里的文字、图片、文件实时存入 |
| Ctrl+Alt+A / S / V（macOS ⌘⇧A / S / V） | 框选 / 整屏 / 录音 |
| 浏览器里 Alt+Shift+D | 扩展列出当前网页的图片 / 视频 / 音频，勾选存入 |

## 它做什么

- **存进来的东西自己会说明自己**：标题、一句话摘要；没有文字的图片由本机分类器说出画面里有什么。每天 08:00 为昨天写一份摘要。
- **问出来**：底栏中间那条「问」用一句话提问，程序在本地把问题翻成一批记录，再让 AI 只读这批作答，每句话都标着依据的第几条。没配 AI 也有用——挑记录这一步**完全不经过模型**。
- **搜索有两条腿**：精确命中，加上**意思相近**（搜「跑步」出得来那场 walking 挑战）。相近的一律标出来，不和精确命中混在一起。
- **看图**：点开一张图有自己的窗口——画笔、马赛克、裁切、翻译、置顶、复制。
- **接进来**：Notion 页面、Gmail 邮件（用你自己的凭据），或者把导出的 zip / mbox 整包拖进来。
- **默认关着、要你自己打开的两样**：会议自己录下来（别的软件开麦克风时才跟着录，转成文字并分出说话人），以及「路过」（今天都在看什么，写进工作区里另一个地方，不混进记录页）。

识别全在本机：OCR 用 PP-OCRv6，语音用 Whisper，都走 onnxruntime，装完断网可用。
**图片从不发给任何模型**——OCR 已经把字读出来了。

每一处「为什么是这样而不是那样」，连同量出来的数，都在 **[docs/NOTES.md](NOTES.md)**。

AI 服务四选一（设置 › AI 服务）：Claude（API Key 或已登录账号）、OpenRouter（浏览器授权，OAuth PKCE）、本地 Ollama（按机器推荐尺寸，一键下载）、任意 OpenAI 兼容接口。都不配时程序仍可用：标题退回文件名，摘要退化为清单。

支持 Windows 和 macOS（Apple Silicon；Intel Mac 缺本地语音识别的预编译库，其它功能可用）。

## 运行

```bash
npm install
npm start
```

`npm install` 里的 `postinstall` 会自动下载 Electron 运行时（约 367 MB，只需一次）。**Electron 44 起官方删掉了自己的 postinstall 钩子**，装完不会自带二进制，所以这一步由本项目的 `package.json` 接管；如果哪次漏了，手动补一句 `npx install-electron` 即可。

同一个 `postinstall` 还会把界面用的五套字体（思源黑 / 思源宋 / Source Sans / Source Serif / IBM Plex Mono，全部 OFL，约 10 MB）下载到 `assets/fonts/`——应用离线运行，字体随包带走，不联网取字。断网装的话界面会退回系统字，之后补一句 `npm run fetch-fonts` 即可。

只有打包才需要 `npm run fetch-models`（`npm run dist:*` 会自动先跑）。日常开发不用——缺什么模型程序会在第一次用到时自己下。

**不需要任何配置步骤**：第一次启动时程序自己检查这台电脑并准备好本地的文字识别和语音识别引擎，需要下载时它会切到「在忙」的样子。设置 › 本机引擎 里能看到结果，每一项都可以自己改，也能点「重新检查」再跑一遍。

其余可以手动调整的：

1. 右键它 → **设置**，选择两个语言包（默认 简体中文 + English）。语言包同时用于 OCR、语音识别和界面语言；第一个语言决定界面与摘要用什么语言写。
2. 在 **AI 服务** 里选一种来源并点 **测试**。所有 Key 都用系统密钥库（Windows DPAPI / macOS Keychain）加密保存；也可以通过环境变量提供（`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`）。什么都不配时程序仍可用：标题退回文件名，摘要退化为清单。
3. macOS 需要在「系统设置 › 隐私与安全性」里给 **屏幕录制** 和 **麦克风** 权限（开发时授权对象是 Electron）。程序以菜单栏（托盘）应用运行，**不会出现在全屏应用之上**（[为什么](NOTES.md#第一次打开)）。
4. 语音识别默认 `whisper-small`（约 250 MB，首次录音时下载），「识别语言」默认自动检测 Whisper 支持的 99 种语言。`tiny`/`base` 更快但中文准确率明显更低。

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

**macOS 发布**（签名 / 公证 / 那三个环境变量少一个就静默出一个别人打不开的包）见 [docs/RELEASE.md](RELEASE.md)。**Mac App Store 过不了**，原因是沙箱不是配置——长截图要辅助功能、Vision 要 Apple 事件、合流要 ffmpeg、扩展要侧载，逐条见 [mas-blockers.md](app-store/mas-blockers.md)。

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

发布走 **Workers 静态资源**（[wrangler.jsonc](../wrangler.jsonc)），域名写在 `routes` 里，
部署时 Cloudflare 自己建 DNS 记录、签证书。站点服从和应用同一套视觉标准，
`site/paper/tokens.css` 和 `site/briffy-anim.js` 是 `assets/` 的拷贝（和 `extension/paper/` 同一个道理）。
细节见 [site/README.md](../site/README.md)。

## 界面预览（改样式用）

```bash
node dev/preview/serve.js
```

界面的视觉标准（纸质拟物、全直角、中英文排版）在 [.claude/skills/paper-ui/SKILL.md](../.claude/skills/paper-ui/SKILL.md)；两张样张：http://localhost:5173/lang （版面与字）和 /system （层 / 墨 / 空）。

然后在浏览器打开 http://localhost:5173/ （工作区，带假数据）、/pet （桌面上那一枚，可加 `?zoom=3&state=success` 看各状态）、/viewer （看图窗口）、/shelf （悬停货架）、/region （框选层）、/onboarding （引导）。这些页面直接引用 `src/renderer` 里的真实 CSS / JS，只是把 Electron 的 IPC 换成了 `dev/preview/mock-*.js`，改完样式刷新即可看到。

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

**[PolyForm Noncommercial License 1.0.0](../LICENSE)** — 源码公开，但禁止商业使用。

| | |
| --- | --- |
| **可以** | 个人使用、学习、研究、业余项目、修改、再分发（须随附 [LICENSE](../LICENSE) 全文和里面的 `Required Notice:` 一行）；慈善机构、学校、公立研究机构、政府机构等非营利组织使用 |
| **不可以**（须先取得书面授权） | 任何商业用途——公司内部经营使用、以它或它的衍生作品提供付费服务、打包出售、嵌入收费产品 |
| **商业授权** | <zhaojia789456@gmail.com> |

需要说清楚的两件事：

1. **这不是 OSI 定义的「开源」。** 开源的定义（OSI 第 6 条、自由软件第 0 条）要求不得歧视任何使用领域，商业也在内；带商用限制的许可因此不算开源，GitHub 侧栏会把它显示成 “Other”，一些发行版和公司的合规流程会直接排除它。准确的说法是**源码公开 / source-available**。本文档和 [LICENSE](../LICENSE) 都按这个口径写。
2. **限制只落在 briffy 自己的代码上。** 用到的依赖、模型、字体、素材各自沿用上游许可（多数是 MIT / Apache-2.0 / BSD / OFL，允许商用），清单和唯一一处 copyleft（libvips，LGPL，动态链接）见 [THIRD-PARTY.md](../THIRD-PARTY.md)。

「briffy」这个名字和它的形象不在代码许可范围内；fork 请换个名字发布，别让人误以为是官方版本。

隐私说明见 [docs/PRIVACY.md](PRIVACY.md)，安全问题的报告方式见 [SECURITY.md](../SECURITY.md)，参与方式见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
