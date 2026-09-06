// Mock of the preload `window.ws` API with sample data, for browser previews of the workspace UI.
(() => {
  const today = new Date();
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const at = (dayOffset, h, m) => { const d = new Date(today); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };
  const mk = (dayOffset, h, m, e) => { const d = at(dayOffset, h, m); return { id: `${dayOffset}-${h}${m}`, createdAt: d.toISOString(), dateKey: key(d), status: 'done', tagsSource: 'ollama', model: 'qwen3.5:9b (Ollama)', summary: '', text: '', path: '', tags: [], ...e }; };
  const entries = [
    mk(0, 9, 12, { type: 'screenshot', title: '截图 09:12', path: 'screenshots/x.png', fileUrl: '/sample.png', width: 2320, height: 1520, ocrBoxes: 4, pinned: true, note: '这个版面就照这个来', context: { app: 'briffy', window: '记录' }, tags: ['Electron', '浮动窗口', '截图', 'OCR', '工作区'], text: 'briffy — 记录 / 每日摘要 / 设置\n搜索标题 / 三个词 / 文字\n2026年9月3日周四 · 8', summary: '一张关于 briffy 工作区界面的截图。' }),
    mk(0, 10, 3, { type: 'audio', title: '语音 10:03', path: 'audio/a.webm', fileUrl: '', durationSec: 42, sttLanguage: 'zh', tags: ['预算', '张老师', '产品方案', '下午三点', '会议'], text: '你好，这是一段测试录音。明天上午记得把项目预算发给张老师，下午三点开会讨论产品方案。' }),
    mk(0, 11, 25, { type: 'url', title: 'Optical character recognition - Wikipedia', url: 'https://en.wikipedia.org/wiki/Optical_character_recognition', context: { app: 'Google Chrome', window: 'Optical character recognition - Wikipedia', url: 'https://en.wikipedia.org/wiki/Optical_character_recognition' }, tags: ['OCR', 'text recognition', 'Tesseract', 'scanning', 'history'], text: 'Optical character recognition or optical character reader (OCR) is the electronic or mechanical conversion of images of typed, handwritten or printed text into machine-encoded text…', summary: 'Wikipedia article explaining OCR, its history and techniques.' }),
    mk(0, 13, 40, { type: 'pdf', title: '第三季度预算与路线图会议.pdf', path: 'files/q3.pdf', size: 184320, pages: 6, tags: ['第三季度', '预算', '路线图', '产品团队', '会议纪要'], text: '第三季度预算评审与路线图规划\n1. 预算概览 …', summary: '第三季度预算评审和路线图规划的会议材料。' }),
    mk(0, 15, 2, { type: 'note', title: '明天上午十点和产品团队开会', path: 'files/n.txt', context: { app: 'WeChat', window: '产品群' }, tags: ['产品团队', '开会', '预算', '路线图', '王经理'], text: '这是一个测试笔记。\n明天上午十点和产品团队开会，讨论第三季度的预算和路线图。\n记得把会议纪要发给王经理。' }),
    mk(0, 16, 30, { type: 'image', title: 'design-ref.png', path: 'files/design-ref.png', fileUrl: '/assets/icon.png', width: 512, height: 512, tags: ['猫', '图标', '橙色', 'logo', '圆形'], status: 'processing', progress: '识别文字中 40%' }),
    mk(-1, 9, 5, { type: 'screenshot', title: '截图 09:05', path: 'screenshots/y.png', fileUrl: '/sample.png', width: 1400, height: 1800, tags: ['Chrome', 'Google Maps', '路线', 'Reading', '导航'], text: 'Rivermead Leisure Centre · 15 min · 2.8 miles' }),
    mk(-1, 14, 20, { type: 'file', title: 'photos.zip', path: 'files/photos.zip', size: 52428800, tags: ['photos', 'zip', 'archive'], tagsSource: 'local', error: '未配置 AI 服务，已用本地关键词代替', model: '' }),
    mk(-1, 18, 45, { type: 'audio', title: '语音 18:45', path: 'audio/b.webm', durationSec: 8, status: 'error', error: '这段录音是静音的（麦克风：CABLE Output）。请在设置 › 语音转文字里选择正确的麦克风', tags: [] }),
  ];
  entries.push(
    mk(0, 17, 30, { type: 'url', title: '为什么 SQLite 不需要服务器', url: 'https://example.com/sqlite', origin: 'bookmark', path: 'files/sqlite.txt', tags: ['SQLite', '嵌入式', '数据库', '架构', '单文件'], text: '为什么 SQLite 不需要服务器\n\nSQLite 把整个数据库放在一个文件里…' }),
    mk(0, 12, 15, { type: 'text', title: '从 Slack 复制的一段', path: 'files/clip.txt', origin: 'clipboard', tags: ['Slack', '排期', '联调', '后端', '本周'], text: '后端联调排在本周四，前端先按 mock 走，接口字段定了再改。' }),
    mk(0, 14, 2, { type: 'image', title: 'chart.png', path: 'files/chart.png', fileUrl: '/sample.png', width: 1600, height: 900, origin: 'browser', sourceTitle: '2026 年 Q3 财报', tags: ['财报', '营收', '同比', '图表', 'Q3'] }),
  );
  // ?dup=N 把这批记录复制 N 份：布局、滚动、拉框这些只有在装不下一屏时才看得出问题
  const dup = Math.max(1, Math.min(40, Number(new URLSearchParams(location.search).get('dup')) || 1));
  const base = entries.slice();
  for (let i = 1; i < dup; i++) for (const e of base) entries.push({ ...e, id: `${e.id}-d${i}` });

  const summaries = [
    { dateKey: key(at(-1, 0, 0)), generatedAt: at(0, 8, 0).toISOString(), entryCount: 3, source: 'ollama', model: 'qwen3.5:9b (Ollama)', text: '# 昨日概览\n\n昨天主要围绕 **导航路线** 和 **照片整理** 展开，共 3 条记录。\n\n## Themes\n- 出行：查看去 Rivermead Leisure Centre 的路线（15 分钟，2.8 英里）。\n- 整理：归档了一批照片 `photos.zip`。\n\n## Timeline\n- 上午：截图路线。\n- 下午：归档照片。\n- 晚上：一段录音是静音的，没有内容。\n\n## Follow-ups\n- 检查麦克风设置。' },
    { dateKey: key(at(-3, 0, 0)), generatedAt: at(-2, 8, 0).toISOString(), entryCount: 5, source: 'anthropic', model: 'claude-opus-5 (Anthropic)', text: '# 概览\n\n围绕 briffy 的产品定义和技术选型。\n\n## Themes\n- 产品：桌面宠物 + 截图 OCR + 语音笔记。\n- 技术：Electron、tesseract.js、Whisper。' },
  ];
  const languages = [
    { code: 'zh-Hans', name: '中文（简体）', english: 'Chinese (Simplified)' }, { code: 'zh-Hant', name: '中文（繁體）', english: 'Chinese (Traditional)' },
    { code: 'en', name: 'English', english: 'English' }, { code: 'ja', name: '日本語', english: 'Japanese' }, { code: 'ko', name: '한국어', english: 'Korean' },
    { code: 'fr', name: 'Français', english: 'French' }, { code: 'de', name: 'Deutsch', english: 'German' }, { code: 'es', name: 'Español', english: 'Spanish' },
  ];
  const settings = {
    languages: ['zh-Hans', 'en'], hotkey: 'Alt+S', model: 'claude-opus-5', sttModel: 'Xenova/whisper-small', sttLanguage: 'auto', summaryTime: '08:00',
    workspaceDir: '', hfMirror: '', tessLangPath: '', petHidden: false, ocrDroppedImages: true, normalizeChineseScript: true, micDeviceId: '', micLabel: '',
    ocrEngine: 'paddle', ocrModel: '', clipboardWatch: true, clipboardMinChars: 12, localApi: true, localApiPort: 47831,
    provider: 'ollama', anthropicAuth: 'apiKey', openrouterModel: 'anthropic/claude-opus-5', ollamaHost: 'http://127.0.0.1:11434', ollamaModel: '',
    customBaseUrl: 'http://127.0.0.1:1234/v1', customModel: '', hasApiKey: false, apiKeyHint: '', hasOpenrouterKey: true, openrouterKeyHint: 'sk-or-v1…a1b2', hasCustomKey: false, customKeyHint: '',
  };
  const listeners = {};
  const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); return () => {}; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // same rule as store.js entrySource(): where it came in through, which `type` alone cannot say
  const srcOf = (e) => (e.origin === 'clipboard' ? 'clipboard' : e.origin === 'bookmark' ? 'bookmark' : e.origin === 'browser' ? 'browser'
    : e.type === 'screenshot' ? 'screenshot' : e.type === 'audio' ? 'voice' : 'other');
  const pub = (e) => ({ ...e, source: srcOf(e), absPath: e.path ? 'C:\\briffy\\' + e.path : '' });
  window.ws = {
    getSettings: async () => ({ settings, avatarUrl: '/assets/pet/avatar.png', languages, models: [{ id: 'claude-opus-5', name: 'Claude Opus 5 (default)' }, { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }, { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (fastest)' }], sttModels: [{ id: 'Xenova/whisper-tiny', name: 'Whisper tiny (~40 MB)' }, { id: 'Xenova/whisper-small', name: 'Whisper small (~250 MB, recommended)' }], platform: 'win32', version: '0.1.0', screenPermission: 'granted', hotkeyError: '', workspaceDir: 'C:\\Users\\User\\AppData\\Roaming\\briffy\\workspace', stats: { days: 3, entries: entries.length }, localApi: { running: true, port: 47831, lastReceived: null }, extensionDir: 'C:\\local project\\briffy\\extension', setup: null,
      ocrModels: [{ id: 'v6-small', name: 'PP-OCRv6 small', sizeMB: 26 }, { id: 'v6-tiny', name: 'PP-OCRv6 tiny', sizeMB: 12 }, { id: 'v5-mobile', name: 'PP-OCRv5 mobile', sizeMB: 24 }] }),
    saveSettings: async (patch) => { Object.assign(settings, patch); return settings; },
    // the real catalogue file, so the picker grid can be checked for real in the browser
    petCatalog: async () => {
      const c = await (await fetch('/assets/pet/catalog.json')).json();
      return { thumb: c.thumb, count: c.count, logos: c.logos, current: settings.petAvatar || '' };
    },
    petSetAvatar: async (k) => { settings.petAvatar = k; return { ok: true, key: k, avatarUrl: '/assets/pet/avatar.png' }; },
    testProvider: async () => { await sleep(600); return { ok: true, model: 'qwen3.5:9b', reply: 'OK' }; },
    providerStatus: async () => ({ catalogue: { live: true, at: Date.now(), scored: 13, tiers: {
      easy: [
        { model: 'qwen3.5:4b', sizeGB: 2.5, vision: true, quality: 0.898, measured: true, tier: 'easy' },
        { model: 'gemma3:4b', sizeGB: 2.5, vision: true, quality: 0.902, measured: true, tier: 'easy' },
        { model: 'qwen3:1.7b', sizeGB: 1.1, vision: false, quality: 0, measured: false, tier: 'easy' },
      ],
      medium: [
        { model: 'qwen3.5:9b', sizeGB: 5.6, vision: true, quality: 0.915, measured: true, tier: 'medium', recommended: true },
        { model: 'gemma4:12b', sizeGB: 7.4, vision: true, quality: 0.764, measured: false, tier: 'medium' },
        { model: 'gemma3:12b', sizeGB: 7.4, vision: true, quality: 0.810, measured: false, tier: 'medium' },
      ],
      stretch: [
        { model: 'qwen3.5:27b', sizeGB: 16.7, vision: true, quality: 0.919, measured: true, tier: 'stretch' },
        { model: 'qwen3.6:27b', sizeGB: 16.7, vision: true, quality: 0.862, measured: true, tier: 'stretch' },
        { model: 'gemma4:31b', sizeGB: 19.2, vision: true, quality: 0.852, measured: true, tier: 'stretch' },
      ],
    } }, pendingPull: (new URLSearchParams(location.search).get('pending') === '1' ? { model: 'qwen3.5:27b', receivedBytes: 4.2e9, totalBytes: 17e9, at: Date.now() } : null), hardware: { platform: 'win32', arch: 'x64', cpu: 'AMD Ryzen 5 5600X 6-Core Processor', cores: 12, ramGB: 31.9, gpus: [{ name: 'AMD Radeon RX 6700 XT', vramGB: 12, vendor: 'amd' }] }, recommendation: { model: 'qwen3.5:9b', sizeGB: 6.6, reason: '检测到显卡 AMD Radeon RX 6700 XT（显存 12 GB）。推荐 qwen3.5:9b（约 6.6 GB），可以流畅运行。', notes: ['AMD 显卡在 Windows 上能否被 Ollama 加速取决于型号支持，不支持时会自动用 CPU 运行。'], alternatives: [{ model: 'qwen3.5:4b', sizeGB: 3.4, note: '更小更快' }, { model: 'qwen3.5:27b', sizeGB: 17, note: '更准但更慢、更占内存' }, { model: 'gemma3:4b', sizeGB: 3.3, note: 'Google Gemma，多语言，支持图片' }], accelerator: 'amd' }, ollama: (new URLSearchParams(location.search).get('ollama') === 'off'
      ? { host: 'http://127.0.0.1:11434', running: false, installed: false, reason: 'not-installed', models: [] }
      : new URLSearchParams(location.search).get('ollama') === 'stopped'
        ? { host: 'http://127.0.0.1:11434', running: false, installed: true, binary: 'C:\\Users\\User\\AppData\\Local\\Programs\\Ollama\\ollama.exe', reason: 'not-running', models: [] }
        : { host: 'http://127.0.0.1:11434', running: true, version: '0.12.1', installed: true, models: [{ name: 'qwen3.5:9b', size: 6.6e9 }, { name: 'gemma3:4b', size: 3.3e9 }] }), anthropic: { hasProfile: false, profiles: [], envKey: false, cliInstalled: false }, configured: true, label: 'qwen3.5:9b (Ollama)', provider: settings.provider }),
    openrouterModels: async () => ({ ok: true, models: [{ id: 'anthropic/claude-opus-5', name: 'Anthropic: Claude Opus 5', context: 1000000, vision: true, pricing: { prompt: 0.000005, completion: 0.000025 } }, { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', context: 1000000, vision: true, pricing: { prompt: 0.000002, completion: 0.00001 } }, { id: 'qwen/qwen3.8-flash', name: 'Qwen: Qwen3.8 Flash', context: 1000000, vision: true, pricing: { prompt: 1.5e-7, completion: 4.7e-7 } }] }),
    openrouterLogin: async () => { await sleep(800); settings.hasOpenrouterKey = true; return settings; },
    openrouterCancelLogin: async () => {}, anthropicLogin: async () => ({ launched: false, cliInstalled: false, command: 'ant auth login' }),
    ollamaPull: async (model) => {
      const total = 6.6e9;
      const emit = (o) => (listeners['ws:ollama-pull-progress'] || []).forEach((cb) => cb({ model, ...o }));
      emit({ phase: 'preparing', status: 'pulling manifest' });
      await sleep(400);
      for (let p = 0; p <= 100; p += 4) { await sleep(90); emit({ phase: 'downloading', status: 'pulling 8934d96d', percent: p, receivedBytes: total * p / 100, totalBytes: total }); }
      emit({ phase: 'verifying', status: 'verifying sha256 digest' }); await sleep(500);
      emit({ phase: 'finishing', status: 'writing manifest' }); await sleep(300);
      return { ok: true };
    },
    ollamaInstall: async () => {
      const emit = (o) => (listeners['ws:ollama-install-progress'] || []).forEach((cb) => cb(o));
      emit({ line: '$ brew install --cask ollama', phase: '' });
      await sleep(400);
      emit({ line: '==> Downloading https://github.com/ollama/ollama/releases/download/v0.12.1/Ollama.dmg', phase: 'downloading' });
      for (let p = 0; p <= 100; p += 5) { await sleep(90); emit({ line: `####  ${p}.0%`, phase: 'downloading', percent: p }); }
      emit({ line: '==> Installing Cask ollama', phase: 'installing' }); await sleep(900);
      emit({ line: 'ollama was successfully installed!', phase: 'done' });
      return { ok: true, method: 'winget', started: true }; },
    ollamaStart: async () => { await sleep(800); return { ok: true, installed: true }; },
    ollamaRemove: async () => { await sleep(300); return { ok: true }; },
    forgetPendingPull: async () => ({ ok: true }),
    ffmpegStatus: async () => (new URLSearchParams(location.search).get('ffmpeg') === 'off'
      ? { installed: false, url: 'https://ffmpeg.org/download.html' }
      : { installed: true, version: '8.0.1', ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' }),
    ffmpegInstall: async () => { await sleep(1200); return { ok: true, method: 'homebrew', version: '8.0.1', ffmpeg: '/opt/homebrew/bin/ffmpeg' }; },
    onFfmpegInstall: on('ws:ffmpeg-install-progress'),
    onOllamaInstall: on('ws:ollama-install-progress'),
    openExtensionDir: async () => {}, exportExtension: async () => 'D:\\briffy-extension',
    extensionStatus: async () => {
      const m = new URLSearchParams(location.search).get('ext');
      if (m === 'apioff') return { running: false, port: null, extension: { connected: false, version: '' } };
      if (m === 'on') return { running: true, port: 47831, extension: { connected: true, version: '0.1.0' } };
      return { running: true, port: 47831, extension: { connected: false, version: '' } };
    },
    openExtensionGuide: async () => ({ ok: true, url: 'http://127.0.0.1:47831/install' }),
    onExtension: on('ws:extension'),
    runSetup: async ({ installOllama }) => {
      const steps = [{ id: 'detect', label: '检查这台电脑' }, { id: 'ocr', label: '准备文字识别' }, { id: 'stt', label: '准备语音识别' }]
        .concat(installOllama ? [{ id: 'ollama', label: '安装本地大模型程序' }, { id: 'model', label: '下载本地大模型' }] : [])
        .concat([{ id: 'done', label: '完成' }]).map((s) => ({ ...s, state: 'todo' }));
      const emit = (p) => (listeners['ws:setup-progress'] || []).forEach((cb) => cb(p));
      const details = { detect: '31.9 GB RAM · AMD Radeon RX 6700 XT', ocr: 'PP-OCRv6 small', stt: 'Xenova/whisper-small', ollama: '0.33.3', model: 'qwen3.5:9b', done: '' };
      for (let i = 0; i < steps.length; i++) {
        steps[i].state = 'run';
        emit({ type: 'state', running: true, steps: [...steps], index: i, percent: Math.round(((i + 0.35) / steps.length) * 100), current: i === 1 ? '下载中 62%（第 2/3 个文件）' : '' });
        emit({ type: 'log', line: `step ${steps[i].id} started` });
        await sleep(900);
        steps[i].state = 'done'; steps[i].detail = details[steps[i].id];
        emit({ type: 'state', running: true, steps: [...steps], index: i, percent: Math.round(((i + 1) / steps.length) * 100), current: '' });
      }
      const summary = ['电脑：AMD Ryzen 5 5600X · 31.9 GB 内存 · AMD Radeon RX 6700 XT', '文字识别：PP-OCRv6 small（本地引擎，不经过大模型）', '语音识别：Xenova/whisper-small（本地）']
        .concat(installOllama ? ['本地大模型：qwen3.5:9b'] : ['还没配 AI 服务，三个词先用本地关键词']);
      const final = { type: 'state', running: false, ok: true, steps, index: steps.length - 1, percent: 100, current: '', summary };
      emit(final);
      return final;
    },
    onSetup: on('ws:setup-progress'),
    micDevices: async () => [{ deviceId: 'default', label: 'Default - 耳机 (WH-1000XM5 Hands-Free AG Audio)' }, { deviceId: 'communications', label: 'Communications - 耳机 (WH-1000XM5 Hands-Free AG Audio)' }, { deviceId: 'abc', label: '立体声混音 (Realtek(R) Audio)' }, { deviceId: 'def', label: 'CABLE Output (VB-Audio Virtual Cable)' }],
    micTest: async () => { await sleep(2000); return { deviceId: '', label: '耳机 (WH-1000XM5 Hands-Free AG Audio)', peak: 0.42 }; },
    onOllamaPull: on('ws:ollama-pull-progress'),
    chooseDir: async () => 'D:\\briffy',
    listDates: async () => [...new Set(entries.map((e) => e.dateKey))].sort().reverse(),
    listEntries: async ({ query = '', dates = null, source = '', pinned = false } = {}) => entries.filter((e) => (!dates || dates.includes(e.dateKey)) && (!source || srcOf(e) === source) && (!pinned || e.pinned) && (!query || `${e.title} ${e.tags.join(' ')} ${e.text}`.toLowerCase().includes(query.toLowerCase()))).map(pub),
    // the four line boxes of the mock screenshot, in its own 2320x1520 pixels
    entryBoxes: async () => ({ w: 2320, h: 1520, lines: [[120, 96, 640, 44, 96, 'briffy — 记录 / 每日摘要 / 设置'], [120, 190, 900, 38, 91, '搜索标题 / 三个词 / 文字'], [120, 268, 720, 36, 88, '2026年9月3日周四 · 8'], [1500, 96, 300, 40, 74, '设置']] }),
    dayStats: async () => ({ total: 0, status: 'idle', uptimeMinutes: 95, byType: {}, bySource: {}, byApp: [], byHour: [] }),
    contextProbe: async () => ({ ok: true, app: 'Google Chrome', window: 'briffy · 样式基准页', reason: '' }),
    entryLink: async (id) => `briffy://entry/${id}`,
    getEntry: async (id) => pub(entries.find((e) => e.id === id)),
    deleteEntry: async (id) => { const i = entries.findIndex((e) => e.id === id); if (i >= 0) entries.splice(i, 1); return true; },
    retryEntry: async () => true,
    updateEntry: async (id, patch) => { const e = entries.find((x) => x.id === id); Object.assign(e, patch); return pub(e); },
    openEntry: async () => '', revealEntry: async () => {}, openExternal: async (u) => window.open(u), openWorkspaceDir: async () => {},
    addFiles: async () => [], addUrl: async (url) => { const e = mk(0, today.getHours(), today.getMinutes(), { type: 'url', title: url, url, status: 'processing', progress: '抓取网页中…' }); entries.unshift(e); (listeners['ws:entry'] || []).forEach((cb) => cb({ entry: pub(e), kind: 'add' })); return pub(e); },
    addNote: async (text) => { const e = mk(0, today.getHours(), today.getMinutes(), { type: 'note', title: text.slice(0, 40), text, status: 'processing', progress: '正在生成三个词…' }); entries.unshift(e); (listeners['ws:entry'] || []).forEach((cb) => cb({ entry: pub(e), kind: 'add' })); return pub(e); },
    capture: async () => null,
    listSummaries: async () => summaries.map(({ text, ...m }) => m),
    getSummary: async (dateKey) => { const s = summaries.find((x) => x.dateKey === dateKey); return s ? { dateKey, text: s.text, meta: s } : null; },
    generateSummary: async (dateKey) => { await sleep(800); return { dateKey, text: '# 摘要\n\n（预览）', meta: { dateKey, entryCount: 1, source: 'local' } }; },
    // A stand-in for recall.js + the model: enough shape (range, citations, notes) to check the ask UI.
    // `?ask=none|noprovider|error` forces the three states that are otherwise hard to reach in a preview.
    ask: async (question) => {
      await sleep(900);
      const mode = new URLSearchParams(location.search).get('ask') || '';
      const q = String(question).toLowerCase();
      // whitespace tokens plus 2-character slices, so a run-on Chinese question still matches something
      const words = q.split(/[\s,.?!，。？！、]+/).filter((w) => w.length >= 2)
        .flatMap((w) => (/[\u4e00-\u9fff]/.test(w) ? [...w].slice(0, -1).map((c, i) => w.slice(i, i + 2)) : [w]));
      const hits = mode === 'none' ? [] : entries.filter((e) => !words.length || words.some((w) => `${e.title} ${e.tags.join(' ')} ${e.text} ${e.summary}`.toLowerCase().includes(w))).map(pub);
      const base = { question, answer: '', used: [], sources: hits, range: /昨天|yesterday/.test(q) ? { from: key(at(-1, 0, 0)), to: key(at(-1, 0, 0)) } : null, scored: true, noProvider: false, error: '', total: entries.length };
      if (mode === 'noprovider') return { ...base, noProvider: true };
      if (mode === 'error') return { ...base, error: 'connect ECONNREFUSED 127.0.0.1:11434' };
      if (!hits.length) return base;
      return { ...base, model: 'qwen3.5:9b (Ollama)', used: [1, 2].filter((n) => n <= hits.length),
        answer: `会议定在**明天上午十点**，和产品团队一起过第三季度的预算和路线图 [1]。语音笔记里还提到下午三点要讨论产品方案，预算要先发给张老师 [2]。\n\n- 相关材料：《第三季度预算与路线图会议.pdf》，6 页 [1]\n- 待办：把会议纪要发给王经理 [1]` };
    },
    stats: async () => {
      const bySource = { screenshot: 0, clipboard: 0, bookmark: 0, browser: 0, voice: 0, other: 0 };
      for (const e of entries) bySource[srcOf(e)]++;
      return { days: 3, entries: entries.length, pinned: entries.filter((e) => e.pinned).length, bySource };
    },
    onEntry: on('ws:entry'), onSummary: on('ws:summary'), onSettings: on('ws:settings'), onNavigate: on('ws:navigate'),
  };
})();
