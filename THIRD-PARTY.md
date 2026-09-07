# 第三方组件 / Third-party components

本仓库自身的许可是 [PolyForm Noncommercial 1.0.0](LICENSE)（禁止商用）。
**下面这些东西不是本仓库写的，也不受那份许可约束**——它们各自沿用上游许可，
其中大部分（MIT / Apache-2.0 / BSD / OFL）都允许商业使用。换句话说：
禁止商用的是 briffy 这份代码，不是它用到的库、模型和字体。

The license on this repository covers briffy's own source. Everything listed
below keeps its upstream license; most of it (MIT / Apache-2.0 / BSD / OFL)
permits commercial use.

---

## 1. npm 依赖 / npm dependencies

不随仓库分发（`node_modules/` 在 `.gitignore` 里），由 `npm install` 取回；
随安装包分发。285 个包，全部许可如下：

| 许可 | 包数 |
| --- | --- |
| MIT | 199 |
| ISC | 26 |
| Apache-2.0 | 20 |
| BSD-3-Clause | 19 |
| BlueOak-1.0.0 | 6 |
| BSD-2-Clause | 6 |
| 其它宽松（0BSD / Unlicense / WTFPL / Python-2.0 / 双许可） | 7 |
| **LGPL-3.0-or-later** | **1** |

唯一一个 copyleft 是 **libvips**（`@img/sharp-libvips-*`，LGPL-3.0-or-later），
`sharp` 的原生后端。LGPL 允许作为**动态链接的库**在非 LGPL 程序里使用而不传染，
本项目正是这样用的（预编译 `.node` / `.dylib`，未静态链接、未修改）。
LGPL 要求最终用户能替换该库——安装包里它是 asar 之外的独立文件（见 `package.json`
的 `asarUnpack`），可以直接替换，条件满足。上游源码：<https://github.com/libvips/libvips>。

复核一遍：

```bash
npx license-checker --summary
```

## 2. 本机模型 / Bundled models

`scripts/fetch-bundled-models.js` 下载，随安装包分发，不进仓库：

| 模型 | 用途 | 上游 | 许可 |
| --- | --- | --- | --- |
| PP-OCRv6 tiny / small (`.ort`) | 文字识别 | [snowfluke/ppu-paddle-ocr-models](https://huggingface.co/snowfluke/ppu-paddle-ocr-models)，源自 PaddleOCR | Apache-2.0 |
| `Xenova/whisper-tiny.en` | 英文语音转写 | [Hugging Face](https://huggingface.co/Xenova/whisper-tiny.en)，源自 OpenAI Whisper | Apache-2.0 |

运行时按需下载的（`whisper-small`、多语言模型、sherpa-onnx 的说话人分离模型）同样是
Apache-2.0 / MIT，下载到用户自己的 `userData`，不随包分发。

用户自己配置的 Ollama 本地模型（Qwen 等）遵循各自的模型许可，由用户自行确认。

## 3. 字体 / Fonts

`scripts/fetch-fonts.js` 下载到 `assets/fonts/`（不进仓库，随安装包分发）。
五套全部是 **SIL Open Font License 1.1**，许可原文与各自的版权行随字体一起落盘到
`assets/fonts/licences/`：

| 字体 | 版权方 |
| --- | --- |
| Noto Sans SC / Noto Serif SC（思源黑 / 思源宋） | Google & Adobe，见 [noto-cjk](https://github.com/notofonts/noto-cjk) |
| Source Sans 3 | Adobe，见 [source-sans](https://github.com/adobe-fonts/source-sans) |
| Source Serif 4 | Adobe，见 [source-serif](https://github.com/adobe-fonts/source-serif) |
| IBM Plex Mono | IBM，见 [plex](https://github.com/IBM/plex) |

字体文件从各家自己的仓库取许可原文，不用 `@fontsource` 那份（那五份 LICENSE
字节相同、且都写着 Google Inc.，对 Adobe 和 IBM 的两家来说版权行是错的）。
OFL 要求版权声明随字体保留，这一条靠这个安排满足。

## 4. 图片素材 / Artwork

| 素材 | 来源 | 说明 |
| --- | --- | --- |
| `assets/brand/briffy.svg`、`assets/icon*.png`、`assets/tray*.png`、`assets/pet/avatar.png`、`assets/brand/original-avatar.jpg` | 本项目原创 | 版权归 Jia Zhao，随本仓库许可 |

`assets/pet/default-cat.svg`、`assets/pet/avatar.png` 是本项目自己画的兜底形象。

仓库里**没有任何从第三方网站抓来的内容**。曾经有过一份 ipaslogo.com 的形象索引，
随 2026-09-06 删掉形象图库一起移除了。

## 5. 借用的方法 / Derived work

`.claude/skills/pet-as-character/SKILL.md` 改编自
[ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill)（MIT），
出处与差异写在该文件开头。

## 6. 品牌与商标 / Name and marks

"briffy" 这个名字、小猫形象和 logo 是本项目的标识，**不在**本仓库的代码许可范围内。
你可以按许可 fork、修改、再分发这份代码，但**不要用 briffy 这个名字或它的 logo**
去发布你的分支，以免让人以为那是本项目的官方版本。请换一个名字。

The briffy name and logo are not licensed with the code. Fork and modify freely
under the license, but ship your fork under a different name.
