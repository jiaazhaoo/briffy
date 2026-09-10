# 提交清单 —— 按后台页面顺序照抄

配套：[chrome-web-store.md](chrome-web-store.md) 是「为什么这么填」，这一份是「填什么、在哪一栏」。
后台 <https://chrome.google.com/webstore/devconsole> → 你的项目 → 左边四个标签，从上往下走一遍。

素材都在仓库里，路径可直接拖进上传框：

```
release/briffy-extension-0.1.2.zip      上传包
assets/store/screenshots/01.png         截图 1（1280×800）
assets/store/screenshots/02.png         截图 2（1280×800）
assets/store/promo-440x280.png          小宣传磁贴（可选）
extension/icons/128.png                 商店图标（清单里已声明，一般会自动带上）
```

---

## ① Package（软件包）

上传 `release/briffy-extension-0.1.2.zip`。

传完后台会读清单，**Product name 和 Summary 自动带出来**，不用手打：

| 字段 | 值 |
| --- | --- |
| Product name | `briffy 网页媒体采集` |
| Summary（≤132） | `把当前网页里的图片、视频、音频一键发送到 briffy 工作区。` |
| Version | `0.1.2` |

---

## ② Store listing（商店列表）

| 字段 | 填 |
| --- | --- |
| Category | **Workflow & Planning** |
| Language | **中文（简体）** |
| Store icon | 清单里的 128×128，通常自动带上；要手传就用 `extension/icons/128.png` |
| Screenshots | 传 `01.png`、`02.png`（顺序就是展示顺序） |
| Small promo tile | `assets/store/promo-440x280.png`（可选，只影响能不能进推荐位） |
| Official URL / Website | `https://briffy.cc` |
| Support URL | `https://github.com/jiaazhaoo/briffy/issues` |

**Description**（整段照抄）：

```
briffy 的浏览器扩展。它把这一页里你想留下的东西，交给装在同一台电脑上的 briffy。

在任意网页按 Alt+Shift+D（macOS 是 Option+Shift+D），或点扩展图标，面板会列出这一页所有的图片、视频和音频，按类型和最小边长筛一下，勾好点「发送到 briffy」。

它找得到 DOM 里看不见的视频。用 MSE 的播放器，<video> 上挂的只是一个 blob 地址，真正的流由页面自己的脚本一段一段拉——所以扩展在页面代码跑起来之前就守着那些请求，只看经过的地址、不拦不改不读内容，认出播放列表和分片。什么都没找到时，面板会说明为什么：这一页有几个 video、地址是不是 blob、有没有检测到 MSE。

你在网页上按下它自己的「收藏」时，扩展也会认出来，把那一页连正文一起存进 briffy——不是存一个链接。

数据只走到你自己的电脑上。所有东西都发给本机的 briffy（127.0.0.1），没有账号，没有我们的服务器，没有统计代码。

需要先装 briffy 桌面端：https://briffy.cc

源码：https://github.com/jiaazhaoo/briffy/tree/main/extension
```

⚠️ **最后那句「需要先装 briffy 桌面端」别删** —— 装完发现「什么都没发生」的用户会来打一星。

---

## ③ Privacy practices（隐私实践）

这一页最容易被打回，逐栏照抄。

**Single purpose**（单一用途）：

```
Hand over what the user saves on a web page to briffy, the user's own note-taking app running on the same computer. Everything the extension does serves that one hand-off: finding the images, video and audio on the page the user asks about, noticing when the user saves or bookmarks a page, and telling briffy which page is open so a saved item knows where it came from.
```

**Permission justification**（每个权限一栏，一个都不能空）：

| 权限 | 理由 |
| --- | --- |
| `activeTab` | Reads the page the user is currently acting on, and only when they act: pressing the shortcut or clicking the toolbar icon. |
| `scripting` | Injects the scanners that list the media on the page. Also re-injects into already-open tabs once after install or update, because content scripts otherwise only run on the next navigation and the extension would appear broken in every tab the user already had open. |
| `storage` | Remembers the local port briffy listens on and the user's own filter choices (type, minimum edge length) between sessions. No page content is stored. |
| `webRequest` | Observes response URLs only, to find media the page never puts in the DOM — players built on MSE fetch their segments from JavaScript, so the `<video>` element carries only a `blob:` URL. Nothing is blocked, redirected or modified; Manifest V3 has no blocking webRequest and this extension does not use one. Response bodies are never read. |
| `tabs` | Needs the tab's URL and title: to name a saved item when the media URL has no filename, to pass the page as `Referer` so hotlink-protected images actually load, and to tell briffy which page is open. |
| `alarms` | Two periodic jobs: a five-minute heartbeat so briffy can show "extension connected" without the user opening the popup first, and a one-minute re-report of the active tab so that staying on one page still counts as being on it. |
| `declarativeNetRequestWithHostAccess` | Sets a `Referer` header on the extension's own fetch of one media URL it is about to send to briffy. Video CDNs reject requests without the originating page as Referer. The rule is created per request, scoped to that single URL, and removed straight after. |
| **Host permission** `<all_urls>` | The media a user wants is on whatever site they are reading — a news page, a forum, a video site. There is no list of hosts that could be enumerated in advance, and the extension does nothing on a page until the user asks it to. |

**Are you using remote code?** → **No, I am not using remote code**
（全部脚本都在包里；没有 `eval`、没有 `new Function`、没有远程 `import`。`npm run ext:pack` 每次都会查这一条。）

**Data usage**（勾选表）：

| 类别 | 勾？ |
| --- | :---: |
| Personally identifiable information | ☐ |
| Health information | ☐ |
| Financial and payment information | ☐ |
| Authentication information | ☐ |
| Personal communications | ☐ |
| Location | ☐ |
| **Web history** | ☑ |
| **User activity** | ☑ |
| **Website content** | ☑ |

**三项认证全部勾上**（都是事实：数据只发给 `127.0.0.1`，没有第三方，也没有我们的服务器）：

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**：

```
https://briffy.cc/zh/privacy
```

---

## ④ Distribution（分发）

| 字段 | 填 |
| --- | --- |
| Visibility | **Public** |
| Distribution | 所有地区（除非你有理由限制） |

---

## ⑤ 提交前，把这段贴进 Review notes

审核会看到「一个在页面世界里改写了 fetch / XHR 的扩展」，那是注入型恶意扩展的典型手法。不解释就等着被问：

```
hook.js runs in the page's own world because that is the only place a media stream can be seen. Players built on Media Source Extensions fetch their segments from page JavaScript and attach only a `blob:` URL to the `<video>` element, so an isolated content script sees nothing at all. hook.js wraps `fetch`, `XMLHttpRequest.open` and `URL.createObjectURL` to OBSERVE the URLs that pass through. It does not block, redirect or rewrite any request, never reads a response body, and reports only URLs shaped like media or a manifest — ordinary API calls are ignored. There is no remote code anywhere in the extension.

The extension talks only to briffy, the user's own desktop app, on http://127.0.0.1. There is no server of ours and no account.

Reporting the active tab (Web history) is OFF by default: the extension sends nothing until briffy's reply to its own heartbeat asks for it (wantTab, default false), which requires briffy to be running with that setting on.

briffy for macOS: https://briffy.cc
```

---

## ⑥ 提交之后

- **`<all_urls>` 走人工审核队列**，通常几天，不是几小时
- 过审后把商店地址填进 [src/main/extension-store.js](../src/main/extension-store.js) **一处**，然后 `npm run deploy` —— 应用里的引导页、设置里的说明、官网那个按钮会一起亮
