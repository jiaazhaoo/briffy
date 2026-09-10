# briffy

一个 Electron 桌面伴侣：把你截的图、复制的东西、拖进来的文件、录的音存成一天一天的记录，
然后可以问它。**闭源**（PolyForm Noncommercial 1.0.0，禁止商用）；对外说「源码公开」，不说「开源」。

- 主进程 `src/main/` · 渲染层 `src/renderer/{workspace,pet,viewer,region,onboarding}` · 桥 `src/preload/`
- 为什么长这样 → [docs/NOTES.md](docs/NOTES.md)（每一节都是一个决定，以及量出来的、让它变成那个决定的数）
- **动任何界面之前先读 [.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md)**（视觉标准，637 行，硬约束）

## 跑起来

```
npm start                      应用
npm test                       28 个台子，约 7 秒；它自己会列出要 electron 的和要传参数的
npx electron dev/xxx-test.js   要 electron 的那 18 个
npm run preview                http://localhost:5173/ 用假数据跑真界面（/pet /viewer /shelf /region /onboarding）
```

## 不能违反的

这些不是偏好，是这个产品之所以敢让人一直开着的原因。改动碰到任何一条，先说，别自己决定。

- **不丢任何数据。** 采集的原件一个字节不动——不翻译、不改写、不「优化」。派生的东西
  （缩略图、OCR 旁路文件、索引）删了能再生成，原件不能。
- **存下来的图片不发给模型。** 给模型的是 OCR 抽出来的字和本机分类器的标签
  （`workspace.js` 的 `aiInput` 不带 `image` 字段）。这条在「一键翻译」「问」「摘要」上都算数。
- **入库不等模型。** `store.addEntry` 当场落盘，`processEntry` 之后慢慢加工。
  没配 AI、断网、模型挂了——记录照样是完整的一条，只是没有标题和标签。
- **出门前先脱敏**（`redact.js`）：卡号、身份证、IBAN、密钥全靠校验位认，不靠模型。
  盖的只是**离开这台电脑的那一份**，存下来的原件不动。
- **ffmpeg 不打包，也不下载散装二进制。**
- **不要词表，用向量。** 靠一张手写的词表挡噪音，这个仓库试过，越挡越长。
- **不造轮子。** 系统给得出的就用系统的（缩略图走 `nativeImage.createThumbnailFromPath`，
  文字走辅助功能树，OCR 兜底）。
- `assets/brand/` 那份美术**不能删**。

## 先量一遍

这个仓库的所有结论都是量出来的，`docs/NOTES.md` 开篇就是这么写的。
**动任何用户看得见的东西之前，先把真库量一遍**——不止一次出现过「凭印象说的结论是反的」。
怎么量、有哪些现成的台子、两个坑在哪：[.claude/skills/measure-first/SKILL.md](.claude/skills/measure-first/SKILL.md)。

## 几个会咬人的地方

- **`src/renderer/workspace/workspace.js` 是一整个作用域里的三千多行**，函数名会撞
  （`chip` 撞过一次，症状是另一个函数的报错）。加顶层函数前先 grep 一下名字。
- **`store.workspaceDir` 是 getter**：strict 下赋值抛错，非 strict 下**静默失败**（量到空库还不知道）。
  要设就写 `store.settings = { workspaceDir }`，台子一律写 `'use strict'`。
  `store.paths()` 会问 `app.getPath('userData')`，所以在纯 node 里跑要垫一个假的 electron。
- **筛选行上每个数都必须等于点下去之后屏幕上的条数**：`listEntries` 和 `stats` 共用
  `store.entryMatches`，别在任何一边单独补规矩——这条错过一次，行上写 203、屏上摆 19。
  守卫是 `dev/filter-count-test.js`。
- **提交前看一眼 `git log`**：这个仓库常有另一个会话在同几个文件里同时干活。

## 提交

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

提交信息用中文，说清楚**为什么**和**量出来的数**，跟着 `git log` 现有的调子走。
