# 参与 briffy / Contributing

先说清楚三件容易踩的事，再说怎么动手。

## 1. 许可：你交上来的代码按什么算

本仓库是 [PolyForm Noncommercial 1.0.0](LICENSE)（源码公开、禁止商用），不是 OSI 意义上的开源。
**提交 PR 即表示你同意：你贡献的内容按同一份许可进入本仓库，并且你把它在
本项目里（含本项目未来可能的商业版本）的使用权一并授予维护者。**
本项目没有单独的 CLA 文件，这一段就是全部约定。

如果你不接受这条，请不要提交 PR——fork 出去自己维护是完全可以的（许可允许），
换个名字发布即可，见 [THIRD-PARTY.md](THIRD-PARTY.md) 最后一节。

## 2. 别提交这些东西

- **任何真实的截图、录音、剪贴板内容、工作区文件**。这个项目处理的正是这类数据，
  贴 issue 前请自查。要示例数据就用 `dev/preview/mock-*.js` 里那套假数据。
- API Key、Apple ID、app-specific password、签名证书。它们全部走环境变量或系统
  密钥库，仓库里一个都不该有。
- `node_modules/`、`release/`、`bundled-models/`、`assets/fonts/`——都在 `.gitignore` 里，
  由脚本生成或下载。

## 3. 跑起来

```bash
npm install     # postinstall 会取 Electron 运行时和五套字体
npm start
```

改样式不用启动整个应用：

```bash
node dev/preview/serve.js   # http://localhost:5173/
```

`dev/` 下面是一批单文件自测脚本（`node dev/ocr-test.js` 这样直接跑），没有测试框架。
改到哪块就跑哪块对应的那个。

## 4. 提交之前

- **UI 改动**先读 [.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md)。
  纸质拟物、全直角、中英文混排的规矩都在里面，不合规的样式会被打回。
- **文案**跟着用户选的第一语言走：采集到的原文一字不动，软件自己写的话（标题、摘要、
  界面文字）用用户的语言。新字符串加进 [src/main/i18n.js](src/main/i18n.js)，三种语言都要给
  （`en` / `zh-CN` / `zh-TW`）。
- **提交信息写成一句人话**，说清这次改动做了什么决定，不要写 `fix bug`。
  看一眼 `git log` 就知道风格。
- 一个 PR 只做一件事。

## 5. 报安全问题

不要开 issue，见 [SECURITY.md](SECURITY.md)。
