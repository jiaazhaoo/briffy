# briffy 📎

**<https://briffy.cc>** · [Download](https://github.com/jiaazhaoo/briffy/releases) · [Why it works this way](docs/NOTES.md) · [Privacy](docs/PRIVACY.md) · [中文](docs/README.zh.md)

Writes down what you saw, heard and were handed — without you filing anything.

A paperclip sits in the corner of your screen. It **is** briffy: the two arches are the logo itself, drawn live by [briffy-anim.js](assets/brand/briffy-anim.js), not a picture pasted on.

Windows and macOS (Apple Silicon). Recognition runs on your machine.
Source-available, free for personal and non-profit use, **not for commercial use** — see [License](#license).

| Do this | Get this |
| --- | --- |
| **Click it** | Full screen, saved + OCR'd, and on your clipboard |
| **Double-click it** | Drag a box. The **long shot** button next to it scrolls the window itself and joins a whole page |
| **Middle-click it** (or hold 0.55 s) | Start / stop a voice note |
| Drop an image, file, link or text on it | Into the workspace — images get OCR, PDFs and pages get their text |
| Right-click it / the tray icon | Workspace, settings, write today's recap, hide, quit |
| Copy anything | Text, images and files land in the workspace as you copy them |
| Ctrl+Alt+A / S / V (⌘⇧A / S / V) | Box / full screen / voice note |
| Alt+Shift+D in the browser | The extension lists the page's images, video and audio to pick from |

## What it does

- **Everything saved describes itself** — a title, one sentence. A picture with no words in it is named by the local classifier. Every morning it writes up yesterday.
- **Ask it** — one line in the bar at the bottom. briffy picks the records locally, then the model reads only those and cites each one. Picking never involves a model, so it works offline and without a provider.
- **Search has two legs** — exact hits, plus ones that only *mean* the same thing. The second kind is always labelled, never mixed in with the first.
- **Look at a picture** — it opens in its own window: pen, mosaic, crop, translate, pin, copy.
- **Bring things in** — Notion pages and Gmail with your own credentials, or drag in an exported zip / mbox.
- **Two things it will do unasked, so both are off until you turn them on** — record meetings (only while another app holds the microphone, then transcribe and separate the speakers), and keep a trail of what you looked at (written somewhere else in the workspace, never mixed into your records).

OCR is PP-OCRv6, speech is Whisper, both through onnxruntime. It works with the network off.
**A picture is never sent to a model** — OCR already read the words.

Four providers (Settings › AI): Claude, OpenRouter, local Ollama, or any OpenAI-compatible endpoint. With none configured it still runs — titles fall back to filenames, the recap to a list.

## Run

```bash
npm install
npm start
```

`postinstall` fetches the Electron runtime (~367 MB, once) and five OFL typefaces into `assets/fonts/`. Electron 44 dropped its own postinstall hook, so this project runs it; if it is ever skipped, `npx install-electron`. Fonts skipped offline: `npm run fetch-fonts`.

`npm run fetch-models` is only for packaging — day to day, briffy downloads what it needs the first time it needs it.

**Nothing to configure.** On first launch it checks the machine and prepares the local OCR and speech engines itself. What you may want to change:

1. Right-click it → **Settings** → two language packs (default 简体中文 + English). They drive OCR, speech and the interface; the first one decides what language briffy writes in.
2. **AI** → pick a provider and hit **Test**. Keys go in the system keychain (DPAPI / Keychain), or through `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`.
3. macOS: grant **Screen Recording** and **Microphone** in System Settings › Privacy & Security. briffy runs as a menu-bar app and [stays out of the way of full-screen apps](docs/NOTES.md#第一次打开).

## The workspace

`<userData>/workspace` by default (`%APPDATA%\briffy\workspace`, `~/Library/Application Support/briffy/workspace`), changeable in settings:

```
workspace/
  entries/2026-09-03.json     one index per day: title, OCR / transcript, what a picture shows
  screenshots/2026-09-03/     the original PNGs
  audio/2026-09-03/           the recording, plus 16 kHz wav
  files/2026-09-03/           copies of what you dropped, notes, downloaded PDFs
  summaries/2026-09-02.md     the daily recap, Markdown + .json
  trail/                      the trail layer — off by default, never in entries/
```

Files over 200 MB are not copied; the path is recorded instead.

## Size

| | |
| --- | --- |
| Windows installer | **171 MB** |
| Installed | 562 MB |
| of which Electron itself | ~300 MB, and it does not compress further |

English speech (Whisper tiny.en, 42 MB) and both OCR sizes (PP-OCRv6 tiny 6 MB + small 30 MB) ship inside the installer, so it works offline the moment it is installed. Other languages download on demand into userData.

## Packaging

```bash
npm run dist:win       # NSIS installer → release/
npm run release:mac    # sign + notarise + dmg, then verify it (run on macOS)
npm run pack           # quick local build: signed, not notarised
npm run verify:mac     # check a .app that is already built
```

**macOS release** — signing, notarisation, and the three environment variables that silently produce a build nobody else can open if one is missing: [docs/RELEASE.md](docs/RELEASE.md). **The Mac App Store is out**, because of the sandbox rather than any setting — long shots need Accessibility, Vision needs Apple events, muxing needs ffmpeg, the extension needs sideloading: [mas-blockers.md](docs/app-store/mas-blockers.md).

## Site

**<https://briffy.cc>** · **<https://briffy.cc/en/>**

`site/` is one bilingual source file published as two genuinely single-language pages — one page serving two languages cannot be linked to, indexed, or shared with the right title. No build step beyond `node`.

```bash
node dev/preview/serve.js   # the source: http://localhost:5173/site/
npm run site                # split into two: site-dist/
npm run deploy              # → briffy.cc (Workers static assets)
```

## Development

```bash
node dev/preview/serve.js
```

Then `/` (workspace, fake data), `/pet`, `/viewer`, `/shelf`, `/region`, `/onboarding`. These pages use the real CSS and JS from `src/renderer`, with Electron's IPC swapped for `dev/preview/mock-*.js`. The visual standard is [.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md).

`dev/` also holds single-file checks that run under plain node — `node dev/ask-test.js`, `dev/retrieval-test.js`, `dev/links-test.js`, `dev/briffy-anim-test.js`. There is an unattended smoke mode too: set `DAILYLOGS_SMOKE=1` (or `audio` / `url` / `files` / `summary`) and briffy opens the workspace, performs one action, prints `SMOKE_RESULT …` and quits.

## Why it works this way

Every decision here was made against a measurement, and both are in **[docs/NOTES.md](docs/NOTES.md)** — why briffy scrolls the window itself instead of watching you scroll, why the search index lives on disk, why embeddings can never answer on their own, why the idle animation loops were deleted.

## License

**[PolyForm Noncommercial 1.0.0](LICENSE)** — source is open, commercial use is not permitted.

| | |
| --- | --- |
| **Yes** | Personal use, study, research, hobby projects, modification, redistribution (carry [LICENSE](LICENSE) and its `Required Notice:` line with it); charities, schools, public research bodies, government |
| **No**, without asking first | Any commercial use — inside a company's operations, as a paid service, sold or embedded in a paid product |
| **Commercial licence** | <zhaojia789456@gmail.com> |

This is **not** open source as the OSI defines it: that definition forbids discriminating against a field of endeavour, commerce included, so GitHub labels this "Other". The accurate word is *source-available*.

The restriction covers briffy's own code and nothing else. Dependencies, models, typefaces and artwork keep their upstream licences — mostly MIT / Apache-2.0 / BSD / OFL, which do permit commercial use. The full account, including the one copyleft component, is in [THIRD-PARTY.md](THIRD-PARTY.md).

The name and the drawing are not licensed with the code. Fork it and ship it under another name.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).
