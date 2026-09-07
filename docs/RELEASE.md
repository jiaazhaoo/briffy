# 发布 macOS 版 / Releasing for macOS

签名 + 公证 + DMG 直接下载。**这是当前的发布路径**；Mac App Store 需要的改造见 [docs/app-store/mas-blockers.md](app-store/mas-blockers.md)。

---

## 这台机器上已经就绪的

| | |
| --- | --- |
| Team ID | `5B88JH77HT` |
| 签名证书 | `Developer ID Application: jia zhao (5B88JH77HT)` ✅ 已安装 |
| Xcode | 26.0.1 ✅ |
| 目标架构 | **arm64 only**（Apple Silicon）。见下面「为什么不出 Intel 版」 |
| 最低系统 | macOS 13.0（Electron 44 的下限） |

签名证书**不写在 `package.json` 里**——仓库是公开的，那是维护者这台机器上的东西，
不该出现在共享配置里，别人 clone 下来也会因为找不到这张证书而打包失败。改用
electron-builder 认的环境变量 `CSC_NAME`：

```bash
export CSC_NAME="jia zhao (5B88JH77HT)"
```

**不带** `Developer ID Application:` 前缀。electron-builder 26 要求去掉前缀，由它按目标类型自己挑证书（这台机器上同时装着 MAS 用的 `Apple Distribution`，前缀反而会让它报错）。

没有这个变量时（任何 fork 的情况）electron-builder 会跳过签名，打出一个未签名的
DMG——能装、能跑，但首次打开要在「系统设置 › 隐私与安全性」里放行。

---

## 还差一步：公证凭据

公证要拿你的 Apple ID 和一个 **app-specific password**（不是账号密码）。这一步必须你自己做：

1. 去 [appleid.apple.com](https://appleid.apple.com) › 登录与安全 › App 专用密码 › 生成一个，命名 `briffy-notary`。
2. 存进钥匙串，之后就不用再碰它：

```bash
xcrun notarytool store-credentials briffy-notary --apple-id "你的@apple.id" --team-id 5B88JH77HT
```

（命令会交互式地问那个 app-specific password。）

3. electron-builder 读的是环境变量，不是钥匙串 profile，所以打包时给它：

```bash
export CSC_NAME="jia zhao (5B88JH77HT)"
export APPLE_ID="你的@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID=5B88JH77HT
```

**别把这四行写进仓库里的任何文件。** 放 `~/.zshrc`，或者临时 `export` 一次。

---

## 打一个版本

```bash
npm run release:mac
```

等于 `fetch-models` → `fetch-fonts` → `electron-builder --mac` → `verify:mac`。产物在 `release/`：

- `briffy-<版本>-arm64.dmg` ← 给用户下载的
- `briffy-<版本>-arm64-mac.zip` ← 留着，以后接自动更新要用它
- `latest-mac.yml` ← 同上

想快速试一个不公证的本地包：

```bash
npm run pack        # electron-builder --dir，签名但不公证，快得多
npm run verify:mac
```

---

## 验证（每次发布都要跑）

```bash
npm run verify:mac
```

`dev/mac-release-check.js` 按 Gatekeeper 的顺序过一遍：签名与 `--deep --strict`、证书是不是 Developer ID、team ID、hardened runtime、安全时间戳、**签名里真正嵌进去的 entitlements**、Info.plist 里每一条权限说明、架构、`app.asar.unpacked` 里 11 个 `.node`/`.dylib` 是不是都签了、公证票是否 stapled、以及 `spctl` 最终判定。

全绿才发。它存在的理由是：上面每一项单独失败时，在**开发机上都看不出来**——公证漏了的包在本机照样打开，少一条 entitlement 只表现为某个功能默默不工作。

**⚠️ 公证会被静默跳过。** 三个环境变量缺任何一个，electron-builder 只打印一行 `skipped macOS notarization` 就继续，产物看起来完好无损，但在别人机器上打不开。`verify:mac` 里那两条 Notarisation 检查就是拦这个的：

```
✗ ticket stapled — not notarised yet
✗ Gatekeeper — rejected | source=Unnotarized Developer ID
```

---

## 发出去之前，在一台别的 Mac 上

公证的意义是让**从没见过这个应用**的机器敢打开它。所以最后一步不能在打包这台机器上做：

```bash
# 在另一台 Mac 上，或者给下载来的 dmg 手动打上隔离标记
xattr -w com.apple.quarantine "0081;00000000;Safari;" ~/Downloads/briffy-*.dmg
open ~/Downloads/briffy-*.dmg
```

要看到的是直接打开，**没有**「无法验证开发者」。

然后走一遍首次使用：引导六步 → 给屏幕录制和麦克风权限 → **重启应用**（屏幕录制必须重启才生效）→ 截一张图 → 录一段 → 看记录页。系统设置里要找的是 **briffy**，不再是 Electron。

---

## 已知的取舍

**没有自动更新。** 现在装了 briffy 的人不会知道有新版本。`zip` 和 `latest-mac.yml` 已经在打了，接 `electron-updater` + GitHub Releases 只差写代码——但那是一个功能，不在这次的发布准备里。**在做之前，每次发版都得自己在下载页说一声。**

**为什么不出 Intel 版。** `sherpa-onnx-node`（说话人分段）没有 darwin-x64 预编译库。硬要出 x64 包，得先确认这台机器上装得到 x64 的 optional dependencies，且那个功能在 Intel 上是关着的。README 已经这么说了；`build.mac.target` 现在把 arm64 写死，避免出一个半残的包。

**版本号还是 `0.1.0`。** 第一个公开版本按惯例该是 `1.0.0`。这是你的决定，改 `package.json > version` 一处即可。

**`NSScreenCaptureUsageDescription` 是装饰。** 留在 Info.plist 里说明意图，但 macOS 的屏幕录制授权弹窗**不读 Info.plist**，用的是系统固定文案。别指望改这句话能改屏幕上的字。

**Windows 那条路没动。** `npm run dist:win` 照旧，`build.win` 一个字没改。Windows 侧的代码签名（EV 证书 / Azure Trusted Signing）是另一件事。
