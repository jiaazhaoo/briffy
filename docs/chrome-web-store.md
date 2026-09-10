# 发布浏览器扩展 / Chrome Web Store

`extension/` 上架 Chrome 应用商店要交的每一样东西。**逐字照抄即可**，但第 5 节那三处审核风险请先读一遍。

```bash
npm run ext:pack     # → release/briffy-extension-<版本>.zip，上传前把商店会拒的东西先查一遍
```

---

## 1. 先把「一个用途」讲对

商店最常见的拒审理由不是权限，是 **single purpose**：一个扩展只能做一件事。briffy 扩展看起来做了三件——挑媒体、认收藏、报当前页——所以必须把它们说成同一件：

> **Single purpose**（填进开发者后台那一栏）
>
> Hand over what the user saves on a web page to briffy, the user's own note-taking app running on the same computer. Everything the extension does serves that one hand-off: finding the images, video and audio on the page the user asks about, noticing when the user saves or bookmarks a page, and telling briffy which page is open so a saved item knows where it came from.

三个能力对应到代码，说的是同一件事：

| 能力 | 代码 | 怎么算同一个用途 |
| --- | --- | --- |
| 挑出这一页的图片 / 视频 / 音频 | [scan.js](../extension/scan.js)、[hook.js](../extension/hook.js)、[classify.js](../extension/classify.js) | 用户按 `Alt+Shift+D` 主动要的 |
| 认出「你刚收藏了这个」 | [savedetect.js](../extension/savedetect.js)、[bookmark.js](../extension/bookmark.js) | 用户按了页面自己的收藏按钮 |
| 告诉 briffy 现在开着哪一页 | [background.js](../extension/background.js) `reportTab` | 让存下来的东西知道自己来自哪儿 |

**不要**在后台把它写成「a media downloader」。那是另一个类别，会被拿去和下载器一起审，还会撞上 5.2.3 那类版权条款。

---

## 2. 权限逐条理由

后台要求**每一个权限单独写理由**，写得含糊会被打回。以下逐条照抄：

| 权限 | 理由（照抄进 Permission justification） |
| --- | --- |
| `activeTab` | Reads the page the user is currently acting on, and only when they act: pressing Alt+Shift+D or clicking the toolbar icon. |
| `scripting` | Injects the scanners that list the media on the page. Also re-injects into already-open tabs once after install or update, because content scripts otherwise only run on the next navigation and the extension would appear broken in every tab the user already had open. |
| `storage` | Remembers the local port briffy listens on and the user's own filter choices (type, minimum edge length) between sessions. No page content is stored. |
| `webRequest` | Observes response URLs only, to find media the page never puts in the DOM — players built on MSE fetch their segments from JavaScript, so the `<video>` element carries only a `blob:` URL. Nothing is blocked, redirected or modified; Manifest V3 has no blocking webRequest and this extension does not use one. Response bodies are never read. |
| `tabs` | Needs the tab's URL and title: to name a saved item when the media URL has no filename, to pass the page as `Referer` so hotlink-protected images actually load, and to tell briffy which page is open. |
| `alarms` | Two periodic jobs: a five-minute heartbeat so briffy can show "extension connected" without the user opening the popup first, and a one-minute re-report of the active tab so that staying on one page still counts as being on it. |
| `declarativeNetRequestWithHostAccess` | Sets a `Referer` header on the extension's own fetch of one media URL it is about to send to briffy. Video CDNs reject requests without the originating page as Referer. The rule is created per request, scoped to that single URL, and removed straight after. |
| `host_permissions: <all_urls>` | The media a user wants is on whatever site they are reading — a news page, a forum, a video site. There is no list of hosts that could be enumerated in advance, and the extension does nothing on a page until the user asks it to. |

---

## 3. Privacy practices — 逐项申报

后台 **Privacy practices** 那一页的答案。**必须填隐私政策 URL**，因为下面有三项是「收集」。

| 商店的分类 | 收集？ | 说明（照抄进 "What data do you collect and why"） |
| --- | :---: | --- |
| Personally identifiable information | No | — |
| Health information | No | — |
| Financial and payment information | No | — |
| Authentication information | No | — |
| Personal communications | No | — |
| Location | No | — |
| **Web history** | **Yes** | The URL and title of the active tab are sent to briffy running on the same computer, so that something the user saves knows which page it came from. This is **off by default**: the extension sends nothing until briffy's reply to its own heartbeat asks for it (`wantTab`, default `false`), which requires briffy to be running with that setting on. The data goes to `http://127.0.0.1` — the user's own machine — and to no server of ours. |
| **User activity** | **Yes** | The extension observes the URLs of media responses on pages the user visits, in order to find video and audio that the page does not expose in its markup. Only URLs are looked at, only ones shaped like media or a playlist, and response bodies are never read. |
| **Website content** | **Yes** | The images, video and audio the user picks in the panel, and the text of a page they save or bookmark, are sent to briffy on the same computer. When the user turns on briffy's "no-hands" layer, the text of the active page is included too (`wantText`, default `false`). |

三项认证全部**勾选**，都是事实：

- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases — 数据只发给 `127.0.0.1`，**没有第三方，也没有我们的服务器**。
- ✅ I do not use or transfer user data for purposes that are unrelated to my item's single purpose — 唯一用途就是交给本机的 briffy。
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes。

**Privacy policy URL**：`https://briffy.cc/zh/privacy`（中文，和列表语言一致）· `https://briffy.cc/privacy`（English）
站点 2026-09-10 改成英文在根、中文在 `/zh/`；旧的 `/en/privacy` 现在是 301，能用但不是规范地址。

---

## 4. 商店列表文案

| 字段 | 内容 |
| --- | --- |
| Item name（清单里的 `name`，≤75） | `briffy 网页媒体采集` |
| Summary（≤132，即清单里的 `description`） | `把当前网页里的图片、视频、音频一键发送到 briffy 工作区。` |
| Category | Workflow & Planning |
| Language | 中文（简体） |
| Website | `https://briffy.cc` |
| Support URL | `https://github.com/jiaazhaoo/briffy/issues` |

**Detailed description**（照抄）：

> briffy 的浏览器扩展。它把这一页里你想留下的东西，交给装在同一台电脑上的 briffy。
>
> 在任意网页按 Alt+Shift+D（或点扩展图标），面板会列出这一页所有的图片、视频和音频，按类型和最小边长筛一下，勾好点「发送到 briffy」。
>
> 它找得到 DOM 里看不见的视频。用 MSE 的播放器，`<video>` 上挂的只是一个 blob 地址，真正的流由页面自己的脚本一段一段拉——所以扩展在页面代码跑起来之前就守着那些请求，只看经过的地址、不拦不改不读内容，认出播放列表和分片。什么都没找到时，面板会说明为什么：这一页有几个 video、地址是不是 blob、有没有检测到 MSE。
>
> 你在网页上按下它自己的「收藏」时，扩展也会认出来，把那一页连正文一起存进 briffy——不是存一个链接。
>
> **数据只走到你自己的电脑上。** 所有东西都发给本机的 briffy（127.0.0.1），没有账号，没有我们的服务器，没有统计代码。需要先装 briffy 桌面端：https://briffy.cc
>
> 源码：https://github.com/jiaazhaoo/briffy/tree/main/extension

---

## 5. 三处审核风险（先读，再提交）

### 5.1 `hook.js` 在页面世界里包住 fetch / XHR —— 最容易被误读

[hook.js](../extension/hook.js) 在 `document_start` 往 `world: "MAIN"` 注入一段脚本，包住 `fetch`、`XMLHttpRequest.open` 和 `URL.createObjectURL`。审核看到「改写页面的网络函数」会警觉，因为这是注入型恶意扩展的典型手法。

**它不是那个**，而且理由要写进 Review notes：只**观察**经过的 URL，不拦截、不改写、不读响应体，只上报形状像媒体或清单的那些。这一层有回归测试（`node dev/media-detect-test.js`，30 条用例）。

**Review notes 里照抄这一段：**

> hook.js runs in the page's own world because that is the only place a media stream can be seen. Players built on Media Source Extensions fetch their segments from page JavaScript and attach only a `blob:` URL to the `<video>` element, so an isolated content script sees nothing at all. hook.js wraps `fetch`, `XMLHttpRequest.open` and `URL.createObjectURL` to **observe** the URLs that pass through. It does not block, redirect or rewrite any request, never reads a response body, and reports only URLs shaped like media or a manifest — ordinary API calls are ignored. There is no remote code anywhere in the extension.

### 5.2 `<all_urls>` 会让审核变慢

用了广泛主机权限的扩展走人工审核，通常几天而不是几小时。**这一条没有捷径**——媒体在哪个网站上是用户决定的，列不出白名单。别为了过审改成一小串域名：那样对大部分页面就不工作了。

### 5.3 扩展要求装一个桌面应用

商店允许，但**列表页必须说清楚**，否则用户装完发现「什么都没发生」就来打一星。上面的 Detailed description 最后一段已经写明「需要先装 briffy 桌面端」，**别删掉那一句**。

---

## 6. 还差的素材

| 素材 | 规格 | 必需？ | 状态 |
| --- | --- | :---: | --- |
| 商店图标 | 128×128 PNG | 必需 | ✅ [extension/icons/128.png](../extension/icons/128.png) |
| 截图 | 1280×800 或 640×400，1–5 张 | **必需（至少 1 张）** | ⚠️ **只能你自己截**，见下。截完 `npm run store:shots -- <图…>` 垫成规定尺寸 |
| 小宣传磁贴 | 440×280 PNG | 可选 | ✅ [assets/store/promo-440x280.png](../assets/store/promo-440x280.png) — `npm run store:assets` 重新生成 |
| 隐私政策 | 公网 URL | 必需 | ✅ `https://briffy.cc/zh/privacy`（中文）· `/privacy`（英文），两个都 200 |

**尺寸交给脚本**：商店只收 1280×800 或 640×400，屏幕截图永远不是这两个尺寸，而后台会**替你拉伸**——
一张界面截图拉伸之后字就歪了，那是最容易让人一眼觉得「这东西不专业」的地方。
`npm run store:shots -- ~/Desktop/shot1.png …`（[scripts/store-shots.js](../scripts/store-shots.js)）
只等比缩放不变形，剩下的地方垫 `--page` 那个底纸色——商店页面是白底，纯白留边会和页面糊在一起，
而底纸色那一圈读起来是「它本来就长这样」。给几张出几张，顺序就是商店里的展示顺序。

**截图为什么只能你自己截**：面板里的内容来自真实网页 + 真实的后台 worker，把 `popup.html`
单独打开只会得到一个空面板——那不是截图，是假图。审核会看，用户更会看。所以：把
`release/briffy-extension-<版本>.zip` 解开、在自己的 Chrome 里加载已解压，然后截这三张：

1. 一个真实的视频页（B 站 / YouTube 都行）按 `Alt+Shift+D`，面板列出媒体、勾了几个
2. 发送之后 briffy 工作区里出现的那几条 —— 回答「然后呢」。只看面板的人不知道东西去哪了

**空状态那张不要拍**（2026-09-10 定的）。原来的计划是拍「面板说明为什么没找到」那段诊断，
但它的条件（[popup.js:92](../extension/popup.js:92)）是 `state.players`（有 `<video>` 且地址是 `blob:`）
加 `state.mse`——也就是**必须是一个视频站的页面**，而那正好撞上 §5.3 要避开的框架。
用户原话：「youtube 视频是无法下载的」。他说得对，而且比框架问题更实：
`background.js:33` 那种「N 个分片」的条目定义就是**看到了分片、从没抓到播放列表**，
而 App 那边要靠清单才能拼——所以那类条目是「这儿有视频」的记录，不是能取回的文件。
拿它当商店截图是在夸大。**商店最少只要 1 张，两张够了，而且两张都站得住。**


**磁贴是怎么来的**：`npm run store:assets`（[scripts/gen-store-assets.js](../scripts/gen-store-assets.js)）
在 Electron 里开一扇看不见的窗，用**真的** `tokens.css` 和 `assets/fonts/` 里那几个 woff2 渲染，
按四倍分辨率截下来再缩到 440×280。绕开 Electron 用 `@napi-rs/canvas` 是不行的——它注册不了 woff2，
只能拿系统字画，那就成了一张用 Helvetica 写着 briffy 的磁贴，是错的品牌资产。
回形针的路径数据逐字符照抄 `assets/brand/briffy.svg`。改了品牌就重跑一次这条命令。

---

## 7. 发布之后，回来改一处

商店分配的扩展 ID 和 URL 只有发布之后才知道。拿到之后填进**一处**：

```js
// src/main/extension-store.js
const CHROME_WEB_STORE_URL = '';   // ← 填这里
```

填上之后，应用里那个「装浏览器扩展」的入口和它打开的引导页会自己把「商店安装」变成第一条路，`chrome://extensions` 加载已解压的那三步退成折叠起来的备用路径。**不填也不会坏**——只是继续走现在的加载已解压流程。

同一个常量也会被 [site/index.html](../site/index.html) 用到（`npm run site` 时注入），所以官网上那个「装扩展」的按钮跟着一起亮起来。
