'use strict';
(() => {
  const ws = window.ws;
  const $ = (s) => document.querySelector(s);

  const T = {
    zh: {
      tabEntries: '记录', tabSummaries: '每日摘要', tabSettings: '设置', capture: '截图并识别', addFiles: '添加文件', save: '保存', brandSub: '每天的小记录',
      searchPlaceholder: '搜索标题 / 五个词 / 文字', quickPlaceholder: '粘贴链接或输入一段笔记，回车存入工作区', allDates: '全部日期',
      selectEntry: '选择一条记录查看详情', noEntries: '还没有记录。按快捷键截图、双击小猫录音，或把文件拖到小猫身上。',
      generateSummary: '生成该日摘要', noSummary: '还没有摘要。小猫每天早上会自动生成昨天的摘要。', noEntriesThatDay: '这一天没有记录',
      generating: '生成中…', generated: '摘要已生成', summaryItems: '{n} 条记录', bySource: { claude: 'Claude', local: '本地' },
      types: { screenshot: '截图', image: '图片', audio: '语音', pdf: 'PDF', text: '文本', url: '链接', note: '笔记', file: '文件' },
      processing: '处理中', error: '出错', localTags: '本地词', done: '完成',
      words: '五个词', summary: '摘要', text: '识别文字', transcript: '转写文字', content: '内容',
      open: '打开原文件', reveal: '在文件夹中显示', openLink: '打开链接', retry: '重新处理', edit: '编辑', delete: '删除', cancel: '取消', copy: '复制文字', copied: '已复制',
      confirmDelete: '删除这条记录（及其文件副本）？', title: '标题', tagsField: '五个词（用逗号分隔）', textField: '文字', duration: '时长',
      sPet: '小动物形象', sPetHint: '来自 ipaslogo.com 的 3448 个免费形象（可免费商用），每个都套上同一个圆框。点一个就换成它。',
      sPetSearch: '搜索（cat、owl、fox……）', sPetReset: '恢复默认', sPetCount: '{n} 个', sPetNone: '没有匹配的形象',
      sPetDefault: '默认形象', petApplying: '下载中…', petApplied: '已换上 ✓', petFailed: '换失败：{err}',
      sLanguages: '语言包', sLanguagesHint: '选择两个语言：用于 OCR 文字识别、语音转文字和界面语言（第一个语言决定界面与摘要语言）。',
      sLang1: '语言 1', sLang2: '语言 2', sShortcut: '截图快捷键', sHotkey: '全局快捷键', sHotkeyPlaceholder: '点击后按下组合键', sHotkeyHint: '点击输入框后按下组合键。修改后立即生效。',
      sSetupRecheck: '重新检查',
      sHotkeyRegion: '框选截图', sHotkeyScreen: '整屏截图', sHotkeyVoice: '开始 / 结束录音',
      sCaptureClipboard: '截图同时复制到系统剪贴板（不会因此重复记录一次）',
      sGestureHint: '小猫身上：单击 = 整屏截图，双击 = 框选截图，中键点击或长按 = 开始 / 结束录音。',
      captureRegion: '框选截图',
      sClaude: 'Claude（五个词 & 每日摘要）', sApiKey: 'Anthropic API Key', sApiKeyPlaceholder: '留空表示不修改', sTestKey: '测试', sClearKey: '清除', sModel: '模型',
      sClaudeHint: '没有 API Key 时，五个词会用本地关键词提取代替，摘要则是简单的清单。', sSpeech: '语音转文字（本地 Whisper）', sSttModel: '模型大小', sSttLanguage: '识别语言', sAuto: '自动检测（所有语言）', sAutoPacks: '自动检测（只在两个语言包之间）',
      sMirror: '模型下载镜像（可选）', sSpeechHint: '首次录音时会下载模型并缓存到本机，之后完全离线运行。', sSummary: '每日摘要', sSummaryTime: '生成时间',
      sSummaryHint: '每天到点后（且程序在运行）自动生成昨天的摘要，并弹出通知。', sStorage: '存储', sWorkspaceDir: '工作区文件夹', sChoose: '选择…', sOpenDir: '打开',
      sTessPath: 'OCR 语言包地址（可选）', sOcrDropped: '拖入的图片也做 OCR', sPetHidden: '隐藏小猫（可从托盘菜单恢复）', sSave: '保存设置', sAbout: '状态',
      keySet: '已设置：{hint}', keyNotSet: '未设置', keyOk: '可用 ✓（{model}）', keyFail: '失败：{err}', testing: '测试中…', saved: '已保存', needTwoLanguages: '两个语言不能相同',
      hotkeyNeedsModifier: '需要搭配 Ctrl / Alt / Shift / Cmd', version: '版本', platform: '平台', stats: '{days} 天，共 {entries} 条记录', screenPerm: '屏幕录制权限',
      keyCleared: '已清除 API Key', sameLang: '两个语言不能相同', dirChanged: '工作区已切换（旧文件不会自动搬迁）',
      sAI: 'AI 服务（五个词 & 每日摘要）', sProvider: '来源', sProviderOllama: '本地模型 (Ollama)', sProviderCustom: '自定义 OpenAI 兼容接口',
      sAnthropicAuth: '登录方式', sAccountOption: '已登录的 Claude 账号（ant auth login）', sAnthropicLogin: '用浏览器登录 Claude 账号',
      sOpenrouterKey: 'OpenRouter API Key', sOpenrouterLogin: '用 OpenRouter 账号登录', sRefreshModels: '刷新模型列表',
      sOllamaHost: 'Ollama 地址', sDetect: '重新检测', sOllamaModel: '使用的模型', sUseRecommended: '用推荐的', sPull: '下载模型',
      sCustomBase: '接口地址（base URL）', sCustomKey: 'API Key（可选）', sNormalizeZh: '中文语音转写统一为所选的简体 / 繁体（不是翻译）',
      sAIHint: '没有配置 AI 服务时，五个词会用本地关键词提取代替，摘要则是简单清单。五个词、标题和摘要不做翻译，始终使用内容本身的语言。',
      configured: '当前使用：{label}', notConfigured: '尚未配置，会用本地关键词代替',
      accountFound: '已检测到登录配置：{profiles}', accountEnv: '已通过环境变量提供凭据', accountNotFound: '未检测到登录，点右侧按钮在终端里完成 ant auth login',
      cliMissing: '未安装 ant 命令行工具（macOS：brew install anthropics/tap/ant；其他平台见 github.com/anthropics/anthropic-cli）',
      cliMissingCmd: '没找到 ant 命令，请先安装，再在终端运行：{cmd}', loginStarted: '已打开终端，按提示在浏览器里登录，完成后回来点「重新检测」',
      loginWaiting: '已打开浏览器，请在页面里完成登录…', loginOk: '登录成功，Key 已保存',
      hwLocal: '本机', hwCores: '{n} 线程', hwNoGpu: '未检测到', hwRecommend: '推荐', hwAlternatives: '备选',
      ollamaRunning: '运行中 {version}', ollamaInstalled: '已安装：{models}', ollamaNoModels: '还没有模型，点「下载模型」',
      ollamaNotInstalled: '没有安装 Ollama —— 本地模型需要先装它（约 700 MB，装完不用登录、完全离线）',
      ollamaNotStarted: '已安装但没在运行（{binary}），点「启动 Ollama」',
      sInstallOllama: '一键安装 Ollama', sStartOllama: '启动 Ollama', sDownloadOllama: '手动下载',
      installing: '正在安装 Ollama，这一步会下载几百 MB，请耐心等待…', installOk: 'Ollama 安装完成，现在可以下载模型了', installFail: '安装失败（{err}），请点「手动下载」自己装一次',
      installManual: '这台电脑没有可用的安装器，已打开下载页面，装好后回来点「重新检测」',
      starting: '正在启动 Ollama…', startOk: 'Ollama 已启动', startFail: '启动失败：{err}',
      pullNeedsOllama: '需要先安装并启动 Ollama 才能下载模型',
      pulling: '正在下载 {model}…', pullDone: '{model} 下载完成', modelsLoaded: '已加载 {n} 个模型，输入名称可筛选', orVision: '支持图片',
      sSetup: '本机准备情况', sSetupHint: '这些都是自动完成的：检查电脑、准备文字识别和语音识别引擎，全部在本机运行。下面每一项都可以自己改。', sSetupRun: '开始自动配置', sSetupRerun: '重新运行',
      sSetupWithOllama: '顺便装上本地大模型（Ollama + 推荐模型，约 7 GB）', sSetupLog: '查看详细日志',
      setupRunning: '配置中…', setupOk: '配置完成 ✓', setupFail: '配置失败：{err}',
      sOcrIndependent: '文字识别（OCR）用的是 PP-OCR 专用识别引擎，和大模型无关；换 AI 服务不会影响识别结果。',
      sOcrModel: '文字识别模型', ocrAuto: '按语言自动选择', bundled: '已内置',
      sMic: '麦克风', sMicRefresh: '刷新', sMicTest: '测试麦克风（说 2 秒）', micDefault: '系统默认', micLoading: '正在读取麦克风列表…',
      micTesting: '录 2 秒，请对着麦克风说话…', micOk: '有声音 ✓（{mic}，峰值 {peak}）', micSilent: '没有声音（{mic}）。这个设备是静音的，换一个再试', micError: '打不开麦克风：{err}',
      micNone: '没找到任何麦克风设备',
      sClipboard: '剪贴板', sClipboardWatch: '实时记录剪贴板（复制的文字、图片、文件都会存入工作区并打五个词）', sClipboardMin: '文字至少多少个字才记录',
      sClipboardHint: '密码管理器复制的内容会自动跳过；从工作区里复制出去的文字不会重复记录。托盘菜单里也能随时开关。', fromClipboard: '📋 剪贴板', fromBrowser: '🧩 网页',
      extOn: '扩展已连接', extOff: '装浏览器扩展', extOffTitle: '点击查看安装步骤：装上后可以一键把网页里的图片和视频存进来',
      extOnTitle: '浏览器扩展 v{version} 已连接，在网页里按 Alt+Shift+D 使用', extApiOff: '扩展接口已关闭', extApiOffTitle: '设置 › 浏览器扩展 里可以重新打开',
      extGuideOpened: '已在浏览器里打开安装步骤',
      sExtension: '浏览器扩展（采集网页图片 / 视频）', sExtensionHint: '装上扩展后，在任意网页点扩展图标（或按 Alt+Shift+D），就能看到这一页所有图片、视频、音频，勾选后一键存入工作区。',
      sLocalApi: '允许浏览器扩展连接（本机接口，仅监听 127.0.0.1）', sLocalApiPort: '端口', sExportExt: '导出扩展文件夹…', sOpenExt: '打开扩展文件夹', sExtHelp: '安装步骤',
      apiRunning: '接口运行中：http://127.0.0.1:{port}{last}', apiStopped: '接口已关闭，扩展无法连接', apiLast: '，最近一次接收：{time}',
      extSteps: '<b>Chrome / Edge 安装步骤</b><br>1. 点「导出扩展文件夹…」把扩展复制到一个你不会删掉的位置（也可以直接用下面这个自带路径）。<br>2. 浏览器地址栏打开 <code>chrome://extensions</code>（Edge 是 <code>edge://extensions</code>）。<br>3. 打开右上角的「开发者模式」。<br>4. 点「加载已解压的扩展程序」，选择那个文件夹。<br>5. 在任意网页点扩展图标，或按 <code>Alt+Shift+D</code>。<br><br>扩展文件夹：<code>{dir}</code><br>如果扩展显示「DailyLogs 未运行」，检查上面的端口是否和扩展设置里的一致。',
      extExported: '扩展已导出到 {dir}',
    },
    en: {
      tabEntries: 'Entries', tabSummaries: 'Daily summaries', tabSettings: 'Settings', capture: 'Capture & read', addFiles: 'Add files', save: 'Save', brandSub: 'your daily log',
      searchPlaceholder: 'Search title / five words / text', quickPlaceholder: 'Paste a link or type a note, press Enter to save', allDates: 'All dates',
      selectEntry: 'Select an entry to see details', noEntries: 'Nothing yet. Press the shortcut to capture, double-click the cat to record, or drop files on it.',
      generateSummary: 'Generate summary for this day', noSummary: 'No summaries yet. The cat writes one for yesterday every morning.', noEntriesThatDay: 'No entries on that day',
      generating: 'Generating…', generated: 'Summary generated', summaryItems: '{n} items', bySource: { claude: 'Claude', local: 'local' },
      types: { screenshot: 'Screenshot', image: 'Image', audio: 'Voice', pdf: 'PDF', text: 'Text', url: 'Link', note: 'Note', file: 'File' },
      processing: 'Processing', error: 'Error', localTags: 'local words', done: 'Done',
      words: 'Five words', summary: 'Summary', text: 'Recognized text', transcript: 'Transcript', content: 'Content',
      open: 'Open file', reveal: 'Show in folder', openLink: 'Open link', retry: 'Reprocess', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', copy: 'Copy text', copied: 'Copied',
      confirmDelete: 'Delete this entry (and its stored copy)?', title: 'Title', tagsField: 'Five words (comma separated)', textField: 'Text', duration: 'Duration',
      sPet: 'Pet character', sPetHint: '3448 free characters from ipaslogo.com (free for commercial use), each in the same round frame. Click one to wear it.',
      sPetSearch: 'Search (cat, owl, fox…)', sPetReset: 'Back to default', sPetCount: '{n} found', sPetNone: 'Nothing matches',
      sPetDefault: 'Default character', petApplying: 'Downloading…', petApplied: 'Applied ✓', petFailed: 'Could not apply: {err}',
      sLanguages: 'Language packs', sLanguagesHint: 'Pick two languages for OCR, speech-to-text and the UI (the first one drives the UI and summary language).',
      sLang1: 'Language 1', sLang2: 'Language 2', sShortcut: 'Capture shortcut', sHotkey: 'Global shortcut', sHotkeyPlaceholder: 'Click, then press keys', sHotkeyHint: 'Click a box and press a key combination. Applied immediately.',
      sSetupRecheck: 'Check again',
      sHotkeyRegion: 'Capture a region', sHotkeyScreen: 'Capture the whole screen', sHotkeyVoice: 'Start / stop recording',
      sCaptureClipboard: 'Also copy captures to the system clipboard (this does not record them twice)',
      sGestureHint: 'On the pet: one click = whole screen, two clicks = drag a box, middle click or long press = start / stop recording.',
      captureRegion: 'Capture a region',
      sClaude: 'Claude (five words & daily summary)', sApiKey: 'Anthropic API key', sApiKeyPlaceholder: 'Leave empty to keep the current key', sTestKey: 'Test', sClearKey: 'Clear', sModel: 'Model',
      sClaudeHint: 'Without an API key the five words come from local keyword extraction and the summary is a plain list.', sSpeech: 'Speech-to-text (local Whisper)', sSttModel: 'Model size', sSttLanguage: 'Recognition language', sAuto: 'Auto-detect (any language)', sAutoPacks: 'Auto-detect (only between the two language packs)',
      sMirror: 'Model download mirror (optional)', sSpeechHint: 'The model is downloaded on the first recording and cached locally; afterwards it runs fully offline.', sSummary: 'Daily summary', sSummaryTime: 'Generate at',
      sSummaryHint: 'After this time (while the app runs) yesterday\'s summary is generated and a notification is shown.', sStorage: 'Storage', sWorkspaceDir: 'Workspace folder', sChoose: 'Choose…', sOpenDir: 'Open',
      sTessPath: 'OCR language data URL (optional)', sOcrDropped: 'Also OCR dropped images', sPetHidden: 'Hide the cat (restore from the tray menu)', sSave: 'Save settings', sAbout: 'Status',
      keySet: 'Set: {hint}', keyNotSet: 'Not set', keyOk: 'Working ✓ ({model})', keyFail: 'Failed: {err}', testing: 'Testing…', saved: 'Saved', needTwoLanguages: 'The two languages must differ',
      hotkeyNeedsModifier: 'Needs Ctrl / Alt / Shift / Cmd', version: 'Version', platform: 'Platform', stats: '{days} days, {entries} entries', screenPerm: 'Screen recording permission',
      keyCleared: 'API key cleared', sameLang: 'The two languages must differ', dirChanged: 'Workspace switched (old files are not moved automatically)',
      sAI: 'AI service (five words & daily summary)', sProvider: 'Provider', sProviderOllama: 'Local model (Ollama)', sProviderCustom: 'Custom OpenAI-compatible endpoint',
      sAnthropicAuth: 'Sign-in method', sAccountOption: 'Signed-in Claude account (ant auth login)', sAnthropicLogin: 'Sign in to Claude in the browser',
      sOpenrouterKey: 'OpenRouter API key', sOpenrouterLogin: 'Sign in with OpenRouter', sRefreshModels: 'Refresh model list',
      sOllamaHost: 'Ollama address', sDetect: 'Detect again', sOllamaModel: 'Model to use', sUseRecommended: 'Use recommended', sPull: 'Download model',
      sCustomBase: 'Endpoint (base URL)', sCustomKey: 'API key (optional)', sNormalizeZh: 'Normalise Chinese transcripts to the selected Simplified / Traditional script (not a translation)',
      sAIHint: 'Without an AI service the five words come from local keyword extraction and the summary is a plain list. Words, titles and summaries are never translated – they follow the language of the content.',
      configured: 'In use: {label}', notConfigured: 'Not configured yet – local keywords will be used',
      accountFound: 'Sign-in profile found: {profiles}', accountEnv: 'Credentials provided via environment variables', accountNotFound: 'Not signed in – click the button to run ant auth login in a terminal',
      cliMissing: 'The ant CLI is not installed (macOS: brew install anthropics/tap/ant; other platforms: github.com/anthropics/anthropic-cli)',
      cliMissingCmd: 'ant CLI not found – install it, then run in a terminal: {cmd}', loginStarted: 'A terminal was opened – finish the browser sign-in, then click "Detect again"',
      loginWaiting: 'Browser opened – finish signing in there…', loginOk: 'Signed in, key saved',
      hwLocal: 'This machine', hwCores: '{n} threads', hwNoGpu: 'none detected', hwRecommend: 'Recommendation', hwAlternatives: 'Alternatives',
      ollamaRunning: 'running {version}', ollamaInstalled: 'installed: {models}', ollamaNoModels: 'no models yet – click "Download model"',
      ollamaNotInstalled: 'Ollama is not installed – local models need it first (about 700 MB, no account, fully offline)',
      ollamaNotStarted: 'Installed but not running ({binary}) – click "Start Ollama"',
      sInstallOllama: 'Install Ollama', sStartOllama: 'Start Ollama', sDownloadOllama: 'Download manually',
      installing: 'Installing Ollama – this downloads a few hundred MB, please wait…', installOk: 'Ollama installed – you can download a model now', installFail: 'Installation failed ({err}) – use "Download manually" instead',
      installManual: 'No package manager available here; the download page is open. Install it, then click "Detect again".',
      starting: 'Starting Ollama…', startOk: 'Ollama started', startFail: 'Could not start it: {err}',
      pullNeedsOllama: 'Install and start Ollama before downloading a model',
      pulling: 'Downloading {model}…', pullDone: '{model} downloaded', modelsLoaded: '{n} models loaded – type to filter', orVision: 'understands images',
      sSetup: 'What is ready on this computer', sSetupHint: 'All of this happens automatically: checking the machine and preparing the local text- and speech-recognition engines. Everything below can still be changed.', sSetupRun: 'Run setup', sSetupRerun: 'Run again',
      sSetupWithOllama: 'Also install a local language model (Ollama + recommended model, about 7 GB)', sSetupLog: 'Show detailed log',
      setupRunning: 'Setting up…', setupOk: 'Setup complete ✓', setupFail: 'Setup failed: {err}',
      sOcrIndependent: 'Text recognition (OCR) uses the dedicated PP-OCR engine and never involves a language model; changing the AI service does not affect it.',
      sOcrModel: 'Text-recognition model', ocrAuto: 'Choose automatically from the languages', bundled: 'bundled',
      sMic: 'Microphone', sMicRefresh: 'Refresh', sMicTest: 'Test microphone (speak for 2 s)', micDefault: 'System default', micLoading: 'Reading microphone list…',
      micTesting: 'Recording 2 seconds – please speak…', micOk: 'Sound detected ✓ ({mic}, peak {peak})', micSilent: 'No sound ({mic}). This device is silent – try another one', micError: 'Cannot open microphone: {err}',
      micNone: 'No microphone devices found',
      sClipboard: 'Clipboard', sClipboardWatch: 'Record the clipboard in real time (copied text, images and files are saved and tagged)', sClipboardMin: 'Minimum text length to record',
      sClipboardHint: 'Content copied from password managers is skipped; text copied out of the workspace itself is not recorded twice. The tray menu has the same switch.', fromClipboard: '📋 clipboard', fromBrowser: '🧩 web page',
      extOn: 'Extension connected', extOff: 'Install the extension', extOffTitle: 'Click for the installation steps – then you can send images and videos from any page here',
      extOnTitle: 'Browser extension v{version} connected – press Alt+Shift+D on any page', extApiOff: 'Extension endpoint off', extApiOffTitle: 'Turn it back on in Settings › Browser extension',
      extGuideOpened: 'Opened the installation steps in your browser',
      sExtension: 'Browser extension (collect images / videos from a page)', sExtensionHint: 'With the extension installed, click its icon on any page (or press Alt+Shift+D) to see every image, video and audio file on it and send the ones you pick to the workspace.',
      sLocalApi: 'Allow the browser extension to connect (local endpoint, 127.0.0.1 only)', sLocalApiPort: 'Port', sExportExt: 'Export extension folder…', sOpenExt: 'Open extension folder', sExtHelp: 'Installation steps',
      apiRunning: 'Endpoint running: http://127.0.0.1:{port}{last}', apiStopped: 'Endpoint off – the extension cannot connect', apiLast: ', last received {time}',
      extSteps: '<b>Chrome / Edge</b><br>1. Click "Export extension folder…" to copy the extension somewhere permanent (or use the bundled path below).<br>2. Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>).<br>3. Turn on "Developer mode".<br>4. Click "Load unpacked" and choose that folder.<br>5. Click the extension icon on any page, or press <code>Alt+Shift+D</code>.<br><br>Extension folder: <code>{dir}</code><br>If the extension says DailyLogs is not running, check that the port above matches the one in the extension settings.',
      extExported: 'Extension exported to {dir}',
    },
  };
  const ICONS = { screenshot: '📸', image: '🖼️', audio: '🎙️', pdf: '📄', text: '📝', url: '🔗', note: '🗒️', file: '📎' };

  const state = {
    meta: null, settings: null, ui: 'zh', entries: [], dates: [], selectedId: null, editing: false,
    query: '', date: '', summaries: [], summaryKey: null, tab: 'entries',
  };
  const t = (k, p) => {
    let s = T[state.ui][k] ?? T.en[k] ?? k;
    if (typeof s !== 'string') return s;
    if (p) for (const [a, b] of Object.entries(p)) s = s.split(`{${a}}`).join(String(b));
    return s;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (state.ui === 'zh' ? 'zh-CN' : 'en-US');
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  };
  const todayKey = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function applyI18n() {
    document.documentElement.lang = state.ui === 'zh' ? 'zh' : 'en';
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  }

  // ---------- tabs ----------
  function switchTab(tab) {
    state.tab = tab;
    for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('active', b.dataset.tab === tab);
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === `tab-${tab}`);
    if (tab === 'settings') loadPetPicker().catch((e) => console.error('pet catalogue', e));
  }

  // ---------- pet picker ----------
  // The whole free ipaslogo.com library, every one of them in the same round frame the
  // pet wears. Only ids, names and background colours cross IPC (~250 KB); the pictures
  // load lazily from the CDN and the grid grows as it is scrolled, so opening the tab is
  // instant even at 3448 entries. Picking one downloads that single original into userData.
  const petLib = { logos: [], thumb: '', current: '', avatarUrl: '', filtered: [], shown: 0, loaded: false };

  // the one picture the pet wears, shown in the sidebar and in the picker's current slot;
  // it is the local file main already mirrored and resized, never the CDN thumbnail
  function setAvatarEverywhere(url) {
    if (!url) return;
    petLib.avatarUrl = url;
    $('#brandAvatar').src = url;
    $('#petCurrent').src = url;
  }
  const PET_PAGE = 240;

  async function loadPetPicker() {
    if (petLib.loaded) return;
    petLib.loaded = true;
    const c = await ws.petCatalog();
    petLib.logos = c.logos || [];
    petLib.thumb = c.thumb || '';
    petLib.current = c.current || '';
    filterPets($('#petSearch').value || '');
    renderPetCurrent();
  }

  const petThumb = (k) => petLib.thumb.replace('{k}', k);

  function filterPets(query) {
    const q = query.trim().toLowerCase();
    petLib.filtered = q ? petLib.logos.filter((l) => l.n.toLowerCase().includes(q)) : petLib.logos;
    petLib.shown = 0;
    const grid = $('#petGrid');
    grid.innerHTML = '';
    grid.scrollTop = 0;
    $('#petCount').textContent = t('sPetCount', { n: petLib.filtered.length });
    growPetGrid();
  }

  function growPetGrid() {
    const grid = $('#petGrid');
    if (!petLib.filtered.length) { grid.innerHTML = `<p class="muted pet-empty">${esc(t('sPetNone'))}</p>`; return; }
    const next = petLib.filtered.slice(petLib.shown, petLib.shown + PET_PAGE);
    if (!next.length) return;
    grid.insertAdjacentHTML('beforeend', next.map((l) =>
      `<button type="button" class="pet-cell${l.k === petLib.current ? ' on' : ''}" data-k="${esc(l.k)}" `
      + `style="background-color:${esc(l.bg)}" title="${esc(l.n)}">`
      + `<img loading="lazy"${l.f ? ' class="flip"' : ''} src="${esc(petThumb(l.k))}" alt="" /></button>`).join(''));
    petLib.shown += next.length;
  }

  function renderPetCurrent() {
    const cur = petLib.logos.find((l) => l.k === petLib.current);
    if (petLib.avatarUrl) $('#petCurrent').src = petLib.avatarUrl;
    $('#petCurrentName').textContent = cur ? cur.n : t('sPetDefault');
    $('#petReset').disabled = !petLib.current;
    for (const b of document.querySelectorAll('.pet-cell')) b.classList.toggle('on', b.dataset.k === petLib.current);
  }

  async function pickPet(key) {
    const grid = $('#petGrid');
    grid.classList.add('busy');
    $('#petStatus').textContent = t('petApplying');
    const r = await ws.petSetAvatar(key);
    grid.classList.remove('busy');
    if (!r || !r.ok) { $('#petStatus').textContent = t('petFailed', { err: (r && r.error) || '?' }); return; }
    petLib.current = key;
    setAvatarEverywhere(r.avatarUrl);
    renderPetCurrent();
    $('#petStatus').textContent = t('petApplied');
  }

  // ---------- entries ----------
  async function loadEntries() {
    state.dates = await ws.listDates();
    state.entries = await ws.listEntries({ query: state.query, dates: state.date ? [state.date] : null });
    renderDateFilter();
    renderList();
    if (state.selectedId && !state.entries.some((e) => e.id === state.selectedId)) { state.selectedId = null; renderDetail(); }
  }

  function renderDateFilter() {
    const sel = $('#dateFilter');
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(t('allDates'))}</option>` + state.dates.map((d) => `<option value="${d}">${esc(fmtDate(d))}</option>`).join('');
    sel.value = state.dates.includes(cur) ? cur : '';
  }

  function statusPill(e) {
    if (e.status === 'processing') return `<span class="pill processing">${esc(t('processing'))}${e.progress ? ` · ${esc(e.progress)}` : ''}</span>`;
    if (e.status === 'error') return `<span class="pill error">${esc(t('error'))}</span>`;
    if (e.tagsSource === 'local') return `<span class="pill local">${esc(t('localTags'))}</span>`;
    return '';
  }

  function renderList() {
    const list = $('#entryList');
    if (!state.entries.length) { list.innerHTML = `<div class="empty"><div class="empty-art">🐱</div><span>${esc(t('noEntries'))}</span></div>`; return; }
    const groups = new Map();
    for (const e of state.entries) { if (!groups.has(e.dateKey)) groups.set(e.dateKey, []); groups.get(e.dateKey).push(e); }
    let html = '';
    for (const [key, items] of groups) {
      html += `<div class="day-head">${esc(fmtDate(key))} · ${items.length}</div>`;
      for (const e of items) {
        const thumb = (e.type === 'screenshot' || e.type === 'image') && e.fileUrl
          ? `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />` : (ICONS[e.type] || ICONS.file);
        html += `<div class="card${e.id === state.selectedId ? ' selected' : ''}" data-id="${e.id}">
          <div class="thumb t-${esc(e.type)}">${thumb}</div>
          <div class="card-body">
            <div class="card-title">${esc(e.title || e.path || e.url || '')}</div>
            <div class="card-meta"><span>${fmtTime(e.createdAt)}</span><span>${esc(t('types')[e.type] || e.type)}</span>${e.origin === 'clipboard' ? `<span>${esc(t('fromClipboard'))}</span>` : ''}${e.origin === 'browser' ? `<span>${esc(t('fromBrowser'))}</span>` : ''}${statusPill(e)}</div>
            ${e.tags && e.tags.length ? `<div class="tags">${e.tags.map((w) => `<span class="chip">${esc(w)}</span>`).join('')}</div>` : ''}
          </div></div>`;
      }
    }
    list.innerHTML = html;
  }

  function currentEntry() { return state.entries.find((e) => e.id === state.selectedId) || null; }

  function renderDetail() {
    const box = $('#detail');
    const e = currentEntry();
    if (!e) { box.innerHTML = `<div class="empty"><div class="empty-art">🐾</div><span>${esc(t('selectEntry'))}</span></div>`; return; }
    if (state.editing) { renderEditForm(e); return; }
    let preview = '';
    if ((e.type === 'screenshot' || e.type === 'image') && e.fileUrl) preview = `<img id="previewImg" src="${esc(e.fileUrl)}" alt="" />`;
    else if (e.type === 'audio') preview = `<audio controls src="${esc(e.fileUrl)}"></audio><div class="muted" style="padding:0 12px 10px">${esc(t('duration'))}: ${e.durationSec || 0}s</div>`;
    else if (e.type === 'url') preview = `<div class="link">${ICONS.url} <a href="#" data-action="openLink">${esc(e.url)}</a></div>`;
    else preview = `<div class="file">${ICONS[e.type] || ICONS.file}<small>${esc(e.path || '')}${e.size ? ` · ${(e.size / 1024).toFixed(1)} KB` : ''}</small></div>`;

    const textLabel = e.type === 'audio' ? t('transcript') : (e.type === 'screenshot' || e.type === 'image') ? t('text') : t('content');
    const statusLine = e.status === 'processing'
      ? `<div class="status-line"><span class="pill processing">${esc(t('processing'))}</span> ${esc(e.progress || '')}</div>`
      : e.status === 'error' ? `<div class="status-line"><span class="pill error">${esc(t('error'))}</span> ${esc(e.error || '')}</div>`
        : e.error ? `<div class="status-line muted">⚠ ${esc(e.error)}</div>` : '';

    box.innerHTML = `
      <div class="detail-head"><span class="tile t-${esc(e.type)}">${ICONS[e.type] || ICONS.file}</span><h2>${esc(e.title || e.path || e.url || '')}</h2></div>
      <div class="time">${esc(fmtDate(e.dateKey))} ${fmtTime(e.createdAt)} · ${esc(t('types')[e.type] || e.type)}${e.origin === 'clipboard' ? ` · ${esc(t('fromClipboard'))}` : ''}${e.origin === 'browser' ? ` · ${esc(t('fromBrowser'))}` : ''}${e.sttLanguage ? ` · ${esc(e.sttLanguage)}` : ''}${e.model ? ` · ${esc(e.model)}` : ''}</div>
      <div class="preview">${preview}</div>
      ${statusLine}
      <h3>${esc(t('words'))}</h3>
      <div class="tags">${(e.tags || []).map((w) => `<span class="chip">${esc(w)}</span>`).join('') || '<span class="muted">—</span>'}</div>
      ${e.summary ? `<h3>${esc(t('summary'))}</h3><p class="summary-text">${esc(e.summary)}</p>` : ''}
      <div class="actions">
        ${e.path ? `<button class="btn" data-action="open">${esc(t('open'))}</button><button class="btn" data-action="reveal">${esc(t('reveal'))}</button>` : ''}
        ${e.url ? `<button class="btn" data-action="openLink">${esc(t('openLink'))}</button>` : ''}
        <button class="btn" data-action="retry">${esc(t('retry'))}</button>
        <button class="btn" data-action="edit">${esc(t('edit'))}</button>
        ${e.text ? `<button class="btn" data-action="copy">${esc(t('copy'))}</button>` : ''}
        <button class="btn danger" data-action="delete">${esc(t('delete'))}</button>
      </div>
      ${e.text ? `<h3>${esc(textLabel)}</h3><div class="text-block">${esc(e.text)}</div>` : ''}`;
  }

  function renderEditForm(e) {
    $('#detail').innerHTML = `
      <form class="edit-form" id="editForm">
        <label><span>${esc(t('title'))}</span><input name="title" value="${esc(e.title || '')}" /></label>
        <label><span>${esc(t('tagsField'))}</span><input name="tags" value="${esc((e.tags || []).join(', '))}" /></label>
        <label><span>${esc(t('textField'))}</span><textarea name="text">${esc(e.text || '')}</textarea></label>
        <div class="actions"><button type="submit" class="btn primary">${esc(t('save'))}</button><button type="button" class="btn" data-action="cancelEdit">${esc(t('cancel'))}</button></div>
      </form>`;
    $('#editForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const tags = String(fd.get('tags') || '').split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
      const updated = await ws.updateEntry(e.id, { title: fd.get('title'), tags, text: fd.get('text') });
      if (updated) upsert(updated);
      state.editing = false;
      renderDetail(); renderList();
      toast(t('saved'));
    });
  }

  function upsert(entry) {
    const i = state.entries.findIndex((x) => x.id === entry.id);
    if (i >= 0) state.entries[i] = entry;
    else if (!state.date || state.date === entry.dateKey) {
      state.entries.push(entry);
      state.entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (!state.dates.includes(entry.dateKey)) { state.dates.unshift(entry.dateKey); state.dates.sort().reverse(); renderDateFilter(); }
  }

  async function detailAction(action) {
    const e = currentEntry();
    if (!e) return;
    switch (action) {
      case 'open': await ws.openEntry(e.id); break;
      case 'reveal': await ws.revealEntry(e.id); break;
      case 'openLink': await ws.openExternal(e.url); break;
      case 'retry': await ws.retryEntry(e.id); break;
      case 'edit': state.editing = true; renderDetail(); break;
      case 'cancelEdit': state.editing = false; renderDetail(); break;
      case 'copy': await navigator.clipboard.writeText(e.text || ''); toast(t('copied')); break;
      case 'delete':
        if (!window.confirm(t('confirmDelete'))) return;
        await ws.deleteEntry(e.id);
        state.entries = state.entries.filter((x) => x.id !== e.id);
        state.selectedId = null; renderList(); renderDetail();
        break;
      default: break;
    }
  }

  // ---------- summaries ----------
  async function loadSummaries() {
    state.summaries = await ws.listSummaries();
    renderSummaryList();
  }
  function renderSummaryList() {
    const list = $('#summaryList');
    if (!state.summaries.length) { list.innerHTML = `<div class="empty"><div class="empty-art">📖</div><span>${esc(t('noSummary'))}</span></div>`; return; }
    list.innerHTML = state.summaries.map((s) => `
      <div class="sum-item${s.dateKey === state.summaryKey ? ' selected' : ''}" data-date="${s.dateKey}">
        <div class="d">${esc(fmtDate(s.dateKey))}</div>
        <div class="muted">${esc(t('summaryItems', { n: s.entryCount ?? '?' }))} · ${esc(t('bySource')[s.source] || s.source || '')}${s.model ? ` · ${esc(s.model)}` : ''}</div>
      </div>`).join('');
  }
  async function showSummary(dateKey) {
    state.summaryKey = dateKey;
    renderSummaryList();
    const s = await ws.getSummary(dateKey);
    const view = $('#summaryView');
    if (!s) { view.innerHTML = `<div class="empty">${esc(t('noSummary'))}</div>`; return; }
    const gen = s.meta && s.meta.generatedAt ? new Date(s.meta.generatedAt).toLocaleString(locale()) : '';
    view.innerHTML = `<div class="meta">${esc(fmtDate(dateKey))}${gen ? ` · ${esc(gen)}` : ''}${s.meta && s.meta.model ? ` · ${esc(s.meta.model)}` : ''}</div>${md(s.text)}`;
  }
  async function generateSummary() {
    const date = $('#summaryDate').value;
    if (!date) return;
    const btn = $('#btnGenSummary');
    btn.disabled = true; $('#summaryStatus').textContent = t('generating');
    try {
      const r = await ws.generateSummary(date);
      if (!r) { $('#summaryStatus').textContent = t('noEntriesThatDay'); return; }
      $('#summaryStatus').textContent = t('generated');
      await loadSummaries();
      await showSummary(date);
    } catch (e) {
      $('#summaryStatus').textContent = `${t('error')}: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  }
  function md(src) {
    const lines = String(src || '').split(/\r?\n/);
    let html = ''; let list = null; let para = [];
    const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of lines) {
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); close(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
      else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^>\s?(.*)$/.exec(line))) { flush(); close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
      else if (!line.trim()) { flush(); close(); }
      else para.push(line);
    }
    flush(); close();
    return html;
  }

  // ---------- settings ----------
  function langOptions(selected) {
    return state.meta.languages.map((l) => `<option value="${l.code}"${l.code === selected ? ' selected' : ''}>${esc(l.name)}${l.name !== l.english ? ` (${esc(l.english)})` : ''}</option>`).join('');
  }
  function populateSettings() {
    const s = state.settings; const m = state.meta;
    $('#lang1').innerHTML = langOptions(s.languages[0]);
    $('#lang2').innerHTML = langOptions(s.languages[1]);
    $('#hotkeyRegion').value = s.hotkeyRegion || '';
    $('#hotkeyScreen').value = s.hotkeyScreen || '';
    $('#hotkeyVoice').value = s.hotkeyVoice || '';
    $('#captureToClipboard').checked = s.captureToClipboard !== false;
    $('#hotkeyError').textContent = m.hotkeyError || '';
    $('#provider').value = s.provider || 'anthropic';
    $('#anthropicAuth').value = s.anthropicAuth || 'apiKey';
    $('#apiKey').value = '';
    $('#apiKeyStatus').textContent = keyStatus(s.hasApiKey, s.apiKeyHint);
    $('#model').innerHTML = m.models.map((x) => `<option value="${x.id}"${x.id === s.model ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    $('#openrouterKey').value = '';
    $('#openrouterKeyStatus').textContent = keyStatus(s.hasOpenrouterKey, s.openrouterKeyHint);
    $('#openrouterModel').value = s.openrouterModel || '';
    $('#ollamaHost').value = s.ollamaHost || '';
    $('#ollamaModel').value = s.ollamaModel || '';
    $('#customBaseUrl').value = s.customBaseUrl || '';
    $('#customModel').value = s.customModel || '';
    $('#customKey').value = '';
    $('#customKeyStatus').textContent = keyStatus(s.hasCustomKey, s.customKeyHint);
    $('#normalizeChineseScript').checked = s.normalizeChineseScript !== false;
    $('#clipboardWatch').checked = s.clipboardWatch !== false;
    $('#clipboardMinChars').value = s.clipboardMinChars ?? 12;
    $('#localApi').checked = s.localApi !== false;
    $('#localApiPort').value = s.localApiPort ?? 47831;
    const api = m.localApi || {};
    $('#apiStatus').textContent = api.running
      ? t('apiRunning', { port: api.port, last: api.lastReceived ? t('apiLast', { time: new Date(api.lastReceived).toLocaleString(locale()) }) : '' })
      : t('apiStopped');
    renderMicOptions(state.mics || [], s.micDeviceId || '', s.micLabel || '');
    if (!state.mics) loadMics();
    showProviderPanel();
    loadProviderStatus();
    if ($('#provider').value === 'openrouter' && !state.orModels) loadOpenrouterModels();
    $('#sttModel').innerHTML = m.sttModels.map((x) => `<option value="${x.id}"${x.id === s.sttModel ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    $('#ocrModel').innerHTML = [`<option value="">${esc(t('ocrAuto'))}</option>`]
      .concat((m.ocrModels || []).map((x) => `<option value="${esc(x.id)}"${x.id === s.ocrModel ? ' selected' : ''}>${esc(x.name)} · ${x.bundled ? t('bundled') : `${x.sizeMB} MB`}</option>`)).join('');
    renderSttLanguage();
    $('#hfMirror').value = s.hfMirror || '';
    $('#summaryTime').value = s.summaryTime || '08:00';
    $('#workspaceDir').value = m.workspaceDir || '';
    $('#ocrDroppedImages').checked = !!s.ocrDroppedImages;
    $('#petHidden').checked = !!s.petHidden;
    const perm = m.platform === 'darwin' ? `<br><b>${esc(t('screenPerm'))}:</b> ${esc(m.screenPermission)}` : '';
    $('#aboutBox').innerHTML = `<b>${esc(t('version'))}:</b> ${esc(m.version)} · <b>${esc(t('platform'))}:</b> ${esc(m.platform)}<br>${esc(t('stats', m.stats))}${perm}`;
    $('#sideStats').textContent = t('stats', m.stats);
  }
  function renderSttLanguage() {
    const langs = [$('#lang1').value, $('#lang2').value];
    const names = Object.fromEntries(state.meta.languages.map((l) => [l.code, l.name]));
    const cur = state.settings.sttLanguage || 'auto';
    $('#sttLanguage').innerHTML = [
      `<option value="auto"${cur === 'auto' ? ' selected' : ''}>${esc(t('sAuto'))}</option>`,
      `<option value="packs"${cur === 'packs' ? ' selected' : ''}>${esc(t('sAutoPacks'))}</option>`,
    ].concat(langs.map((c) => `<option value="${c}"${c === cur ? ' selected' : ''}>${esc(names[c] || c)}</option>`)).join('');
  }
  function keyFromEvent(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.metaKey) mods.push(state.meta.platform === 'darwin' ? 'Cmd' : 'Super');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    let key = null;
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
    else key = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', '`': '`', '-': '-', '=': '=', '[': '[', ']': ']', ';': ';', "'": "'", ',': ',', '.': '.', '/': '/', '\\': '\\' }[e.key] || null;
    return { mods, key };
  }
  async function saveSettings(ev) {
    ev.preventDefault();
    const l1 = $('#lang1').value; const l2 = $('#lang2').value;
    if (l1 === l2) { toast(t('sameLang')); return; }
    const patch = {
      languages: [l1, l2],
      hotkeyRegion: $('#hotkeyRegion').value.trim(),
      hotkeyScreen: $('#hotkeyScreen').value.trim(),
      hotkeyVoice: $('#hotkeyVoice').value.trim(),
      captureToClipboard: $('#captureToClipboard').checked,
      model: $('#model').value,
      sttModel: $('#sttModel').value,
      sttLanguage: $('#sttLanguage').value,
      hfMirror: $('#hfMirror').value.trim(),
      summaryTime: $('#summaryTime').value || '08:00',
      ocrDroppedImages: $('#ocrDroppedImages').checked,
      petHidden: $('#petHidden').checked,
    };
    Object.assign(patch, {
      provider: $('#provider').value,
      anthropicAuth: $('#anthropicAuth').value,
      openrouterModel: $('#openrouterModel').value.trim() || 'anthropic/claude-opus-5',
      ollamaHost: $('#ollamaHost').value.trim() || 'http://127.0.0.1:11434',
      ollamaModel: $('#ollamaModel').value.trim(),
      customBaseUrl: $('#customBaseUrl').value.trim(),
      customModel: $('#customModel').value.trim(),
      normalizeChineseScript: $('#normalizeChineseScript').checked,
      clipboardWatch: $('#clipboardWatch').checked,
      clipboardMinChars: Math.max(1, Number($('#clipboardMinChars').value) || 12),
      ocrModel: $('#ocrModel').value,
      localApi: $('#localApi').checked,
      localApiPort: Math.min(65535, Math.max(1024, Number($('#localApiPort').value) || 47831)),
      micDeviceId: $('#micDevice').value,
      micLabel: $('#micDevice').value ? ($('#micDevice').selectedOptions[0] || {}).textContent || '' : '',
    });
    for (const [field, id] of [['apiKey', '#apiKey'], ['openrouterKey', '#openrouterKey'], ['customKey', '#customKey']]) {
      const v = $(id).value.trim();
      if (v) patch[field] = v;
    }
    const chosenDir = $('#workspaceDir').dataset.chosen;
    if (chosenDir !== undefined && chosenDir !== state.meta.workspaceDir) patch.workspaceDir = chosenDir;
    const updated = await ws.saveSettings(patch);
    await refreshMeta(updated);
    $('#settingsStatus').textContent = t('saved');
    toast(t('saved'));
    if (patch.workspaceDir !== undefined) { toast(t('dirChanged')); await loadEntries(); await loadSummaries(); }
  }
  async function refreshMeta(settings) {
    state.meta = await ws.getSettings();
    setAvatarEverywhere(state.meta.avatarUrl);
    state.settings = settings || state.meta.settings;
    state.ui = state.settings.languages[0].startsWith('zh') ? 'zh' : 'en';
    applyI18n();
    populateSettings();
    renderList(); renderDetail(); renderSummaryList();
  }

  // ---------- browser-extension status chip ----------
  function renderExtChip(st) {
    const chip = $('#extChip');
    if (!chip) return;
    state.extStatus = st || state.extStatus;
    const s = state.extStatus || {};
    if (!s.running) {
      chip.className = 'chip-status off';
      $('#extChipText').textContent = t('extApiOff');
      chip.title = t('extApiOffTitle');
    } else if (s.extension && s.extension.connected) {
      chip.className = 'chip-status on';
      $('#extChipText').textContent = t('extOn');
      chip.title = t('extOnTitle', { version: s.extension.version || '' });
    } else {
      chip.className = 'chip-status off';
      $('#extChipText').textContent = t('extOff');
      chip.title = t('extOffTitle');
    }
  }
  async function loadExtStatus() {
    try { renderExtChip(await ws.extensionStatus()); } catch (_) { /* app closing */ }
  }
  async function onExtChipClick() {
    const s = state.extStatus || {};
    if (s.running && s.extension && s.extension.connected) return;   // already fine
    if (!s.running) { switchTab('settings'); $('#localApi').scrollIntoView({ block: 'center' }); return; }
    const r = await ws.openExtensionGuide();
    if (r && r.ok) toast(t('extGuideOpened'));
  }

  // ---------- one-click setup ----------
  function renderSetup(st) {
    if (!st) return;
    $('#setupPanel').classList.remove('hidden');
    $('#setupPanel .bar i').style.width = `${st.percent || 0}%`;
    $('#setupNow').textContent = st.current || (st.running ? t('setupRunning') : st.ok === true ? t('setupOk') : st.ok === false ? t('setupFail', { err: st.error || '' }) : '');
    $('#setupSteps').innerHTML = (st.steps || []).map((s) => `<li class="${s.state}"><span class="dot"></span><span>${esc(s.label)}</span>${s.detail ? `<em>${esc(s.detail)}</em>` : ''}</li>`).join('');
    if (st.summary && st.summary.length) {
      $('#setupSummary').innerHTML = st.summary.map((x) => `<li>${esc(x)}</li>`).join('');
      $('#setupSummary').classList.remove('hidden');
    }
    $('#btnSetup').disabled = !!st.running;
  }
  async function runSetup() {
    $('#setupLog').textContent = '';
    $('#setupSummary').classList.add('hidden');
    $('#btnSetup').disabled = true;
    try {
      const st = await ws.runSetup({ installOllama: false });
      renderSetup(st);
      await refreshMeta();
    } catch (e) {
      $('#setupNow').textContent = t('setupFail', { err: e.message });
    } finally {
      $('#btnSetup').disabled = false;
    }
  }

  // ---------- microphone ----------
  function renderMicOptions(mics, selectedId, selectedLabel) {
    const opts = [`<option value="">${esc(t('micDefault'))}</option>`];
    let found = !selectedId;
    for (const m of mics) {
      if (m.deviceId === selectedId) found = true;
      opts.push(`<option value="${esc(m.deviceId)}"${m.deviceId === selectedId ? ' selected' : ''}>${esc(m.label)}</option>`);
    }
    if (!found) opts.push(`<option value="${esc(selectedId)}" selected>${esc(selectedLabel || selectedId)}</option>`);
    $('#micDevice').innerHTML = opts.join('');
  }
  async function loadMics() {
    $('#micStatus').textContent = t('micLoading');
    try {
      const mics = await ws.micDevices();
      state.mics = mics || [];
      const s = state.settings;
      renderMicOptions(state.mics, s.micDeviceId || '', s.micLabel || '');
      $('#micStatus').textContent = state.mics.length ? '' : t('micNone');
    } catch (e) {
      $('#micStatus').textContent = t('micError', { err: e.message });
    }
  }
  async function testMic() {
    $('#btnMicTest').disabled = true;
    $('#micStatus').textContent = t('micTesting');
    try {
      const r = await ws.micTest($('#micDevice').value);
      if (r.error) $('#micStatus').textContent = t('micError', { err: r.error });
      else if ((r.peak || 0) < 0.004) $('#micStatus').textContent = t('micSilent', { mic: r.label || t('micDefault') });
      else $('#micStatus').textContent = t('micOk', { mic: r.label || t('micDefault'), peak: (r.peak || 0).toFixed(2) });
    } catch (e) {
      $('#micStatus').textContent = t('micError', { err: e.message });
    } finally {
      $('#btnMicTest').disabled = false;
    }
  }

  // ---------- AI provider panel ----------
  function keyStatus(has, hint) { return has ? t('keySet', { hint }) : t('keyNotSet'); }
  function formOverride() {
    return {
      provider: $('#provider').value, anthropicAuth: $('#anthropicAuth').value, model: $('#model').value,
      apiKey: $('#apiKey').value.trim(), openrouterKey: $('#openrouterKey').value.trim(), openrouterModel: $('#openrouterModel').value.trim(),
      ollamaHost: $('#ollamaHost').value.trim(), ollamaModel: $('#ollamaModel').value.trim(),
      customBaseUrl: $('#customBaseUrl').value.trim(), customKey: $('#customKey').value.trim(), customModel: $('#customModel').value.trim(),
    };
  }
  function showProviderPanel() {
    const p = $('#provider').value;
    for (const el of document.querySelectorAll('.panel')) el.classList.toggle('active', el.id === `panel-${p}`);
    const account = $('#anthropicAuth').value === 'account';
    $('#rowApiKey').classList.toggle('hidden', account);
    $('#apiKeyStatus').classList.toggle('hidden', account);
    $('#rowAccount').classList.toggle('hidden', !account);
  }
  async function loadProviderStatus(refresh = false) {
    try {
      state.providerStatus = await ws.providerStatus({ refresh });
      renderProviderStatus();
    } catch (e) {
      $('#hwBox').textContent = String(e.message || e);
    }
  }
  function renderProviderStatus() {
    const st = state.providerStatus;
    if (!st) return;
    $('#providerConfigured').textContent = st.configured ? t('configured', { label: st.label }) : t('notConfigured');
    const a = st.anthropic || {};
    $('#anthropicAccountStatus').textContent = a.hasProfile ? t('accountFound', { profiles: (a.profiles || []).join(', ') })
      : (a.envKey || a.envToken) ? t('accountEnv') : a.cliInstalled ? t('accountNotFound') : t('cliMissing');
    const hw = st.hardware || { gpus: [], cpu: '', cores: 0, ramGB: 0 };
    const rec = st.recommendation || { reason: '', notes: [], alternatives: [], model: '' };
    const ol = st.ollama || { running: false, models: [] };
    const gpus = hw.gpus.length ? hw.gpus.map((g) => `${g.name}${g.vramGB ? ` (${g.vramGB} GB)` : ''}`).join(', ') : t('hwNoGpu');
    let html = `<div><b>${esc(t('hwLocal'))}:</b> ${esc(hw.cpu)} · ${esc(t('hwCores', { n: hw.cores }))} · RAM ${hw.ramGB} GB · GPU ${esc(gpus)}</div>`;
    html += `<div><b>${esc(t('hwRecommend'))}:</b> ${esc(rec.reason)}${rec.notes.length ? ` ${esc(rec.notes.join(' '))}` : ''}</div>`;
    html += `<div>${esc(t('hwAlternatives'))}: ${rec.alternatives.map((x) => `<code>${esc(x.model)}</code> (${x.sizeGB} GB, ${esc(x.note)})`).join(' · ')}</div>`;
    if (ol.running) {
      const names = ol.models.map((m) => m.name);
      html += `<div><b>Ollama:</b> <span class="ok">${esc(t('ollamaRunning', { version: ol.version || '' }))}</span> · ${names.length ? esc(t('ollamaInstalled', { models: names.join(', ') })) : esc(t('ollamaNoModels'))}</div>`;
      $('#ollamaModels').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
    } else if (ol.installed) {
      html += `<div><b>Ollama:</b> <span class="bad">${esc(t('ollamaNotStarted', { binary: ol.binary || '' }))}</span></div>`;
    } else {
      html += `<div><b>Ollama:</b> <span class="bad">${esc(t('ollamaNotInstalled'))}</span></div>`;
    }
    $('#hwBox').innerHTML = html;
    $('#ollamaModel').placeholder = rec.model || '';
    // only offer the step that is actually needed
    $('#ollamaSetup').classList.toggle('hidden', !!ol.running);
    $('#btnInstallOllama').classList.toggle('hidden', !!ol.installed);
    $('#btnStartOllama').classList.toggle('hidden', !ol.installed);
    $('#btnPull').disabled = !ol.running;
  }
  async function loadOpenrouterModels(refresh = false) {
    const r = await ws.openrouterModels({ refresh });
    if (!r.ok) { $('#openrouterModelInfo').textContent = t('keyFail', { err: r.error }); return; }
    state.orModels = r.models;
    $('#openrouterModels').innerHTML = r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    updateOpenrouterInfo();
  }
  function updateOpenrouterInfo() {
    const id = $('#openrouterModel').value.trim();
    const m = (state.orModels || []).find((x) => x.id === id);
    if (!m) { $('#openrouterModelInfo').textContent = state.orModels ? t('modelsLoaded', { n: state.orModels.length }) : ''; return; }
    const price = m.pricing && m.pricing.prompt >= 0 ? ` · $${(m.pricing.prompt * 1e6).toFixed(2)} / $${(m.pricing.completion * 1e6).toFixed(2)} per 1M tokens` : '';
    $('#openrouterModelInfo').textContent = `${m.name}${m.context ? ` · ${Math.round(m.context / 1000)}K ctx` : ''}${m.vision ? ` · ${t('orVision')}` : ''}${price}`;
  }
  let pullingModel = '';
  async function pullModel() {
    const model = $('#ollamaModel').value.trim() || (state.providerStatus && state.providerStatus.recommendation.model);
    if (!model) return;
    pullingModel = model;
    $('#btnPull').disabled = true;
    $('#pullProgress').innerHTML = `<span>${esc(t('pulling', { model }))}</span><div class="bar"><i></i></div>`;
    try {
      const r = await ws.ollamaPull(model);
      if (r && r.ok) {
        $('#pullProgress').textContent = t('pullDone', { model });
        $('#ollamaModel').value = model;
      } else {
        const code = r && r.code;
        $('#pullProgress').textContent = code === 'ollama-not-installed' ? t('ollamaNotInstalled')
          : code === 'ollama-not-running' ? t('pullNeedsOllama')
            : `${t('error')}: ${(r && r.error) || ''}`;
      }
      await loadProviderStatus();
    } catch (e) {
      $('#pullProgress').textContent = `${t('error')}: ${e.message}`;
    } finally {
      $('#btnPull').disabled = false;
      pullingModel = '';
    }
  }

  function appendLog(line) {
    const box = $('#installLog');
    box.classList.remove('hidden');
    box.textContent = `${box.textContent}${box.textContent ? '\n' : ''}${line}`.split('\n').slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  async function installOllama() {
    $('#btnInstallOllama').disabled = true;
    $('#installLog').textContent = '';
    $('#pullProgress').textContent = t('installing');
    try {
      const r = await ws.ollamaInstall();
      if (r.manual) { $('#pullProgress').textContent = t('installManual'); await ws.openExternal(r.url); }
      else if (r.ok) $('#pullProgress').textContent = t('installOk');
      else { $('#pullProgress').textContent = t('installFail', { err: r.exitCode !== undefined ? `exit ${r.exitCode}` : (r.error || '') }); await ws.openExternal(r.url || 'https://ollama.com/download'); }
      await loadProviderStatus(true);
    } catch (e) {
      $('#pullProgress').textContent = t('installFail', { err: e.message });
    } finally {
      $('#btnInstallOllama').disabled = false;
    }
  }
  async function startOllama() {
    $('#btnStartOllama').disabled = true;
    $('#pullProgress').textContent = t('starting');
    try {
      const r = await ws.ollamaStart();
      $('#pullProgress').textContent = r.ok ? t('startOk') : t('startFail', { err: r.error || '' });
      await loadProviderStatus(true);
    } finally {
      $('#btnStartOllama').disabled = false;
    }
  }

  // ---------- wiring ----------
  async function init() {
    state.meta = await ws.getSettings();
    setAvatarEverywhere(state.meta.avatarUrl);
    state.settings = state.meta.settings;
    state.ui = state.settings.languages[0].startsWith('zh') ? 'zh' : 'en';
    applyI18n();
    populateSettings();
    $('#summaryDate').value = todayKey(-1);
    await loadEntries();
    await loadSummaries();

    document.querySelector('.nav').addEventListener('click', (e) => { const b = e.target.closest('.tab-btn'); if (b) switchTab(b.dataset.tab); });
    $('#btnCapture').addEventListener('click', () => ws.capture().catch((err) => toast(err.message)));
    $('#btnAddFiles').addEventListener('click', () => ws.addFiles());
    let searchTimer = null;
    $('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = e.target.value; loadEntries(); }, 200); });
    $('#dateFilter').addEventListener('change', (e) => { state.date = e.target.value; loadEntries(); });
    $('#quickAdd').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('#quickInput').value.trim();
      if (!v) return;
      $('#quickInput').value = '';
      if (/^(https?:\/\/|www\.)\S+$/i.test(v)) await ws.addUrl(v); else await ws.addNote(v);
    });
    $('#entryList').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      state.selectedId = card.dataset.id; state.editing = false;
      renderList(); renderDetail();
    });
    $('#detail').addEventListener('click', (e) => {
      const img = e.target.closest('#previewImg');
      if (img) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${esc(img.src)}" alt="" />`; lb.addEventListener('click', () => lb.remove()); document.body.appendChild(lb); return; }
      const btn = e.target.closest('[data-action]');
      if (btn) { e.preventDefault(); detailAction(btn.dataset.action); }
    });
    $('#summaryList').addEventListener('click', (e) => { const it = e.target.closest('.sum-item'); if (it) showSummary(it.dataset.date); });
    $('#btnGenSummary').addEventListener('click', generateSummary);

    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#petSearch').addEventListener('input', (e) => filterPets(e.target.value));
    $('#petReset').addEventListener('click', () => pickPet(''));
    $('#petGrid').addEventListener('click', (e) => { const b = e.target.closest('.pet-cell'); if (b) pickPet(b.dataset.k); });
    $('#petGrid').addEventListener('scroll', (e) => {
      const g = e.currentTarget;
      if (g.scrollTop + g.clientHeight > g.scrollHeight - 240) growPetGrid();
    });
    $('#lang1').addEventListener('change', renderSttLanguage);
    $('#lang2').addEventListener('change', renderSttLanguage);
    for (const id of ['#hotkeyRegion', '#hotkeyScreen', '#hotkeyVoice']) $(id).addEventListener('keydown', (e) => {
      e.preventDefault();
      const { mods, key } = keyFromEvent(e);
      if (!key) return;
      if (!mods.length) { $('#hotkeyHint').textContent = t('hotkeyNeedsModifier'); return; }
      e.target.value = [...mods, key].join('+');
    });
    $('#provider').addEventListener('change', () => { showProviderPanel(); if ($('#provider').value === 'openrouter' && !state.orModels) loadOpenrouterModels(); });
    $('#anthropicAuth').addEventListener('change', showProviderPanel);
    const clearSecret = (field) => async () => { const u = await ws.saveSettings({ [field]: '' }); await refreshMeta(u); toast(t('keyCleared')); };
    $('#btnClearKey').addEventListener('click', clearSecret('apiKey'));
    $('#btnClearOpenrouterKey').addEventListener('click', clearSecret('openrouterKey'));
    $('#btnClearCustomKey').addEventListener('click', clearSecret('customKey'));
    $('#btnAnthropicLogin').addEventListener('click', async () => {
      const r = await ws.anthropicLogin();
      toast(r.launched ? t('loginStarted') : t('cliMissingCmd', { cmd: r.command }));
    });
    $('#btnOpenrouterLogin').addEventListener('click', async () => {
      $('#openrouterKeyStatus').textContent = t('loginWaiting');
      try {
        const u = await ws.openrouterLogin();
        await refreshMeta(u);
        toast(t('loginOk'));
      } catch (e) {
        $('#openrouterKeyStatus').textContent = t('keyFail', { err: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
      }
    });
    $('#btnOpenrouterModels').addEventListener('click', () => loadOpenrouterModels(true));
    $('#openrouterModel').addEventListener('input', updateOpenrouterInfo);
    $('#btnDetect').addEventListener('click', () => loadProviderStatus(true));
    $('#btnUseRecommended').addEventListener('click', () => { if (state.providerStatus) $('#ollamaModel').value = state.providerStatus.recommendation.model; });
    $('#btnPull').addEventListener('click', pullModel);
    $('#btnInstallOllama').addEventListener('click', installOllama);
    $('#btnStartOllama').addEventListener('click', startOllama);
    $('#btnDownloadOllama').addEventListener('click', () => ws.openExternal('https://ollama.com/download'));
    ws.onOllamaInstall(({ line }) => appendLog(line));
    $('#extChip').addEventListener('click', onExtChipClick);
    ws.onExtension((st) => renderExtChip({ ...(state.extStatus || {}), running: true, extension: st }));
    loadExtStatus();
    setInterval(loadExtStatus, 30000);   // the extension heartbeat can go stale while the window is open
    $('#btnSetup').addEventListener('click', runSetup);
    ws.onSetup((st) => {
      if (st.type === 'log') { const box = $('#setupLog'); box.textContent = `${box.textContent}${box.textContent ? '\n' : ''}${st.line}`.split('\n').slice(-300).join('\n'); box.scrollTop = box.scrollHeight; }
      else renderSetup(st);
    });
    if (state.meta.setup) renderSetup(state.meta.setup);
    $('#btnMicRefresh').addEventListener('click', loadMics);
    $('#btnMicTest').addEventListener('click', testMic);
    $('#btnExtHelp').addEventListener('click', () => {
      const box = $('#extHelp');
      box.innerHTML = t('extSteps', { dir: (state.meta.extensionDir || '') });
      box.classList.toggle('hidden');
    });
    $('#btnOpenExt').addEventListener('click', () => ws.openExtensionDir());
    $('#btnExportExt').addEventListener('click', async () => {
      const dir = await ws.exportExtension();
      if (dir) toast(t('extExported', { dir }));
    });
    $('#hwBox').addEventListener('click', (e) => {
      const a = e.target.closest('[data-action="downloadOllama"]');
      if (a) { e.preventDefault(); ws.openExternal('https://ollama.com/download'); }
    });
    $('#btnTestProvider').addEventListener('click', async () => {
      $('#providerTestStatus').textContent = t('testing');
      const r = await ws.testProvider(formOverride());
      $('#providerTestStatus').textContent = r.ok ? t('keyOk', { model: r.model }) : t('keyFail', { err: r.error });
    });
    ws.onOllamaPull((p) => {
      if (!pullingModel || p.model !== pullingModel) return;
      const bar = document.querySelector('#pullProgress .bar i');
      if (bar && p.percent !== undefined) bar.style.width = `${p.percent}%`;
      const label = document.querySelector('#pullProgress span');
      if (label) label.textContent = `${t('pulling', { model: p.model })} ${p.status || ''}${p.percent !== undefined ? ` ${p.percent}%` : ''}`;
    });
    $('#btnChooseDir').addEventListener('click', async () => {
      const dir = await ws.chooseDir();
      if (dir) { $('#workspaceDir').value = dir; $('#workspaceDir').dataset.chosen = dir; }
    });
    $('#btnOpenDir').addEventListener('click', () => ws.openWorkspaceDir());

    ws.onEntry(({ entry, kind }) => {
      if (!entry) return;
      if (kind === 'delete') {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        if (state.selectedId === entry.id) { state.selectedId = null; state.editing = false; }
      } else {
        if (state.query) { const hay = `${entry.title} ${(entry.tags || []).join(' ')} ${entry.text} ${entry.summary}`.toLowerCase(); if (!hay.includes(state.query.toLowerCase()) && !state.entries.some((x) => x.id === entry.id)) return; }
        upsert(entry);
      }
      renderList();
      if (state.selectedId === entry.id && !state.editing) renderDetail();
      else if (!state.selectedId) renderDetail();
    });
    ws.onSummary(() => loadSummaries());
    ws.onSettings((s) => {
      // don't clobber a form the user is editing; the save handler refreshes explicitly
      if (state.tab === 'settings') { state.settings = s; return; }
      refreshMeta(s);
    });
    ws.onNavigate(({ tab, arg }) => {
      if (tab) switchTab(tab);
      if (tab === 'summaries' && arg) { loadSummaries().then(() => showSummary(arg)); }
      if (tab === 'entries' && arg) {
        state.selectedId = arg; state.editing = false;
        loadEntries().then(() => { renderList(); renderDetail(); });
      }
    });
  }

  init().catch((e) => { console.error(e); toast(String(e.message || e)); });
})();
