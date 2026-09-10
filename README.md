# briffy 📎

**<https://briffy.cc>** · [Download](https://github.com/jiaazhaoo/briffy/releases) · [Why it works this way](docs/NOTES.md) · [Privacy](docs/PRIVACY.md) · [中文](docs/README.zh.md)

A paperclip sits in the corner of your screen and writes down what you saw, heard and were handed.
No filing, no folders. Recognition runs on your machine.

Windows and macOS (Apple Silicon). Source-available, free for personal and non-profit use,
**not commercial** — see [License](#license).

## Gestures

| Do this | Get this |
| --- | --- |
| **Click it** | Full screen — saved, OCR'd, on your clipboard |
| **Double-click** | Drag a box. **Long shot** scrolls the window and joins a whole page |
| **Middle-click** (or hold 0.55 s) | Start / stop a voice note |
| **Drop** an image, file, link, text | Into the workspace — images get OCR, PDFs and pages their text |
| **Copy** anything | Text, images and files land in the workspace as you copy them |
| **Right-click** it or the tray | Workspace, settings, today's recap, hide, quit |
| `Ctrl+Alt+A / S / V` (`⌘⇧A / S / V`) | Box · full screen · voice note |
| `Alt+Shift+D` in the browser | The extension lists the page's images, video and audio |

## What it does

- **Everything names itself** — a title and a sentence. Pictures with no words in them are named by the local classifier. Each morning it writes up yesterday.
- **Ask it** — one line in the bottom bar. Records are picked **locally**, then the model reads only those and cites each one. So asking works offline, and with no provider at all.
- **Search has two legs** — exact hits, plus records that only *mean* the same thing. The second kind is always labelled.
- **Two-level filter** — Clipboard · Screenshots · Saved · Files · Recordings, the five kinds of paper you see on screen. Each has its own second level: a site, an app, a file type, a microphone.
- **Picture viewer** — pen, mosaic, crop, translate, pin, copy.
- **Import** — Notion and Gmail with your own credentials, or an exported zip / mbox.
- **Off until you ask** — recording meetings (only while another app holds the mic), and keeping a trail of what you looked at (stored apart from your records).

OCR is PP-OCRv6, speech is Whisper, both via onnxruntime. Works with the network off.

**Pictures are never sent to a model** — OCR already read the words. What *is* sent has card
numbers, ID numbers, keys and passwords masked first, by checksum and fixed shape, no model
involved ([redact.js](src/main/redact.js)). Stored records are never altered.

## Run

```bash
npm install     # fetches the Electron runtime (~367 MB, once) and five OFL typefaces
npm start
npm test        # 29 checks, ~7 s
```

**Nothing to configure** — first launch prepares the local OCR and speech engines itself.
Worth a look:

1. **Settings › Languages** — two packs (default Simplified Chinese + English). They drive OCR, speech and the interface; the first decides what language briffy writes in.
2. **Settings › AI** — [OpenRouter](https://openrouter.ai) (one click, no key to paste) or local **Ollama**. With neither, titles fall back to filenames and the recap to a list. Keys live in the system keychain, or come from `OPENROUTER_API_KEY`.
3. **macOS** — grant Screen Recording and Microphone in System Settings › Privacy & Security.

## The workspace

One folder — `%APPDATA%\briffy\workspace`, `~/Library/Application Support/briffy/workspace`:

```
entries/2026-09-03.json     one index per day: title, OCR / transcript, what a picture shows
screenshots/ files/ audio/  the originals, by day — nothing here is ever rewritten
ocr/ thumbs/                derived: line boxes, thumbnails. Deletable, regenerated on demand
summaries/2026-09-02.md     the daily recap, Markdown + .json
chats/ trail/ uptime/       what you asked · the trail layer (off) · when briffy was awake
```

Files over 200 MB are not copied; the path is recorded instead.

**Deleting the app does not delete this folder** — but an uninstaller tool will, so
**Settings › Workspace folder** moves it somewhere you can see: it copies every file, verifies the
count and the bytes, and leaves the original for you to remove yourself.

## Size

| | |
| --- | --- |
| Windows installer | **171 MB** |
| Installed | 562 MB |
| of which Electron | ~300 MB, and it does not compress further |

English speech (Whisper tiny.en, 42 MB) and both OCR sizes (PP-OCRv6 tiny 6 MB + small 30 MB) ship
inside the installer, so it works offline the moment it lands. Other languages download on demand.

## Packaging

```bash
npm run dist:win       # NSIS installer → release/
npm run release:mac    # sign + notarise + dmg, then verify (on macOS)
npm run pack           # quick local build: signed, not notarised
npm run verify:mac     # check a .app that is already built
```

macOS signing and notarisation, including the three environment variables that silently produce a
build nobody else can open: [docs/RELEASE.md](docs/RELEASE.md).
**The Mac App Store is out** — the sandbox, not any setting
([why](docs/app-store/mas-blockers.md)).

## Development

```bash
node dev/preview/serve.js
```

`/` (workspace, fake data), `/pet`, `/viewer`, `/shelf`, `/region`, `/onboarding` — the real CSS and
JS from `src/renderer`, with Electron's IPC swapped for `dev/preview/mock-*.js`.
`npm test` runs everything in `dev/` that runs under plain node, and says what it skipped.
`DAILYLOGS_SMOKE=1` (or `audio` / `url` / `files` / `summary`) opens the workspace, performs one
action, prints `SMOKE_RESULT …` and quits.

House rules: [CLAUDE.md](CLAUDE.md). Visual standard:
[.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md).

## Site

**<https://briffy.cc>** · **<https://briffy.cc/en/>** — `site/` is one bilingual source published
as two single-language pages. No build step beyond `node`.

```bash
npm run site     # split into two: site-dist/
npm run deploy   # → briffy.cc
```

## Why it works this way

Every decision here was made against a measurement, and both are in
**[docs/NOTES.md](docs/NOTES.md)** — why briffy scrolls the window itself instead of watching you
scroll, why the search index lives on disk, why embeddings can never answer on their own, why the
idle animation loops were deleted.

## License

**[PolyForm Noncommercial 1.0.0](LICENSE)** — source is open, commercial use is not.

| | |
| --- | --- |
| **Yes** | Personal use, study, research, hobby projects, modification, redistribution (carry [LICENSE](LICENSE) and its `Required Notice:` line); charities, schools, public research bodies, government |
| **No**, without asking | Any commercial use — inside a company's operations, as a paid service, sold or embedded in a paid product |
| **Commercial licence** | <zhaojia789456@gmail.com> |

Not open source as the OSI defines it — that definition forbids discriminating against a field of
endeavour, commerce included, which is why GitHub labels it "Other". The accurate word is
*source-available*. The restriction covers briffy's own code only; dependencies, models, typefaces
and artwork keep their upstream licences ([THIRD-PARTY.md](THIRD-PARTY.md)). The name and the
drawing are not licensed with the code — fork it and ship it under another name.

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)
