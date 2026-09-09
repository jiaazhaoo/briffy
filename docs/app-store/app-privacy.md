# App Privacy — 逐项申报答案

App Store Connect › App Privacy 的问卷答案，每一项都注明依据的代码位置。**这份表照抄即可**，但第 4 节列出的三处判断题请先读一遍。

配套材料：隐私政策正文在 [site/privacy.html](../../site/privacy.html)，发布出去是 <https://briffy.cc/privacy>。

---

## 1. Apple 的「收集」是什么意思

> transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than necessary to service the transmitted request in real time.

关键推论，决定了下面一半的答案：**只在本机处理的东西不算收集。**

briffy 的 OCR（PP-OCRv6 + onnxruntime）、语音转写（Whisper）、说话人分段（sherpa-onnx）、图像分类、句向量、检索索引、每日摘要的拼装——全部在本机跑，不申报。会离开本机的只有一条路：用户自己在 设置 › AI 服务 里选了云端服务之后，**被处理的那一条记录**发给该服务；以及用户自己接入 Notion / Gmail 之后读回来的内容。

---

## 2. Data Types — 申报表

对每个「Yes」，后续三问的答案统一是：**Linked to the user? No** · **Used for tracking? No** · **Purpose: App Functionality**。理由见第 3 节。

| Apple 分类 | 收集？ | 是什么 / 依据 |
| --- | :---: | --- |
| **User Content** → Photos or Videos | **Yes** | 截图图片本身作为 image 参数发给模型。[llm.js](../../src/main/llm.js)、[vision.js](../../src/main/vision.js) |
| **User Content** → Audio Data | **No** | 录音**从不离开本机**。转写是本机 Whisper（[stt.js](../../src/main/stt.js)、[stt-child.js](../../src/main/stt-child.js)），只有转写出来的**文字**可能发出去，那算 Other User Content。见 §4.1 |
| **User Content** → Emails or Text Messages | **Yes** | 仅在用户自己接入 Gmail 之后。`gmail.readonly`，[connect-gmail.js](../../src/main/connect-gmail.js) |
| **User Content** → Other User Content | **Yes** | OCR 文字、语音转写文字、PDF 正文、网页正文、拖进来的文件内容、用户自己写的笔记。[llm.js](../../src/main/llm.js)、[ask.js](../../src/main/ask.js) |
| **User Content** → Customer Support | No | 没有客服通道 |
| **User Content** → Gameplay Content | No | — |
| **Browsing History** | **Yes** | 保存的网址与抓取到的网页正文（[web.js](../../src/main/web.js)）、当时前台的应用与窗口标题（[foreground.js](../../src/main/foreground.js)、[window-list.js](../../src/main/window-list.js)）——这些会随记录一起发给模型 |
| **Search History** | **Yes** | 「问」这一页用户输入的问题会发给模型。[ask.js](../../src/main/ask.js)。见 §4.2 |
| **Contact Info** → Name, Email Address | **Yes** | 仅在接入 Gmail / Notion 之后：邮件与页面里的人名和邮箱会随正文一起发给模型。见 §4.3 |
| **Contact Info** → Phone, Address, Other | No | 不主动读取 |
| **Identifiers** → User ID | No | 没有账号。[store.js](../../src/main/store.js) 里没有任何用户标识 |
| **Identifiers** → Device ID | No | 不读取、不生成、不发送 |
| **Usage Data** | No | **没有任何分析代码**。`grep -riE 'analytics\|telemetry\|sentry\|mixpanel\|posthog\|amplitude' src/` 为空 |
| **Diagnostics** | No | 没有崩溃上报，`crashReporter` 未启用 |
| **Health & Fitness** | No | — |
| **Financial Info** | No | 无内购、无支付 |
| **Location** | No | 不请求定位权限 |
| **Sensitive Info** | No | 不按 Apple 定义的敏感类别（种族、性取向、宗教、政治、生物识别、工会等）主动采集。见 §4 末尾 |
| **Contacts** | No | 不读通讯录 |
| **Purchases** | No | — |
| **Other Data** | No | — |

---

## 3. 为什么统一是 Not Linked / No Tracking / App Functionality

**Not linked to the user's identity** — briffy 没有账号、没有注册、不生成任何设备或用户标识，也没有服务器来把数据和一个人对应起来。请求用的是**用户自己的** API Key，直连服务商；开发者这边既拿不到也看不到。

**Not used for tracking** — Apple 的 tracking 指跨应用/网站把数据与第三方数据关联用于广告或数据经纪。briffy 不投广告、不接广告 SDK、不与任何数据经纪往来。

**Purpose: App Functionality** — 唯一用途是给记录写标题、写一句话摘要、写每日摘要、以及回答用户对自己记录的提问。不做产品个性化、不做分析、不做广告。

**关键抗辩点，写进 App Review Notes 里：** 云端 AI 是**默认关闭**的。装完什么都不配时，程序完整可用（标题退回文件名，摘要退化为清单，「问」仍能本地检索），且**一个字节都不出本机**。用户也可以选 Ollama（`127.0.0.1:11434`）把一切留在本地。

---

## 4. 三处判断题（提交前请自己拍板）

### 4.1 Audio Data 报 No，站得住吗

站得住，而且是事实：录音文件只写在 `workspace/audio/`，转写用的是本机 Whisper。**没有任何代码路径把音频字节发到网上**——可自行核对 [stt.js](../../src/main/stt.js)（`utilityProcess` + onnxruntime，本地）与 [llm.js](../../src/main/llm.js)（只接受 text 与 image，没有 audio 参数）。

若审核追问，回答：*"Audio is transcribed entirely on device with a bundled Whisper model. Recordings are never transmitted. Only the resulting text may be sent, and that is declared under Other User Content."*

### 4.2 Search History 报 Yes，是不是过度申报

是偏保守的报法。「问」里的问题严格说更像 Other User Content，但它字面上就是"searches performed in the app"，而且确实会发出去。**多报一项不会被拒，漏报一项会。** 建议保持 Yes。

### 4.3 Contact Info 报 Yes 的条件

只有接入 Gmail 或 Notion 时才成立——邮件正文里的人名和邮箱会跟着正文一起进入模型请求。Apple 要求申报应用**可能**收集的一切，所以即使大多数用户不接连接器，也要报。

如果想把这一项降成 No，唯一干净的办法是在发给模型之前对邮件做一次人名/邮箱脱敏。这是一个功能改动，不是申报改动。

### 4.4 自动录音是最大的审核风险，不是申报问题

[listen.js](../../src/main/listen.js) 里有一个默认关闭的开关：打开后 briffy 持续持有麦克风，有人说话就存一段。**申报上它不改变任何答案**（音频从不离开本机，Audio Data 仍是 No），但审核上它是这个应用最容易被质疑的一处——一个后台监听麦克风的应用会被反复追问。

提交前必须准备好的三件事：

1. **Review Notes 里主动写明**：默认关闭、需要用户在设置里显式打开、打开时 macOS 全程显示橙色麦克风指示点、录音只写在本机。
2. **应用内的告知**。打开这个开关时应当有一次明确的说明（会录到别人、当地法律可能要求所有人同意），而不是一个光秃秃的 toggle。这是**功能改动**，建议在提交前做掉。
3. **隐私政策里单独一节**。已写：<https://briffy.cc/privacy> 的「自动录音，单独说」。

### Sensitive Info 报 No 的边界

一张截图里可以出现任何东西，包括 Apple 定义的敏感类别。但申报问的是应用**是否为此目的采集**，答案是否。缓解措施要写进 Review Notes：截图只在用户按下快捷键或点小猫时发生（无后台连续录屏），云端 AI 默认关闭，且随时可整体关掉。

---

## 5. 提交时还要准备的

| 项 | 状态 |
| --- | --- |
| Privacy Policy URL（必填，公网可访问） | ✅ `https://briffy.cc/privacy` · `https://briffy.cc/en/privacy`（源文件 [site/privacy.html](../../site/privacy.html)，`npm run deploy` 发出去） |
| 第三方 SDK 申报 | `@anthropic-ai/sdk` — 用于把内容发给用户自己的 Anthropic 账号。`@huggingface/transformers` / `onnxruntime-node` / `sherpa-onnx-node` / `ppu-paddle-ocr` 全部本机推理，不联网上报 |
| `PrivacyInfo.xcprivacy` 隐私清单 | **macOS 不需要**。required-reason API 与隐私清单的强制要求只针对 iOS / iPadOS / tvOS / watchOS |
| 出口合规（Export Compliance） | 已在 Info.plist 里写了 `ITSAppUsesNonExemptEncryption = false`：只用 HTTPS 和系统钥匙串，属豁免。这样每次提交不再被问 |
| Data Use 与政策一致性 | 本表与 [site/privacy.html](../../site/privacy.html) 逐条对应；改一处必须改另一处 |
