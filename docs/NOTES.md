# Why it's done this way

briffy's design notes: every section is a decision, and the measured numbers that made it that
decision. The README is "what it is and how to run it"; this is "why it's shaped this way".

Back to [README](../README.md) · site <https://briffy.cc>

---

## First launch

The first launch walks a six-step onboarding ([src/renderer/onboarding/](../src/renderer/onboarding/)),
one thing per screen: **what this is → two language packs → permissions → who reads these records →
prepare the local engines → gesture cheatsheet**. Done, it writes `setupDone` and doesn't appear
again; to see it again, delete that item in settings.

The permissions step is the main reason it exists. On macOS the two permissions behave nothing alike,
and one "grant" button can't paper over it:

| | Can the app initiate it | After |
| --- | --- | --- |
| **Microphone** | Yes. `askForMediaAccess` pops the system dialog | One tap and it's done |
| **Screen recording** | No. Only after a capture has been attempted once does macOS list the app in System Settings; the user flips the switch | Takes effect only after relaunching the app |

So the cards say clearly what's about to happen, and the screen-recording one, when clicked, opens the
corresponding System Settings pane and notes that a restart is needed. Running from source it also adds
a line: the entry to look for in System Settings is "Electron", not briffy — the grant hangs on the
executable.

You can continue without granting; the corresponding features are just off, everything else as usual.
UI preview: `node dev/preview/serve.js` then open http://localhost:5173/onboarding (`?perm=mic|all` for
different grant states, `?lang=en` for English).

## Asking your own records

The middle of the bottom bar is Ask: type anytime, and beside it pick which model answers this one
(switching models is a decision made before asking, so it's where you ask, not only in settings). Click
the briffy on the left to switch to the Q&A page — the right lists the records it relies on, the left
is the answer, the ①② in the answer jump to the corresponding record when clicked, and clicking a card
opens the original record. Past conversations stay on disk ([chats.js](../src/main/chats.js)),
retrievable the next day.

A question is read in two halves:

- **Time** as a filter. It recognizes today / yesterday / the day before, this week / last week (Mon to
  Sun), this month / last month, last three days / past 10 days, September 3, `2026-08-27`, and their
  English equivalents (today, last week, last 5 days…). A question with only time and no keyword, like
  "what was I busy with last week", hands over that whole stretch of records without filtering.
- **Words** as retrieval. Time words are stripped from the question first, or "last week" would also go
  looking for the literal characters in the body. Chinese matches by character bigram (ICU's segmenter
  cuts "报错" into "报" and "错", and single characters hit everywhere, so "报错截图" becomes "报错 /
  错截 / 截图" and the mismatching one naturally gets no attention), English by word, keeping two-letter
  ones like "AI", "PR". Hit position is weighted: what's in a picture 3.5, title 3, one-sentence summary
  2, OCR/transcript body 1; a word appearing in most records (a persistent app name, your own username)
  is auto-downweighted; records that answered more of the question's words rank higher.

Up to 40 top records are sent to the AI with time, type, title, and body excerpts (a picture with no
text gets what's in it instead), told to **answer only from these**, say so if it can't, and preserve
titles and terms verbatim when citing, no translation. The answer is written in the question's own
language.

**With no AI service configured, or when the call fails, this page is still useful**: the retrieved
records are listed as usual, just with no one to read them for you. The step of picking records never
involves a model — this isn't for convenience, it's the precondition for this feature to hold:
switching from OpenRouter to a local Ollama doesn't affect the index; it locates things with the
network off; and latency is deterministic, not subject to someone else's network.

Regression tests: `node dev/ask-test.js`, `node dev/retrieval-test.js` (both plain node, no Electron),
pinning the behavior of date expressions, segmentation, ranking, and fusion.

### Once records grow: an index on disk

Originally each question did `store.listEntries({ limit: Infinity })`, reading every day of the
workspace into memory into one array. Measured at 200,000 records: **215 MB heap, 707 ms to score**;
extrapolated by real average length to 1.85M is about 7 GB — that's not slow, it's a crash per
question. And the model end only ever looks at 40, never the bottleneck.

So [src/main/index-db.js](../src/main/index-db.js): a SQLite inverted index living in the user data
directory, with no dependency added — Electron 44's bundled Node has `node:sqlite` with FTS5. Measured
on a 200,000-record, Zipf-distributed corpus:

| | |
| --- | --- |
| Build the index | 40s (one-off, then only re-reads changed days), library 115 MB, process heap **28 MB** (old path 215 MB) |
| Rare word | 1 ms, the one record in the whole library hit precisely |
| Two-word AND | 46 ms; common words 73 ms; English 14 ms |
| A week by day | 1 ms; a 334-day count 0 ms |

Three things known only by measuring:

- **Chinese must be segmented ourselves.** FTS5's `unicode61` treats a whole run of Chinese as one
  word, and `trigram` requires at least three characters — both return 0 for "会议". So both ingestion
  and query first pass through [segment.js](../src/main/segment.js) (ICU), storing a space-separated
  word stream.
- **Cost tracks the number of hit rows, not the library size.** 2 ms at 0.16% hit, 1427 ms at all-hit,
  because `ORDER BY rank` scores every hit. So a query narrows first by day and type and drops
  overly-common words.
- **The index is disposable.** It lives in the user data directory, not the workspace — the workspace
  gets moved, copied, swapped, while everything in the index can be recomputed from the workspace.
  `meta` records which workspace and which schema version it was built against, and on a mismatch it
  rebuilds.

### Beyond the term: vectors, and why they can't work alone

The search box and "Ask" have a second leg: compute both question and record as vectors and find what's
similar in meaning ([embed.js](../src/main/embed.js) / [chunk.js](../src/main/chunk.js) /
[vector.js](../src/main/vector.js), the model `paraphrase-multilingual-MiniLM-L12-v2`, ~120 MB, running
in a utilityProcess that exits after 3 idle minutes). Search "running" and that walking challenge comes
up, search "screen" and that note about 296 PPI comes up. These results are all labeled "similar", not
blended with exact hits to pretend they're the same thing — a search box quietly returning a pile of
things without the keyword looks simply broken.

`dev/semantic-bench.js` measured on the real workspace: six answerable daily questions, term right on
four, vector right on four too, but not the same four — vector finds "monitor model" (not one character
of the question appears in that English record), while missing "which model to run" (the record's title
holds the answer). The union is five. So both are needed, neither can work alone.

The harder reason is that vectors never say "not found": in the same measurement, one correct answer
scored 0.445, while a question with nothing in the workspace at all ("where did I travel last month")
still scraped 0.432. The score has no absolute meaning, no usable threshold. So a firm rule: **when term
comes up blank, vectors don't fire either.**

Chunking isn't an optimization, it's necessary: this model reads 128 tokens at a time, and a
13,000-character web page, unchunked, is represented only by its beginning — and a saved web page's
beginning is always language selectors, cookie prompts, and breadcrumbs. The body is stripped of web
furniture first ([boilerplate.js](../src/main/boilerplate.js)), measured removing 17% of the characters
with not one place-name bridge word lost; **only the view fed to the vector is stripped, the stored
record not a character changed**, full-text search as before.

### Edges between records

[links.js](../src/main/links.js) connects records, but not via "a better similarity".
`dev/thames-link-probe.js` measured on the real workspace: "Windsor Road, Egham TW20 0AE" and the walk
it belongs to have a vector similarity of **0.155** — while around 0.4 is already guessing. Lowering the
threshold to 0.30 connects 0/8, to 0.20 connects 3/8, at the cost of each record connecting to 126 of
the workspace's 236.

And those parking records' window titles are character for character identical to the title of a
bookmark saved in the same hour. The relation was written in the record all along, and it's "equal" not
"similar" — and an embedding is precisely the one tool that crushes strings into approximate meaning and
thereby destroys exact matching. So one rule, applied three times: **an edge exists only when it can
state its evidence, and evidence is never summed into one number.**

| Edge | Connects | How |
| --- | --- | --- |
| Same place | page ↔ records clipped from it | group by key. Exact, no threshold, no model |
| Same sitting | page ↔ page | one pass over time. Structural, drags in unrelated ones |
| Same subject | record ↔ record | vectors, ≥ 0.70 to count |

The first two aren't algorithms, they're a join and a one-dimensional segmentation — exact, cheap,
explainable, precisely because they aren't similarity. This file has no vectors and no model,
`node dev/links-test.js` runs directly. Neither is stored: storing only adds something that goes stale,
and both edges stay a hash map and one pass at 1.85M records.

## The picture viewer

Open a picture in the workspace and it gets its own window
([src/main/viewer.js](../src/main/viewer.js) + [src/renderer/viewer/](../src/renderer/viewer/)) rather
than stretching the detail panel — a picture is for looking at, and looking at it and reading its
caption are two things. It's the same gesture as opening a photo in a chat app: its own window, the
picture as large as possible, a toolbar below, and a filmstrip of every image in the workspace on the
right.

Toolbar: **pen / box / ellipse / mosaic / text / crop**, plus zoom, fit, rotate, grid, undo, pin, copy.
All drawing happens on a canvas layer above the picture; the main process does only the four things the
renderer can't — put the picture on the system clipboard, make the window sit over everything, translate
a piece of text, save a crop.

**One-click translate goes through the text, not the picture.** Pictures never leave this computer (the
workspace rule), and OCR already read the words, so re-sending the original is slow and redundant.

## Long shots

A whole page won't fit one screen: double-click to enter box selection, drag a rectangle, press the
**long shot** button beside it, and briffy scrolls itself — not watching you scroll.

It used to watch you scroll: compare consecutive frames to compute how far content moved. That path
can't work. Real interfaces are periodic — rows, cards, list items, message bubbles, nearly identical —
so a "off by exactly one card" stitch looks as good as the correct one, and no "is the best match
distinctive enough" predicate can tell them apart. Measured on a page of ordinary repeated blocks: the
matcher locked onto the wrong period, turning **90 px of real scrolling into a 7445 px picture**,
silently.

So now it takes a step and shoots: send a scroll of known size, wait for it to settle, take a frame, and
limit the search range to where content could reach. The first step also measures what "one step"
actually is in this window in pixels, and every step after checks against that measured number — tighter
than any guess.

The cost is Accessibility, and only the first time a long shot is really needed. Without it there's no
long shot: the old watch-and-guess mode isn't offered as a fallback, because a quietly mis-stitched
picture is worse than no picture.

The control bar at the bottom excludes itself from capture (`setContentProtection`), so it can sit over
the region being captured and never appear in the picture. Frame grabs go through the live capture
stream (0.1 ms a frame), not `desktopCapturer.getSources` (~190 ms a call, five frames a second, can't
keep up with scrolling); the stream opens when you start a long shot and is dropped as soon as it's done
— left open it takes 2.4% of a core, and worse, as long as it's alive there's a screen-recording
indicator in the menu bar. briffy is not a screen recorder.

## Import

Besides what you capture, copy, and drop in, you can import from elsewhere (Settings › Import): Notion
pages and Gmail messages.

The credentials are your own, briffy bundles no client id. This isn't laziness, it's forced by a hard
constraint: Gmail's `gmail.readonly` is a "restricted scope" at Google, and to give it to external
users the app must pass a CASA Tier 2 security audit — annual, 6~12 weeks the first time, thousands to
tens of thousands of dollars; before that the app is "unverified", the consent screen carries a warning,
and it's capped at 100 test users. briffy bundling its own client id would just park every user on that
warning page. So Notion uses your own integration token, Gmail uses your own "desktop app" client made
in Google Cloud — you own that app, so there's no such gate.

Notion using an integration token rather than OAuth has an extra benefit: you have to manually "connect"
the pages you want to sync to that integration, meaning you decide which pages it can see, rather than
one authorization handing over the whole workspace.

There's also a path needing no credentials at all: bulk import
([import-bulk.js](../src/main/import-bulk.js)). Export once on Notion or Google, drag the zip / mbox /
folder in, done — no OAuth, no token, no network request, no audit. The cost is it's a one-time snapshot
rather than continuous sync. Both paths coexist, neither replacing the other. (The zip uses the system's
own `unzip`, of a kind with using `pmset`, `osascript`, `mdls` in this project: commands the OS already
has, not a binary smuggled in the package — that's a hard rule, ffmpeg is set the same way.)

Imported things go straight into `store.addEntry`, not through the capture pipeline: that's for OCR and
transcription, while what comes in here is text to begin with.

## Meetings record themselves

This is the one thing briffy does without you lifting a finger, so it's off by default (Settings › Auto
recording). Everything else waits for a keypress or a copy, only this one listens. Turned on, meetings
and calls go into the workspace whether or not anyone meant them to — including other people's voices.
Whether to turn it on is the user's own question.

It doesn't listen to the room, it follows the microphone: only when another app opens the mic does
briffy record along ([micwatch.js](../src/main/micwatch.js)). Listening to the room all the time would
turn game voice chat, another person in the room, the TV, all into stored records — that's how 170 game
voice recordings got in on 2026-09-05. On macOS this can be asked without a native module: for each
process capturing audio, `coreaudiod` holds a wake-lock assertion carrying who opened it, `pmset -g
assertions` is 10 ms a call, and asking every 5 seconds is negligible, and needs no permission.

Three kinds are excluded: briffy itself (or it never stops), always-on recorders holding the mic 24
hours (`corespeechd`, screenpipe and the like, counting them regresses to "always recording"), and
browsers — the browser doesn't enter the list as an app, allowing all of Chrome would allow every page
it opens. What a browser brings is its corresponding meeting site.

The whitelist isn't a hardcoded list of names. It used to be: Teams, Webex, Slack, Feishu, DingTalk…
against a machine with only Zoom and WeChat installed, fourteen of eighteen never hit, and opening
settings you see someone else's list. Now the list grows from [apps.js](../src/main/apps.js) — scan the
applications directory and default-whitelist the meeting apps actually installed.

The cost was measured before touching anything:

| | one core |
| --- | --- |
| Mic open, with its own echo / noise / gain processing running | 4.5% |
| Plus voice activity detection on top | 1.4% |
| Both, but with that processing off and the sample rate down to 16 kHz | **2.6%** ← what shipped |

So the renderer hardcodes: no echo cancellation, no noise suppression, no auto gain, 16 kHz mono.
Whisper wants 16 kHz anyway, and is trained on ordinary noisy speech, so nothing is lost and the cost is
more than halved. One cost isn't a number: as long as it's running, macOS keeps that orange mic dot
lit.

The listening lives in its own hidden window, not briffy's — hiding it shouldn't quietly stop the
listening.

Speaker diarization ([diarize.js](../src/main/diarize.js)): sherpa-onnx runs pyannote segmentation and a
voiceprint model, answering "who spoke when in this recording". Measured locally, a 57-second four-person
Chinese recording 3.8s (0.07x realtime) recognized exactly four people, a 16-second two-person English
0.6s recognized exactly two — a five-minute meeting about twenty seconds, the same order as the
transcription beside it. The labels are arbitrary internally (the four came back as 0, 1, 2, 7), so
they're reordered by how much each spoke into Speaker 1 / 2 / 3.

It deliberately doesn't remember people across recordings. It used to have a second half: each voice
averaged into a voiceprint and stored, compared next recording, and if recognized, named. Cut on
2026-09-06 — different meetings have different people, a name given in Tuesday's meeting is noise by
Thursday, and a half-named list in the settings page is the app asking you for labor and giving nothing
back.

## Trail

What you were looking at today — this is the first thing in briffy you didn't deliberately save, so it
has its own place (`workspace/trail/`), not in `entries/`. The records page is "what you decided to
keep", and mixing what you merely passed by into it changes what that page means. Also off by default
(setting `recordTrail`).

Two feeds, wildly different in cost:

- **Focus**: ask who's in front every two seconds, record one when it changes. Measured 0.31% of a core,
  about 0.2 MB a day.
- **Web**: the browser extension reads the page DOM and hands it over directly. **0.2 ms to read 12,031
  characters**, no screenshot, no OCR.

Why not OCR: Vision's fast tier takes 800 ms to read eleven hundred characters, and it's "recognized";
reading `innerText` in the page is 0.2 ms, twelve thousand characters, verbatim — four thousand times
faster, ten times the text, and accurate. The accessibility-tree path is worse, an AppleScript pass over
Chrome is 8.8s, Claude 32s.

So only apps that yield neither DOM nor accessibility tree — WeChat, Telegram — are OCR-only, and those
happen to be private chats, so this layer records only their window titles, not the content. Nor does it
record while the machine is idle: `powerMonitor.getSystemIdleTime()` is free, and over a minute untouched
it stops.

## Tech stack

- **Electron 44**: the floating transparent window (briffy itself) + workspace window + viewer window +
  hover shelf + box-selection layer + onboarding + tray.
- **OCR (entirely unrelated to the LLM)**: PP-OCR (PaddleOCR) v6 ONNX models, inferred locally via
  `onnxruntime-node`. `v6-tiny` (6 MB) and `v6-small` (30 MB) are both bundled in the installer, one
  chosen at startup:

  - The predicate is memory, core count, and a ~160 ms CPU probe (`cpuProbe` in `hardware.js`, one
    384×384 matrix multiply). Memory ≥ 8 GB, cores ≥ 4, probe within 3× the reference machine (≤ 160 ms)
    uses `v6-small`, otherwise `v6-tiny`.
  - The result is written to settings (`ocrModelAuto`), overridable manually.
  - It self-corrects: if the auto-chosen model repeatedly exceeds 6 seconds per image (by median), it
    drops back to `v6-tiny`.
  - Language beats performance: choosing Japanese / Korean and the like that tiny can't cover uses a
    model that covers that language (downloading if needed).

  Other languages' (Japanese, Korean, Arabic, Thai, Russian, Latin-script) dedicated models download on
  demand to `<user data>/ocr-models`. OCR does text recognition only, and switching any AI service
  doesn't affect recognition.

  The runtime parameters are tuned for laptops, not benchmarks: threads at half the core count (2~4),
  onnxruntime's memory arena off, detection input's longest edge down to 1280 px. Measured on a
  2560×1440 Chinese screenshot (Ryzen 5 5600X):

  | Model | Per run | Peak memory | Note |
  | --- | --- | --- | --- |
  | v6-tiny (default) | ~0.8s | ~420 MB | bundled, enough for Chinese and English |
  | v6-small | ~2.7s | ~650 MB | more accurate, multilingual |

  With default parameters (all cores, arena on, no size cap) v6-tiny takes 750 MB and 4.5s of CPU time,
  and recognition isn't any better. After 2 idle minutes the model is unloaded and memory returned.
- **Speech to text**: `@huggingface/transformers` + `onnxruntime-node` running Whisper locally (default
  `whisper-small`, swappable for tiny/base/medium). The model downloads to `<user data>/models` on the
  first recording, then offline. On restricted networks a mirror `https://hf-mirror.com/` can be set in
  settings. Before transcribing it does a language ID between the two language packs (transformers.js
  doesn't auto-detect language, and unspecified would treat it as English and "translate" the Chinese
  away); Chinese results are normalized to your chosen Simplified / Traditional with `opencc-js`.
- **Segment stream download**: `src/main/ffmpeg.js` finds / installs / calls ffmpeg, `src/main/stream.js`
  downloads by manifest and merges. See "how a segment stream becomes one file" below.
- **Retrieval**: three layers, all local, none through a model. [recall.js](../src/main/recall.js) is
  time expressions and weighted scoring, [retrieve.js](../src/main/retrieve.js) decides which records a
  question shows the model (it requires neither store nor electron, so `dev/retrieval-test.js` runs this
  file itself, not a copy), [index-db.js](../src/main/index-db.js) is the on-disk SQLite/FTS5 inverted
  index (`node:sqlite`, zero dependency), Chinese first through [segment.js](../src/main/segment.js)'s
  ICU segmentation. [ask.js](../src/main/ask.js) hands the chosen records to `llm.js` to answer and asks
  it to mark citations.
- **Vectors**: [embed.js](../src/main/embed.js) runs `paraphrase-multilingual-MiniLM-L12-v2` in a
  utilityProcess (~120 MB, exits after 3 idle minutes, quietly falls back to counting words if it can't
  start), [chunk.js](../src/main/chunk.js) chunks by the 128-token limit, [vector.js](../src/main/vector.js)
  backfills vectors and finds neighbors, [links.js](../src/main/links.js) is the edges between records.
  Backfilling vectors hangs on ask.js's existing time-budgeted loop, no new scheduler: measured 21 ms a
  record, ~0.2s for ten. See "Asking your own records" above.
- **Auto recording**: [listen.js](../src/main/listen.js) holds the mic in a hidden window,
  [micwatch.js](../src/main/micwatch.js) asks "who's using the mic" via `pmset -g assertions` (10 ms a
  call, no permission), [apps.js](../src/main/apps.js) scans the applications directory to grow the
  whitelist, [diarize.js](../src/main/diarize.js) does in-recording speaker diarization with sherpa-onnx.
  All off by default.
- **Trail**: [trail.js](../src/main/trail.js) asks who's in front every two seconds
  ([foreground.js](../src/main/foreground.js)), web body handed over directly by the browser extension.
  Written to `workspace/trail/`, not `entries/`. Off by default.
- **Title & summary**: `src/main/llm.js` orchestrates four sources. Claude goes through the Anthropic SDK
  (default `claude-opus-5`, structured output + server-side refusal fallback, PDFs sent in as documents);
  OpenRouter and the custom endpoint go through OpenAI-compatible chat/completions (auto-degrading when
  JSON schema isn't supported); Ollama goes through native `/api/chat` (`format` structured output,
  auto-disabling Qwen's thinking, auto-stripping images for non-vision models). Screenshots are sent as
  image + OCR text; PDFs are first extracted locally with `pdf-parse` (also for search); web pages are
  sent after extracting the body. A local model's input is truncated to its context length.
- **What a record is called**: [title.js](../src/main/title.js). "Screenshot 22:46" isn't a title, it's
  a timestamp — of this workspace's 255 records, 83 (33%) have a title that is just "type + time", and
  you can't tell what it is. Keyword extraction was tried, running those 83 screenshots' OCR extracts
  things like "remaining · Project · cut · change to", so it was changed to ask the app itself what it's
  showing.
- **Source**: [foreground.js](../src/main/foreground.js) asks three cheap questions at the moment of
  saving — which app, which window, what URL. A record that doesn't know where it came from has lost half
  its meaning: a screenshot is "from which chat", a copied passage is "from which article".
- **Deduplication**: [picture-id.js](../src/main/picture-id.js) judges whether two images are the same
  when their bytes differ. A WeChat screenshot comes in twice — the clipboard carries both the temp file
  it just wrote and the bitmap itself, the watcher prefers the file and saves it, and seconds later
  WeChat deletes the temp file, so the next poll sees only the bitmap. Measured that pair as a 4.3 MB
  JPEG and a 16.6 MB PNG, both 4096×3072, visually identical with not one byte in common.
- **Daily summary**: [day-stats.js](../src/main/day-stats.js) is all arithmetic, no model, no inference —
  with no AI service configured this page still tells the truth rather than falling back to a bare list.
  [uptime.js](../src/main/uptime.js) fills the other half: a day with no records reads two opposite ways
  (nothing worth keeping, or the app just wasn't open), so every five minutes it leaves a mark, and the
  summary isn't lying half the time.
- **Word table and evidence**: [vocab.js](../src/main/vocab.js) files "which words are in this workspace,
  who mentioned them, who is the same as whom" into the database one at a time — it used to be three Maps
  recomputed by reading every day into memory every five minutes, 69 ms / 11 MB at 250 records looking
  fine, extrapolated O(n) to 200k is 55s, 8.8 GB, and the whole thing redone on every new record saved.
  [entity.js](../src/main/entity.js) recognizes recurring things in records (a place, a date, an event, a
  sum of money), [story.js](../src/main/story.js) grows a cluster outward from one record along edges —
  that's not clustering, clustering needs a global threshold and this data has none (measured: the record
  that should be in scores 0.685 to a real member, 0.647 to the centroid, only 0.523 to the
  representative, kept out).
- **Speakers matched to words**: [attribute.js](../src/main/attribute.js). Whisper knows what was said
  and roughly when, diarization knows who spoke when — the two sides' boundaries never align (Whisper cuts
  by sentence and pause, diarization by voice), so each block of text goes to whoever spoke longest within
  it.
- **`briffy://`**: [deeplink.js](../src/main/deeplink.js) lets a record be pointed at from outside. A
  summary saying "at 14:20 you saved that Postgres error" is worth more if those words click back to the
  record — summaries, exported notes, and answers in Q&A all carry it, and pasting it elsewhere (a todo
  list, a commit message, another notes app) works the same.
- **Hardware detection & recommendation**: `src/main/hardware.js` reads CPU / memory / GPU (Windows via
  nvidia-smi or the VRAM size in the registry, macOS via system_profiler, Apple Silicon by unified
  memory), recommending `qwen3.5:0.8b / 2b / 4b / 9b / 27b` by VRAM / memory budget, with `gemma3:4b` as
  an alternative.

## Browser extension (collecting web images / video)

`extension/` is a Chrome / Edge extension (Manifest V3), working like tools of the AixDownloader kind,
finding media from three places, merging, deduplicating, and listing:

1. Scan the page DOM ([scan.js](../extension/scan.js)): `img` / `video` / `audio` / `srcset` / lazy-load
   attributes / CSS background images / links to media files, including iframes, and piercing open shadow
   roots — many players are custom elements with `<video>` hidden in a shadow tree that `querySelectorAll`
   can't see.
2. Listen to network responses ([background.js](../extension/background.js) +
   [classify.js](../extension/classify.js)): catch mp4, m3u8, mpd, images, filtering out tracking pixels
   and icons.
3. Hook the page's own requests ([hook.js](../extension/hook.js)): this is the key to whether modern
   video can be found. Players using MSE have a `blob:` on the `<video>`, and the real stream is pulled by
   the page's JS `fetch` / `XMLHttpRequest` in segments — nothing in the DOM. So at `document_start`,
   before the page code runs, inject a script into the page's own world that wraps `fetch`,
   `XMLHttpRequest.open` and `URL.createObjectURL`, only observing the URLs passing through: not
   intercepting, not altering, not reading the response body, and reporting only those shaped like media
   or a manifest, ordinary API calls ignored.

Judging a manifest looks not at Content-Type but the URL: many CDNs serve m3u8 as `text/plain` or
`application/octet-stream`, some with no extension at all (`/manifest`, `?format=m3u8`). `.ts` / `.m4s`
segments aren't listed individually (the playlist is what's wanted), but are counted by directory — a
page that leaves only 300 segment requests is still a page with video, and the panel shows "N segments"
rather than a blank. A Service-Worker-relayed request has `tabId` -1, and is grouped by origin domain to
the corresponding tab rather than dropped.

When nothing's found the panel explains why: how many `<video>` are on the page, whether the src is
`blob:`, whether MSE was detected, and "let the video play a few seconds then open the panel" — segment
requests are only recognizable after they appear.

This layer has a regression test: `node dev/media-detect-test.js` (plain node, no browser), 30 cases
covering manifests disguised as text, segments that must be counted not listed, and tracking pixels that
must never be served up as images.

Install: the top-right of the records page has a status light — when not installed it says "install
browser extension", clicked it opens a guide page in your default browser
(`http://127.0.0.1:47831/install`) with a copyable `chrome://extensions/` address and the extension
folder path, and once installed that page turns green itself, and the app's status light becomes
"extension connected".

(Browsers, for security, don't allow an external program to navigate directly to `chrome://extensions`,
so that copy-paste step is manual. When the default browser is Edge the address auto-changes to
`edge://extensions/`.)

The manual three steps are:

1. Open `chrome://extensions` (Edge is `edge://extensions`), enable "Developer mode".
2. Click "Load unpacked", choose this project's `extension/` folder (or use the app's "Export extension
   folder…" to copy one elsewhere).
3. Click the extension icon on any page, or press `Alt+Shift+D`.

Once installed the extension checks in with the app every 5 minutes (`chrome.alarms`), so the status
light turns green without you opening the extension panel first; two missed check-ins (11 minutes) counts
as disconnected.

Judging "is it a real extension" trusts only headers the browser writes itself, which a web script can't
forge, so the status light won't turn green falsely.

There's a trap here, thought up by assuming "the browser writes `Origin`": a Service Worker's GET carries
no `Origin` at all — the browser only writes that line for methods other than GET and HEAD (measured on
Chrome 153). The heartbeat is a GET, so it was never counted as checking in, and the extension panel,
only checking whether its own fetch came back, wrote "connected" regardless: the two long disagreed.

The rule now: if the browser wrote an `Origin`, trust it (`chrome-extension://…`, getting the real
extension id along the way); if not, fall back to `Sec-Fetch-Site: none` — for a request from a web page
to 127.0.0.1 this line is always `cross-site`, and the page can't change this header. A page can't get
around it either: with `X-Briffy-Ext` attached it's cors mode, and the browser stamps its own Origin on.

This has a regression test: `node dev/api-test.js` runs the forged scenarios on an isolated port, plus
the two real-extension shapes (a POST with Origin, a heartbeat GET without). The two header sets in the
test are the real values captured from a probe extension on Chrome 153, not guessed — the last version
guessed wrong and missed this bug.

The panel can filter by type (image / video / audio) and minimum edge length, select all or one, and
"send to briffy" once picked. Images are downloaded by the extension with the page's cookies and Referer
then handed to the app (getting hotlink-protected images); video by default records only the address and
source page, downloading for real only when "also download video / audio files" is checked.

An item's name is taken from the filename in the URL, and failing that the page title (stripping site
suffixes like `_哔哩哔哩_bilibili`, `- YouTube`, but only when the trailing segment really is that site's
name — or a "fix: bug in hub" on github.com would get chopped in half).

### How a segment stream becomes one file

Video on a site is usually not one file: it's a playlist plus hundreds of segments (HLS's `.ts` / DASH's
`.m4s`), and the video and audio are often two separate tracks. With download checked, the extension only
hands the playlist's address to the app (downloading that address gives just a few KB of text), and the
app, with ffmpeg, follows the manifest to pull all the segments and merge the two tracks into one `.mp4`
(`-c copy`, remux not re-encode, fast and lossless). Video CDNs almost all hotlink-protect, so the source
page is passed to ffmpeg as `Referer`, or the segments are all 403.

ffmpeg is not bundled into the installer, nor does it download an unknown binary. It's found in the
system first (PATH and the locations package managers use, Homebrew / Program Files), and failing that,
installed in Settings › Video download via the system's own package manager (macOS `brew install ffmpeg`,
Windows `winget install Gyan.FFmpeg`, Linux `apt-get install ffmpeg`), the same path as installing
Ollama. When not installed a segment stream can still be found, just not merged, and the item explains
why.

This chain has an end-to-end regression test: `node dev/stream-test.js` uses ffmpeg to generate a 5-second
HLS on the spot (video + a separate audio track), starts a local server that requires a Referer (i.e.
hotlink protection), runs the real download flow, then verifies the product is a playable file with h264 +
aac both present and the right duration and resolution, and that a wrong Referer honestly reports a 403.

The app listens on `http://127.0.0.1:47831` (bound to localhost only, requiring the extension's custom
header, the port changeable in settings, and switchable off entirely). Received items are marked source
"🧩 web", and carry the source page title and the image's alt text, all handed to the AI for a title.

## Bookmark is archive

The moment you click "bookmark" in the browser, the page's title, body, and URL all go into the
workspace. X's Bookmark, Reddit's Save, Xiaohongshu's and Zhihu's collections, and any button labeled
"Save / Bookmark" count; `Cmd/Ctrl+D` counts too.

It doesn't monitor browsing. The content script does nothing normally, reading the page only after a save
gesture happens; other clicks are only glanced at, enough to tell it's not a save button and drop it.

The body is extracted in the page ([extract.js](../extension/extract.js)), not by handing the URL to the
app to fetch — the pages worth bookmarking mostly require login, and a request from the app gets only an
empty shell. Extraction recognizes the site's own container first (X's `tweetText`, Reddit's
`shreddit-post`, Xiaohongshu's `#detail-desc`), falling back to a generic heuristic: prefer semantic
containers like `article` / `main` / `[role=main]`, then score by "long body, many paragraphs, few
links", and finally when reading text remove the table of contents, share bar, related recommendations
hidden inside the body container (Wikipedia's TOC got mixed in this way).

### The hard part is telling "bookmark" from "un-bookmark"

Almost every site uses the same button for both, and the cost of misjudging is asymmetric: saving a copy
at the very moment you decide to un-bookmark. So the judgment looks not at the click but at the state
after it — `aria-pressed`, what text the button became ("un-bookmark", "Unsave"), and site-specific
selectors (X's `removeBookmark`). Wording can't be rigid either: X's label is `Remove Tweet from
Bookmarks`, with other words between the verb and noun.

The judgment logic is separated into [savedetect.js](../extension/savedetect.js), verifiable against each
site's real button structure: serve the repo root over http, open `dev/fixtures/save-gestures.html`, run
`copy(window.runCases())` in the console. 19 cases cover X / Reddit / Xiaohongshu save and unsave, both
directions of `aria-pressed`, an icon nested in a button, and the "share" and "save file locally" that
must not be taken as a save.

(The fixture can only verify the judgment, not the event path: `HTMLElement.click()`'s `isTrusted` is
false, and [bookmark.js](../extension/bookmark.js) deliberately recognizes only real clicks — or a page
could forge a bookmark itself.)

The same URL is saved only once a day, so double-clicking the star doesn't save two copies. Bookmarked
items are their own cell in the records page's source filter.

## The one on the desktop

It's not a picture, it's the logo itself moving. In [assets/brand/briffy.svg](../assets/brand/briffy.svg)
every number is measured from the original, not traced ([gen-brand.js](../scripts/gen-brand.js) scans the
runs of brand-blue pixels in the original: a horizontal line below the arc center cuts the arc twice,
above it once, and where the switch happens fixes the center). [briffy-anim.js](../assets/brand/briffy-anim.js)
is that same image, only with springs on its face.

The mark in the icon is cut from below — the two arches each run off the frame, because it has to sit in a
square icon. The one on the desktop is different, it has to be a real paperclip, and a paperclip is one
continuous wire, not two separate loops: so it's one path drawn in a single stroke, the big loop's right
leg (free end) ↑ → top arc → left leg ↓ → the semicircle that loops under → the small loop's right leg ↑ →
top arc → left leg ↓ (free end). The numbers are the same, only the semicircle is new; the face not a
pixel moved, only a different crop. The straight waist is a bit longer than the mark's — the mark is cut
and shows no waist, and standing whole a short waist reads as a pill.

The two arches never deform. Radius, center, line width copied from the SVG, unmoving at any time: whatever
it's doing, stop a frame at random and it's still the logo. Only the face (two eyes and a mouth) and the
whole thing as a rigid body move — it can be lifted, tilted, bounced, like moving a drawing on a table, but
never squashed or stretched.

Springs rather than keyframes, two reasons, the second being why it can exist at all:

- Keyframes have to be drawn for every pair of states that can switch to each other; a spring needs only an
  endpoint, and being interrupted mid-way is free — it just heads for the new direction from its current
  position and velocity. And briffy's states interrupt each other constantly (a capture arrives while
  recording runs, an error while a save is half done).
- Springs settle. This window is transparent, always-on-top, never closes, and every frame it wants is a
  never-ending alpha composite — measured in `pet.css`: three `infinite` idle loops take 11.4% of a core,
  full stillness only 0.9%, so the idle loops were deleted. And a spring converges: once every variable is
  within ε of its target and velocity is zero, the loop snaps them exactly to the target and cancels the
  next requestAnimationFrame. Between two states nothing moves and nothing composites; a state change wakes
  it, it moves, and it returns to the free version.

Only plain numbers and one `<svg>`: no canvas, no dependency, no build step, so it can be `require`d
directly by a test under node (`node dev/briffy-anim-test.js`), and dropped into any page with a `<script>`
tag — the one on the site and the one on the desktop are the same file.

The window is 80×80, the content not filling it: the transparent margin is room for the shadow, the
recording ring, and each motion, or a slight enlargement gets clipped by the window's rectangle. State
effects (the recording ring + REC, thinking dots, summary badge, the dashed drop frame on drag-in) are all
drawn in [pet.css](../src/renderer/pet/pet.css).

It stands on someone else's desktop ([pet-ground.js](../src/main/pet-ground.js)): under it might be a
pure-white document or a pure-black terminal, while it has only one blue — `#2a6cf0` on pure black is only
4.1:1, muddy. A stroke around it was tried and rejected: a clean blue wire with a white outline becomes a
sticker. Now it shifts a shade of blue with the system appearance, the same hue 219° with only lightness
changing, so it's still it. It reads the system switch rather than briffy's own "theme" — those really can
differ, and it stands on someone else's desktop, its color relatives being the wallpaper and other apps,
not briffy's window.

(The other path is measuring the real brightness of the ground under it — written and working too, exclude
itself from capture, grab a thumbnail, crop the patch it stands on, compute mean brightness. More accurate,
but `desktopCapturer.getSources` measured 190–330 ms a call on this machine, so it can only sample at
"just born / dragged away / screen changed" moments, and standing still with a black window opened
underneath it wouldn't keep up.)

### Wanting the transparent-background, full-body, many-expression kind

If you want a drawn animal rather than this paperclip, `.claude/skills/pet-as-character/` has a full
generation flow — adapted from the public project [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill),
but it doesn't generate an icon: it's changed to transparent background, centered full body, one character
drawn in 8 expression frames (`idle` `blink` `capture` `think` `listen` `happy` `sad` `sleep`), each frame
using the chosen one as a reference image to guarantee it's the same creature. The three directions and each
frame's pose are in [scripts/pet-brief.json](../scripts/pet-brief.json).

```bash
npm run pet -- identity --dry-run   # write out the prompts only, no API call (assets/pet/raw/*.txt)
npm run pet -- identity             # six candidates: A1 A2 B1 B2 C1 C2
npm run pet:cutout                  # cut out + crop + scale, and assemble assets/pet/candidates.png
npm run pet -- frames --from assets/pet/raw/B1.png   # once chosen, draw the 8 frames
```

Needs an image model's key: `OPENAI_API_KEY` (`gpt-image-2`, produces transparent background directly),
`GEMINI_API_KEY` or `OPENROUTER_API_KEY` (produces a solid background, cut out by `scripts/pet-cutout.js`).
`npm run pet:electron -- identity` goes through Electron, reusing the OpenRouter key saved in settings.
Cutout is flood-fill inward from the four edges, so where the character's interior matches the background it
isn't wrongly cut, and edges are made semi-transparent by color distance with color spill removed. Taking
this path also means changing `pet.css` to swap the self-drawn paperclip for a transparent sprite.
