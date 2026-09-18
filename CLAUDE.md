# briffy

An Electron desktop companion: it files your screenshots, copied text, dropped-in files and voice
notes into day-by-day records, and then you can ask it. **Closed source** (PolyForm Noncommercial
1.0.0, no commercial use); say "source-available" publicly, not "open source".

- Main process `src/main/` · renderers `src/renderer/{workspace,pet,viewer,region,onboarding}` · bridge `src/preload/`
- Why it's built this way → [docs/NOTES.md](docs/NOTES.md) (every section is a decision, and the measured numbers that made it that decision)
- **Read [.claude/skills/paper-ui/SKILL.md](.claude/skills/paper-ui/SKILL.md) before touching any UI** (the visual standard, 637 lines, hard constraints)

## Running

```
npm start                      the app
npm test                       34 tests, ~8s (56 test files; the rest need electron or arguments); it lists the ones needing electron and the ones needing arguments
npx electron dev/xxx-test.js   the 18 that need electron
npm run preview                http://localhost:5173/ runs the real UI on fake data (/pet /viewer /shelf /region /onboarding)
```

## Putting your build on this machine

```
npm run dev:install    build current source, sign it, replace /Applications/briffy.app, relaunch
npm run doctor         what is actually installed and running, and is it current
```

**Never install a build any other way.** Three rules `dev:install` enforces, each one measured on
2026-09-17 after a whole afternoon was lost to them:

- **Developer ID signing only, never ad-hoc.** An ad-hoc build's TCC identity is `Electron`, not
  `com.briffy.app`, so macOS treats it as a different app and it inherits none of the screen-recording
  or microphone grants — and every rebuild mints yet another identity. The user watched the briffy
  toggle sit switched on in System Settings while the running app kept asking for permission, because
  that toggle belonged to a different app. `dev:install` refuses to run without the certificate rather
  than falling back.
- **One briffy.app on the machine.** It installs to `/Applications` (same path and identity the user
  granted) and deletes the copy under `release/`. Two double-clickable briffys guarantee that sooner or
  later you test one and run the other.
- **Every build carries a stamp** (`scripts/stamp.js` → `src/build-info.json`: commit, branch, dirty,
  build time). Before this, four builds on this machine all reported version `1.0.1` and nothing could
  tell them apart — which is why "the fix is in the source" and "the fix is in the app you are running"
  went unnoticed for six days.

**Source fixed is not app fixed.** When a fix is about window behaviour, permissions, or anything only
observable in a packaged app, `npm run dev:install` and check there before telling the user it works.
`npm run doctor` will say it plainly when the running build is behind HEAD.

## Must not be violated

These aren't preferences, they're the reason this product can be trusted to run all day. If a change
touches any of them, say so first, don't decide on your own.

- **Lose no data.** Captured originals are not changed by a byte — not translated, not rewritten, not
  "optimized". Derived things (thumbnails, OCR sidecar files, the index) can be deleted and
  regenerated; originals cannot.
- **Saved images are not sent to a model.** What goes to the model is the text OCR extracted and the
  local classifier's labels (`workspace.js`'s `aiInput` carries no `image` field). This holds for
  one-click translate, "ask", and the summary.
- **Ingestion doesn't wait on a model.** `store.addEntry` writes to disk on the spot, `processEntry`
  does the rest later. No AI configured, offline, model down — the record is still complete, just
  without a title and tags.
- **Redact before sending out** (`redact.js`): card numbers, ID numbers, IBANs, keys all recognized
  by check digit and fixed shape, not by a model. What's masked is only the copy that leaves this
  computer, the stored original untouched.
- **ffmpeg is neither bundled nor downloaded as a loose binary.**
- **No word table, use vectors.** Blocking noise with a hand-written word table is something this repo
  tried, and it only grew longer.
- **Don't reinvent wheels.** Use what the system provides (thumbnails via
  `nativeImage.createThumbnailFromPath`, text via the accessibility tree, OCR as fallback).
- The artwork in `assets/brand/` must not be deleted.

## Measure first

Every conclusion in this repo is measured, `docs/NOTES.md` opens with exactly this.
**Before touching anything a user can see, measure the real library first** — more than once a
conclusion from impression turned out backwards. How to measure, which benches exist, where the two
traps are: [.claude/skills/measure-first/SKILL.md](.claude/skills/measure-first/SKILL.md).

## A few things that bite

- **`src/renderer/workspace/workspace.js` is 3,000-plus lines in one scope**, and function names
  collide (`chip` collided once, the symptom being another function's error). grep the name before
  adding a top-level function.
- **`store.workspaceDir` is a getter**: under strict, assignment throws; without strict it fails
  silently (you measure an empty library and don't know). To set it write `store.settings = {
  workspaceDir }`, and tests always use `'use strict'`. `store.paths()` asks
  `app.getPath('userData')`, so running in plain node needs a fake electron stubbed in.
- **Every number in the filter row must equal the count on screen after clicking it**: `listEntries`
  and `stats` share `store.entryMatches`, don't patch a rule on either side alone — this was wrong
  once, the row saying 203 while the screen showed 19. The guard is `dev/filter-count-test.js`.
- **Look at `git log` before committing**: this repo often has another session working in the same
  files at the same time.

## Commits

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Write commit messages in English, saying **why** and giving the **measured numbers**, in the style of
the existing `git log`.
