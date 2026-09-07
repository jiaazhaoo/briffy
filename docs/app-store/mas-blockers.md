# Mac App Store 路线图

**结论：briffy 现在的样子过不了 App Store，不是因为漏了配置，是因为沙箱。** 上架不是打包问题，是产品问题——得先决定砍掉什么。这份文件把每一处逐个列开，并给出可行的替代方案。

当前发布路径是 Developer ID 公证 DMG，见 [docs/RELEASE.md](../RELEASE.md)。

---

## 1. 沙箱会拿掉什么

沙箱（`com.apple.security.app-sandbox`）是 App Store 的硬性要求，不能豁免。它一旦打开：

- **不能给别的应用发 Apple 事件**（除了几乎必被驳回的 temporary-exception）
- **辅助功能 API 完全不可用**——`AXIsProcessTrusted()` 永远返回 false
- **不能执行 app 包外的任何二进制**
- **只能读写自己的容器**，加上用户亲手选中的文件（且要用 security-scoped bookmark 才能跨启动保留）

再叠加两条审核条款：**2.5.2**（不得下载或安装可执行代码）和 **2.4.5(iv)**（不得使用非公开 API）。

### 逐个子系统

| 子系统 | 代码 | 沙箱里 | 可行的做法 |
| --- | --- | :---: | --- |
| 滚动长截图 | [scroll.js](../../src/main/scroll.js) | ❌ 不可能 | **砍掉自动滚动**。改成「你自己滚，briffy 连续截并拼」——项目里已经有拼接逻辑（`dev/stitch-test.js`），不需要辅助功能 |
| 记录来自哪个窗口 | [window-list.js](../../src/main/window-list.js)、[foreground.js](../../src/main/foreground.js) | ❌ Apple 事件 | **可替代**：`desktopCapturer.getSources({types:['window']})` 直接给窗口标题和所属应用，不走 Apple 事件（要屏幕录制权限）。拿不到的是 z 序，所以「哪个在最前」会退化 |
| 无文字图片的画面描述 | [vision.js](../../src/main/vision.js) | ❌ 走 osascript | 两条：写一个原生模块直接调 `VNClassifyImageRequest`（沙箱内可用），或者**在 MAS 版里只保留已有的 transformers.js 分类器**（跨平台那条路，本来就在跑） |
| 分片流下载 / 合并 | [ffmpeg.js](../../src/main/ffmpeg.js)、[stream.js](../../src/main/stream.js) | ❌ 双重违规 | **整块砍掉**。既是 2.5.2（`brew install ffmpeg`），也踩 5.2.3（协助下载受版权保护的内容）。这一条不要试 |
| 本地模型 (Ollama) | [ollama.js](../../src/main/ollama.js) | ⚠️ 一半 | 砍掉「一键安装」和进程启动；**保留**「检测到 `127.0.0.1:11434` 已在跑就用它」——沙箱里 `network.client` 允许连本机 |
| 硬件检测（显卡） | [hardware.js:105](../../src/main/hardware.js:105) | ❌ `system_profiler` | `os.cpus()` / `os.totalmem()` 沙箱内可用。显存要走 IOKit 原生模块——但它只服务于 Ollama 推荐尺寸，跟着一起砍最省事 |
| 批量导入解压 | [import-bulk.js:95](../../src/main/import-bulk.js:95) | ❌ `/usr/bin/unzip` | **换成 JS**。Electron 自带 `@electron-internal/extract-zip`，[diarize.js:91](../../src/main/diarize.js:91) 的 `tar` 同理 |
| 终端里跑 `ant auth login` | [main.js:690](../../src/main/main.js:690) | ❌ 必被驳回 | **砍掉这个按钮**，只留手填 API Key |
| 浏览器扩展 | [local-api.js](../../src/main/local-api.js)、[install-page.js](../../src/main/install-page.js)、[extension/](../../extension/) | ⚠️ 一半 | 本机端口本身可留（加 `network.server`）。**必须砍掉的是侧载引导**——「导出扩展文件夹 + 加载已解压的扩展程序」审核会当成分发代码。正路是把它做成 **Safari Web Extension** 打进 app 包（这条路 MAS 支持）；Chrome / Edge 版另投 Chrome Web Store |
| MCP server | [mcp/briffy-mcp.js](../../mcp/briffy-mcp.js) | ❌ | 要往别的应用的配置目录里写东西，沙箱不允许。MAS 版去掉 |
| 工作区目录可自定义 | [store.js](../../src/main/store.js) | ⚠️ 要改造 | 默认放容器内；用户选的位置要走 `files.user-selected.read-write` + **security-scoped bookmark**，否则重启后就读不到了。这是实打实的代码工作 |
| 剪贴板监听 | [clipboard-watch.js](../../src/main/clipboard-watch.js) | ✅ 技术可行 | 但会被反复追问。**默认关闭**，并在 Review Notes 里解释 |
| 截图 | [capture.js](../../src/main/capture.js)、`node-screenshots` | ✅ 可行 | 沙箱不管屏幕录制，TCC 管。MAS 上有做截图的应用。原生模块需确认不碰非公开 API；退路是直接用 Electron 的 `desktopCapturer` |
| 自动录音 | [listen.js](../../src/main/listen.js) | ✅ 技术可行 | **本产品最大的审核风险**，见 [app-privacy.md §4.4](app-privacy.md)。默认关闭 + 打开时明确告知 + Review Notes 写全 |
| 全局快捷键 / 置顶小猫 / 托盘 | [main.js](../../src/main/main.js)、[windows.js](../../src/main/windows.js) | ✅ 可行 | Electron 用 Carbon `RegisterEventHotKey`，沙箱内正常 |
| 本机模型下载（Whisper 等） | [stt.js](../../src/main/stt.js) | ✅ 大致可行 | 下载的是权重不是代码，普遍被接受。别把它讲成「下载组件」 |

---

## 2. 于是 MAS 版是个什么东西

砍完之后剩下的仍然是一个完整的产品——只是小一号：

**留下**：截图（整屏 + 框选）+ 本机 OCR · 语音笔记 + 本机转写 · 剪贴板采集 · 拖入文件 / 链接 / 笔记 · 本机图像分类 · 标题与摘要 · 每日摘要 · 「问自己的记录」（本地检索 + 云端或本机模型作答）· 小猫、气泡、托盘、快捷键 · Safari 扩展采集网页图片

**没有**：自动滚动长截图 · 分片视频下载 · 一键装 Ollama / ffmpeg · Chrome/Edge 侧载扩展 · MCP · 「哪个窗口在最前」的精确归属

这版建议**单独一个 bundle ID**（例如 `com.briffy.app.mas`），别跟 Developer ID 版共用——两者功能不同，共用一个 ID 只会让升级路径和用户预期都乱掉。代码里用一个 build flag 分叉即可。

---

## 3. 构建侧要补的（等第 1 节做完再动）

这台机器上**已经有** MAS 需要的两张证书：`Apple Distribution: jia zhao (5B88JH77HT)` 和 `3rd Party Mac Developer Installer: jia zhao (5B88JH77HT)`。缺的是：

1. **App ID + Mac App Store 描述文件**。在 developer portal 为 `com.briffy.app.mas` 建 App ID，签一个 Mac App Store 类型的 provisioning profile，放到 `build/embedded.provisionprofile`。（现在本机一个描述文件都没有。）
2. **`build/entitlements.mas.plist`**：`app-sandbox` · `application-groups` = `5B88JH77HT.com.briffy.app.mas` · `device.audio-input` · `network.client` · `network.server` · `files.user-selected.read-write` · 外加 Electron 要的 `cs.allow-jit` / `cs.allow-unsigned-executable-memory` / `cs.disable-library-validation`。
3. **`build/entitlements.mas.inherit.plist`**：只要 `app-sandbox` + `cs.inherit`，给 helper 进程。
4. **`build.mas` 目标**：产物是 `.pkg`，用 installer 证书签。
5. **App Store Connect 里的 app 记录**，加上第 4 节的文案。
6. **上传**：Transporter，或 `xcrun altool --upload-app -f release/mas/briffy.pkg`。

**先别写这些配置。** 沙箱一打开，第 1 节里每个 ❌ 都变成运行时静默失败——先改代码，再配构建，否则调试的是幻觉。

隐私清单 `PrivacyInfo.xcprivacy`：**macOS 不需要**，required-reason API 那套只强制 iOS / iPadOS / tvOS / watchOS。

---

## 4. 商店文案（草稿，也可直接用在下载页）

| 字段 | 内容 |
| --- | --- |
| Name (30) | `briffy` |
| Subtitle (30) | `Keep what your day showed you` |
| Category | Productivity（副类：Utilities） |
| Keywords (100) | `screenshot,ocr,voice notes,transcribe,clipboard,journal,daily,notes,capture,offline,local ai` |
| Support URL | `https://github.com/jiaazhaoo/briffy/issues` |
| Privacy Policy URL | ⚠️ **待发布**，正文见 [docs/PRIVACY.md](../PRIVACY.md) |
| Copyright | `2026 Jia Zhao` |
| Age Rating | 4+（无用户生成内容分享、无社交、无广告） |

**Description 开头（前两行是列表页唯一可见的部分）：**

> A cat sits in the corner of your screen and keeps what your day showed you. Click it to capture the screen — the picture is saved, the text in it is read, and it lands in today's workspace. Nothing needs setting up first.
>
> Everything is read on this Mac: the text in a screenshot, the words in a voice note, what a picture with no text contains. There is no account, no sync, no server, and no analytics. Your records are plain files in a folder you can open, copy or delete.

**Screenshots**（1280×800 或 2560×1600，至少 3 张，建议 5）：① 小猫蹲在真实桌面角落，气泡里刚存下一条 ② 记录页的日期瀑布流 ③ 一条截图记录的详情，OCR 文字在侧边 ④ 「问」这一页，答案带 ①② 引用标注 ⑤ 设置 › AI 服务，显示「本地模型」也是一个选项。**每张都用真实内容，不要 lorem ipsum**——审核会看，用户更会看。

**App Review Notes（必填，逐条照抄）：**

> briffy is a local-first capture tool. No account is needed; there is no sign-in to test.
>
> **Screen recording permission** is used only when the user acts: clicking the cat, or pressing the shortcut. There is no periodic or background screen capture anywhere in the app.
>
> **Microphone.** By default the microphone opens only while the user is recording a voice note. Settings › Recording contains an optional "automatic recording" switch, off by default, which files a recording whenever speech is detected; macOS shows the orange microphone indicator the whole time it runs, and the user is told before enabling it what it means. Audio is transcribed entirely on device with a bundled Whisper model and recordings are never transmitted.
>
> **Clipboard.** Optional, and off by default. When on, items the user copies are saved to their own workspace folder on this Mac.
>
> **Cloud AI is off by default and optional.** The app is fully usable with nothing configured: titles fall back to filenames, summaries to a list, and Ask still searches locally. If the user enters their own API key, the content of the record being processed is sent from their machine directly to that provider under their own credentials. We operate no server and receive nothing. The user can instead point the app at a local Ollama, in which case nothing leaves the machine.
>
> **Model downloads** fetch neural-network weights (Whisper, PP-OCR) from Hugging Face into the app's data folder. No executable code is downloaded, and English speech recognition plus Chinese/English text recognition are bundled so the app works offline out of the box.
