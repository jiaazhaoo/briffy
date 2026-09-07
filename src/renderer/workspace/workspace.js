'use strict';
(() => {
  const ws = window.ws;
  const $ = (s) => document.querySelector(s);

  const T = {
    zh: {
      tabEntries: '记录', tabAsk: '问', tabSettings: '设置', close: '关闭窗口', newNote: '记一句话', noteHint: '回车保存，Esc 关掉', save: '保存', brandSub: '每天的小记录',
      searchPlaceholder: '搜索标题 / 文字 / 画面内容', quickPlaceholder: '记一句话', allDates: '全部日期',
      askPlaceholder: '问问你的记录',
      askGo: '问', askEmpty: '用一句话问你自己的记录。可以带上时间：昨天、上周、上个月、最近三天。',
      askThinking: '正在翻记录…', askSourcesHead: '依据的记录', askCount: '{n} 条记录', askRange: '{from} 到 {to}',
      near: '相近', related: '相关', graph: '图谱', graphEmpty: '这一条没有够近的记录，画不出图。', topicsHint: '成堆的：', viewTrail: '路过',
      trailOff: '「路过」还没开。它把你在哪个应用、看哪个网页记下来，不用你动手存。去 设置 › 自动采集 打开。',
      trailEmpty: '这一天没有痕迹。', trailMin: '{n} 分', trailShort: '还有 {n} 段更短的',
      trailPages: '{n} 页', trailAll: '看全部', dimType: '类型', dimOrigin: '来源', dimTopic: '主题',
      fAll: '全部', fClear: '清空', fMoreN: '更多 {n}', fLess: '收起', fUnknown: '未知',
      tImage: '图片', tText: '文字', tAudio: '音频', tVideo: '视频', tPdf: 'PDF', tDoc: '文档',
      tSheet: '表格', tSlides: '幻灯片', tArchive: '压缩包', tLink: '链接', tOther: '其它',
      askWhole: '这段时间的全部记录', askRecent: '最近 {n} 条 · 这段时间共 {of} 条', askNoMatch: '没有找到相关的记录。换个说法，或者去「记录」里翻翻。',
      askNoEntries: '工作区里还没有记录，先存点东西进来。',
      askNoProvider: '还没有配置 AI 服务（设置 › AI 服务），所以没人替你读这些。下面是匹配到的记录。',
      askFailed: 'AI 服务出错：{err}。下面仍然是匹配到的记录。',
      srcAll: '全部', srcScreenshot: '截图', srcClipboard: '剪贴板', srcBookmark: '书签', srcBrowser: '网页', srcVoice: '语音', srcOther: '文件 / 链接 / 笔记',
      srcNote: '随手记', srcFile: '文件',
      srcPinned: '收藏', srcMore: '更多…', srcLess: '收起', actMore: '更多…', actLess: '收起',
      dropHere: '松手就存进来', dropped: '存进来 {n} 条', fromApp: '来自', pin: '收藏', unpin: '取消收藏', pinnedMark: '已收藏',
      noteLabel: '我的备注', notePlaceholder: '添加备注', noteSaved: '备注已存',
      copyLink: '复制链接', linkCopied: '链接已复制',
      showBoxes: '文字位置', hideBoxes: '收起文字位置', copyLine: '点一行复制这行文字', lineCopied: '这行已复制',
      dayWasOff: '这一天 briffy 没有运行，所以什么都没能记下。', dayWasIdle: 'briffy 运行了约 {min} 分钟，这一天你没有存下东西。',
      sContext: '记录来源', sContextOn: '保存时记下当时的应用、窗口和网页地址',
      sContextHint: '只在你按下保存的那一刻问一次系统，平时不会盯着你的屏幕。窗口标题需要「辅助功能」权限；网页地址由浏览器扩展提供，关掉这项就不再索取。',
      sContextTest: '看看现在能读到什么',
      sConnect: '接进来', cNotConnected: '没连', cConnect: '连接', cSync: '同步', cSyncing: '同步中…',
      cDisconnect: '断开', cSynced: '已同步 {n} 条', cNever: '还没同步过', cConnecting: '连接中…',
      cNotionToken: 'integration token', cNotionHelp: '在 notion.so/my-integrations 建一个内部集成，再把要同步的页面「连接」给它',
      cImport: '导出文件', cImportPick: '选文件…', cImportDoing: '正在收…',
      cImportHelp: '不用建集成、不用授权：Notion 设置 → 导出全部内容（zip），Gmail → Google Takeout（mbox），选进来就行。同一份导出选两次不会变成两份。',
      cImportDone: '收进 {n} 条（共 {seen} 条）',
      cGmailId: 'client id', cGmailSecret: 'client secret',
      cGmailHelp: '在 Google Cloud 建一个「桌面应用」类型的 OAuth client，开启 Gmail API。点连接会打开浏览器让你同意。',
      cSyncDone: '全部同步完了', cSyncMore: '还有更多，再点一次继续',
      sAutoRecord: '自动录音', sAutoRecordOn: '白名单里的软件用麦克风时，跟着录下来', sAutoRecordState: '状态',
      sAutoRecordAllow: '白名单', sAutoRecordAllowPh: '再加一个…',
      autoAllowEmpty: '空的——不会自动录任何东西', autoAllowDrop: '点一下去掉', autoAllowReset: '恢复默认',
      autoAllowSite: '会议网站', autoBrowsers: '装了的浏览器只在上面这些网站时才算：',
      autoNowUsing: '用过麦克风的（点一下加进白名单）：', autoNowNobody: '这次开机后还没有别的软件用过麦克风',
      autoWaiting: '等着——没有别的软件在用麦克风', autoBecause: '因为 {who} 正在用麦克风',
      sAutoRecordHint: '不是一直听着房间——briffy 平时不碰麦克风，只有当**白名单里的软件打开了麦克风**时才跟着录一段，对方一关，它也关。所以手机上的游戏、屋里的电视不会被录进来。默认名单是会议和通话软件；输入法永远不算，它的语音输入产出的是文字，那些字已经打在你要写的地方了。浏览器按**站点**放行（meet.google.com 这样），不是整个浏览器——否则网页里的语音输入也会被录。名单留空＝除排除的以外都跟着录。常驻只是每 5 秒问一次系统「现在谁在用麦克风」，实测一次 10 毫秒。会录到通话里对方的声音，很多地方这需要对方同意。',
      autoOff: '未开启', autoIdle: '在听（{mic}）', autoSpeech: '正在录…', autoDenied: '没有麦克风权限', autoFailed: '启动失败',
      sDiarizeOn: '区分录音里的不同说话人（首次会下载约 35 MB 模型）', contextNow: '现在：{app}{window}', contextNoTitle: '读不到窗口标题（需要在「系统设置 › 隐私与安全性 › 辅助功能」里勾上 briffy）', contextNone: '这台电脑读不到前台应用',
      selectMode: '选择', selectDone: '完成', selectAll: '全选', selectNone: '取消选择', deleteSelected: '删除所选',
      nSelected: '已选 {n} 项', confirmDeleteMany: '删除选中的 {n} 条记录（及其文件副本）？', deletedN: '已删除 {n} 条',
      dayCount: '{n} 条', jumpTo: '{time} · {title}', today: '今天', yesterday: '昨天',
      viewGrid: '网格', viewList: '列表',
      selectEntry: '选择一条记录查看详情', noEntries: '还没有记录。按快捷键截图、双击 briffy 录音，或把文件拖到briffy身上。',
      generateSummary: '生成该日摘要', noSummary: '还没有摘要。briffy每天早上会自动生成昨天的摘要。', noEntriesThatDay: '这一天没有记录',
      generating: '生成中…', generated: '摘要已生成', summaryItems: '{n} 条记录', bySource: { claude: 'Claude', local: '本地' },
      types: { screenshot: '截图', image: '图片', audio: '语音', pdf: 'PDF', text: '文本', url: '链接', note: '笔记', file: '文件' },
      processing: '处理中', error: '出错', done: '完成',
      seen: '画面内容', summary: '摘要', text: '识别文字', transcript: '转写文字', content: '内容',
      open: '打开原文件', reveal: '在文件夹中显示', openLink: '打开链接', retry: '重新处理', edit: '编辑', delete: '删除', cancel: '取消', copy: '复制', copied: '已复制', copyFailed: '复制失败',
      confirmDelete: '删除这条记录（及其文件副本）？', title: '标题', textField: '文字', duration: '时长',
      sPet: '形象', sPetHint: '来自 ipaslogo.com 的 3448 个免费形象（可免费商用），每个都套上同一个圆框。点一个就换成它。',
      sPetSearch: '搜索（cat、owl、fox……）', sPetReset: '恢复默认', sPetCount: '{n} 个', sPetNone: '没有匹配的形象',
      sPetDefault: '默认形象', petApplying: '下载中…', petApplied: '已换上 ✓', petFailed: '换失败：{err}',
      sTheme: '外观', sThemeLabel: '配色', sThemeHint: '窗口、气泡和常驻头像旁边的列表都会跟着变。',
      sThemeSystem: '跟随系统', sThemeLight: '亮色', sThemeDark: '暗色',
      sLanguages: '语言包', sLanguagesHint: '选择两个语言：用于 OCR 文字识别、语音转文字和界面语言（第一个语言决定界面与摘要语言）。',
      sLang1: '语言 1', sLang2: '语言 2', sShortcut: '截图快捷键', sHotkey: '全局快捷键', sHotkeyPlaceholder: '点击后按下组合键', sHotkeyHint: '点击输入框后按下组合键。修改后立即生效。',
      sSetupRecheck: '重新检查',
      sHotkeyRegion: '框选截图', sHotkeyScreen: '整屏截图', sHotkeyVoice: '录音',
      sCaptureClipboard: '截图同时复制到系统剪贴板（不会因此重复记录一次）',
      sGestureHint: 'briffy 身上：单击 = 整屏截图，双击 = 框选截图，中键点击或长按 = 开始 / 结束录音。',
      captureRegion: '框选截图',
      sClaude: 'Claude（标题 & 每日摘要）', sApiKey: 'API Key', sApiKeyPlaceholder: '留空表示不修改', sTestKey: '测试', sClearKey: '清除', sModel: '模型',
      sClaudeHint: '没有配置时，标题用文件名代替，摘要退化成清单。图片里有什么由本机识别，不经过 AI。', sSpeech: '语音转文字', sSttModel: '模型', sSttLanguage: '语言', sAuto: '在全部 99 种语言里判断', sAutoPacks: '在你选的两种语言之间判断（推荐）',
      sMirror: '镜像', sSpeechHint: '用本地 Whisper。首次录音时会下载模型并缓存到本机，之后完全离线运行。', sSummary: '每日摘要', sSummaryTime: '时间',
      sSummaryHint: '每天到点后（且程序在运行）自动生成昨天的摘要，并弹出通知。', sStorage: '工作区文件夹', sWorkspaceDir: '工作区文件夹', sChoose: '选择…', sOpenDir: '打开',
      sTessPath: 'OCR 语言包地址（可选）', sOcrDropped: '拖入的图片也做 OCR', sPetHidden: '隐藏 briffy（可从托盘菜单恢复）', sSave: '保存设置', sAbout: '状态',
      keySet: '已设置：{hint}', keyNotSet: '未设置', keyOk: '可用 ✓（{model}）', keyFail: '失败：{err}', testing: '测试中…', saved: '已保存', needTwoLanguages: '两个语言不能相同',
      hotkeyNeedsModifier: '需要搭配 Ctrl / Alt / Shift / Cmd', version: '版本', platform: '平台', stats: '{days} 天，共 {entries} 条记录', statsShort: '共 {entries} 条', screenPerm: '屏幕录制权限',
      keyCleared: '已清除 API Key', sameLang: '两个语言不能相同', dirChanged: '工作区已切换（旧文件不会自动搬迁）',
      sOcrSection: '文字识别', sDownloads: '模型下载', sDropped: '拖进来的图片',
      sDroppedHint: '截图一定会做文字识别；拖进来或复制来的图片可以选择要不要。识别不出文字的图片，会由本机分类器说出画面里有什么。',
      sDownloadsHint: '文字识别和语音识别的模型都在第一次用到时下载到本机，之后完全离线。网络不通时可以填一个镜像。',
      gLook: '外观与语言', gPet: '快捷键', gAI: 'AI 服务', gEngines: '本机引擎', gCapture: '自动采集', gAbout: '工作区与关于',
      sAI: 'AI 服务', sProvider: '来源', sProviderOllama: '本地模型 (Ollama)', sProviderCustom: '自定义 OpenAI 兼容接口',
      sAnthropicAuth: '登录方式', sAccountOption: '已登录的 Claude 账号（ant auth login）', sAnthropicLogin: '用浏览器登录 Claude 账号',
      sOpenrouterKey: 'API Key', sOpenrouterLogin: '用 OpenRouter 账号登录', sRefreshModels: '刷新模型列表',
      sOllamaHost: '地址', sDetect: '重新检测', sOllamaModel: '使用的模型', sUseRecommended: '用推荐的', sPull: '下载模型',
      sCustomBase: '接口地址', sCustomKey: 'API Key', sNormalizeZh: '中文语音转写统一为所选的简体 / 繁体（不是翻译）',
      sAIHint: '给标题、每日摘要和问答用。没有配置时，标题用文件名代替，摘要退化成清单。标题和摘要用你的第一语言书写；采集到的原文（识别文字、语音转写）保持原样。',
      configured: '当前使用：{label}', notConfigured: '还没配置，标题先用文件名',
      accountFound: '已检测到登录配置：{profiles}', accountEnv: '已通过环境变量提供凭据', accountNotFound: '未检测到登录，点右侧按钮在终端里完成 ant auth login',
      cliMissing: '未安装 ant 命令行工具（macOS：brew install anthropics/tap/ant；其他平台见 github.com/anthropics/anthropic-cli）',
      cliMissingCmd: '没找到 ant 命令，请先安装，再在终端运行：{cmd}', loginStarted: '已打开终端，按提示在浏览器里登录，完成后回来点「重新检测」',
      loginWaiting: '已打开浏览器，请在页面里完成登录…', loginOk: '登录成功，Key 已保存',
      hwLocal: '本机', hwCores: '{n} 线程', hwNoGpu: '未检测到', hwRecommend: '推荐', hwAlternatives: '备选',
      ollamaRunning: '运行中 {version}', ollamaInstalled: '已安装：{models}', ollamaNoModels: '还没有模型，点「下载模型」',
      sModels: '模型', sOtherModel: '用别的模型（手动填名称）', sState: '状态', sTestRun: '问它一句',
      sOllamaHint: 'Ollama 是在你自己电脑上跑模型的程序。装好并启动之后，briffy 就完全离线工作。',
      sModelsHint: '三档是按这台电脑的内存和显卡算出来的：轻松＝几乎不占资源，勉强＝能加载但会慢。分数来自公开评测榜（ifeval 看它照不照你说的格式答，mmlu-pro 看它知不知道），不是按名字猜的。', fitEasy: '轻松跑', fitOk: '跑得动', fitTight: '勉强，会慢', fitNo: '这台跑不动',
      tierEasy: '轻松', tierEasyWhy: '几乎不占资源，答得最快', tierMedium: '适中', tierMediumWhy: '这台电脑的合适档位', tierStretch: '勉强', tierStretchWhy: '能加载，但会慢',
      mdScored: '评测 {n} 分',
      mdInstalled: '已下载', mdUse: '使用', mdInUse: '正在用', mdGet: '下载', mdDelete: '删除', mdRecommended: '最适合这台电脑', mdVision: '能看图', mdTextOnly: '只读文字', mdLive: '来自 Ollama 官方库，按公开评测榜和这台电脑排序（{n} 个模型有实测分）· 每天更新', mdCached: '离线，用的是上次缓存的列表',
      mdConfirmDelete: '删除 {model}？它占的磁盘空间会释放，需要时可以再下。', resumeTitle: '上次没下完：{model}', resumeGot: '已下 {got} / {total}', resumeGo: '继续下载', resumeDrop: '不下了',
      hwPick: '推荐在这台电脑上用 {model}', hwSize: '下载约 {gb} GB', hwWhy: '为什么是它？还有别的选择', ollamaReady: 'Ollama 已就绪',
      jobInstallStarting: '准备安装…', jobInstallDownloading: '正在下载 Ollama', jobInstallInstalling: '正在安装', jobInstallVerifying: '正在校验', jobInstallDone: '装好了',
      jobPullPreparing: '准备下载 {model}', jobPullDownloading: '正在下载 {model}', jobPullVerifying: '正在校验', jobPullFinishing: '收尾中', jobPullDone: '{model} 已就绪',
      sShowLog: '查看详细日志',
      ollamaNotInstalled: '先装一次 Ollama，模型才能在本机跑起来。约 700 MB，不用注册。',
      ollamaNotStarted: '已安装但没在运行（{binary}），点「启动 Ollama」',
      sInstallOllama: '一键安装 Ollama', sStartOllama: '启动 Ollama', sDownloadOllama: '手动下载',
      installing: '正在安装 Ollama…', installOk: '装好了，接下来选一个模型下载', installFail: '装不上（{err}）。已经帮你打开下载页，手动装一次就行。',
      installManual: '这台电脑没有自动安装器。已打开下载页，装完回来点「重新检测」。',
      starting: '正在启动 Ollama…', startOk: 'Ollama 已启动', startFail: '启动失败：{err}',
      pullNeedsOllama: '需要先安装并启动 Ollama 才能下载模型',
      pulling: '正在下载 {model}…', pullDone: '{model} 下载完成', modelsLoaded: '已加载 {n} 个模型，输入名称可筛选', orVision: '支持图片',
      sSetup: '本机准备情况', sSetupHint: '这些都是自动完成的：检查电脑、准备文字识别和语音识别引擎，全部在本机运行。下面每一项都可以自己改。', sSetupRun: '开始自动配置', sSetupRerun: '重新运行',
      sSetupWithOllama: '顺便装上本地大模型（Ollama + 推荐模型，约 7 GB）', sSetupLog: '查看详细日志',
      setupRunning: '配置中…', setupOk: '配置完成 ✓', setupFail: '配置失败：{err}',
      sOcrIndependent: '文字识别（OCR）用的是 PP-OCR 专用识别引擎，和大模型无关；换 AI 服务不会影响识别结果。',
      sOcrModel: '模型', ocrAuto: '按语言自动选择', bundled: '已内置',
      sMic: '麦克风', sMicRefresh: '刷新', sMicTest: '测试麦克风（说 2 秒）', micDefault: '系统默认', micLoading: '正在读取麦克风列表…',
      micTesting: '录 2 秒，请对着麦克风说话…', micOk: '有声音 ✓（{mic}，峰值 {peak}）', micSilent: '没有声音（{mic}）。这个设备是静音的，换一个再试', micError: '打不开麦克风：{err}',
      micNone: '没找到任何麦克风设备',
      sClipboard: '剪贴板', sClipboardWatch: '实时记录剪贴板（复制的文字、图片、文件都会存入工作区）', sClipboardMin: '最少字数',
      sClipboardHint: '密码管理器复制的内容会自动跳过；从工作区里复制出去的文字不会重复记录。托盘菜单里也能随时开关。', fromClipboard: '📋 剪贴板', fromBrowser: '🧩 网页',
      extOn: '扩展已连接', extOff: '装浏览器扩展', extOffTitle: '点击查看安装步骤：装上后可以一键把网页里的图片和视频存进来',
      extOnTitle: '浏览器扩展 v{version} 已连接，在网页里按 Alt+Shift+D 使用', extApiOff: '扩展接口已关闭', extApiOffTitle: '设置 › 浏览器扩展 里可以重新打开',
      extGuideOpened: '已在浏览器里打开安装步骤',
      sExtension: '浏览器扩展', sExtensionHint: '采集网页里的图片和视频。装上扩展后，在任意网页点扩展图标（或按 Alt+Shift+D），就能看到这一页所有图片、视频、音频，勾选后一键存入工作区。',
      sFfmpeg: '视频下载', sFfmpegInstall: '安装 ffmpeg', sFfmpegRecheck: '重新检查', sFfmpegHint: '网站上的视频通常是切成几百个分片的流（HLS / DASH），画面和声音还常常是两条轨。把它们合成一个能播的文件需要 ffmpeg。它不打包进安装包，也不会去下载来路不明的二进制——只用你系统自己的包管理器安装。',
      ffmpegFound: 'ffmpeg {version} 已就绪（{path}）', ffmpegMissing: '没有找到 ffmpeg —— 分片流可以被发现，但合并不了', ffmpegInstalling: '正在安装…', ffmpegManual: '这台电脑没有可用的包管理器，请手动安装：{url}',
      sLocalApi: '允许浏览器扩展连接（本机接口，仅监听 127.0.0.1）', sLocalApiPort: '端口', sExportExt: '导出扩展文件夹…', sOpenExt: '打开扩展文件夹', sExtHelp: '安装步骤',
      apiRunning: '接口运行中：http://127.0.0.1:{port}{last}', apiStopped: '接口已关闭，扩展无法连接', apiLast: '，最近一次接收：{time}',
      extSteps: '<b>Chrome / Edge 安装步骤</b><br>1. 点「导出扩展文件夹…」把扩展复制到一个你不会删掉的位置（也可以直接用下面这个自带路径）。<br>2. 浏览器地址栏打开 <code>chrome://extensions</code>（Edge 是 <code>edge://extensions</code>）。<br>3. 打开右上角的「开发者模式」。<br>4. 点「加载已解压的扩展程序」，选择那个文件夹。<br>5. 在任意网页点扩展图标，或按 <code>Alt+Shift+D</code>。<br><br>扩展文件夹：<code>{dir}</code><br>如果扩展显示「briffy 未运行」，检查上面的端口是否和扩展设置里的一致。',
      extExported: '扩展已导出到 {dir}',
    },
    en: {
      tabEntries: 'Entries', tabAsk: 'Ask', tabSettings: 'Settings', close: 'Close window', newNote: 'Jot a line', noteHint: 'Enter saves, Esc closes', save: 'Save', brandSub: 'your daily log',
      searchPlaceholder: 'Search title, text, what is in a picture', quickPlaceholder: 'Note to self', allDates: 'All dates',
      askPlaceholder: 'Ask your log',
      askGo: 'Ask', askEmpty: 'Ask your own log a question. Time words work: yesterday, last week, last month, last 5 days.',
      askThinking: 'Going through the log…', askSourcesHead: 'Sources', askCount: '{n} items', askRange: '{from} to {to}',
      near: 'related', related: 'Related', graph: 'Graph', graphEmpty: 'Nothing near enough to draw.', topicsHint: 'Groups:', viewTrail: 'Passed by',
      trailOff: '"Passed by" is off. It notes which app you were in and which page you were reading, without you saving anything. Turn it on in Settings › Capture.',
      trailEmpty: 'Nothing from this day.', trailMin: '{n} min', trailShort: '{n} shorter stretches',
      trailPages: '{n} pages', trailAll: 'Show all', dimType: 'Type', dimOrigin: 'From', dimTopic: 'Topic',
      fAll: 'All', fClear: 'Clear', fMoreN: '{n} more', fLess: 'Less', fUnknown: 'Unknown',
      tImage: 'Pictures', tText: 'Text', tAudio: 'Audio', tVideo: 'Video', tPdf: 'PDF', tDoc: 'Documents',
      tSheet: 'Spreadsheets', tSlides: 'Slides', tArchive: 'Archives', tLink: 'Links', tOther: 'Other',
      askWhole: 'everything from that stretch', askRecent: 'the {n} most recent of {of} in this range', askNoMatch: 'Nothing in the log matches that. Try other words, or browse Entries.',
      askNoEntries: 'The workspace has no entries yet.',
      askNoProvider: 'No AI service configured (Settings › AI service), so nobody read these for you. Here are the matching records.',
      askFailed: 'AI service failed: {err}. The matching records are still below.',
      sFfmpeg: 'Video downloads', sFfmpegInstall: 'Install ffmpeg', sFfmpegRecheck: 'Check again', sFfmpegHint: 'Web video usually arrives as hundreds of stream fragments (HLS / DASH), often with picture and sound on separate tracks. Joining them into one playable file needs ffmpeg. It is not bundled and never fetched from an unknown source: it is installed only through your own system package manager.',
      ffmpegFound: 'ffmpeg {version} ready ({path})', ffmpegMissing: 'ffmpeg not found — segmented streams can be found but not joined', ffmpegInstalling: 'Installing…', ffmpegManual: 'No package manager available here; install it yourself: {url}',
      srcAll: 'All', srcScreenshot: 'Screenshots', srcClipboard: 'Clipboard', srcBookmark: 'Bookmarks', srcBrowser: 'Web', srcVoice: 'Voice', srcOther: 'Files / links / notes',
      srcNote: 'Note', srcFile: 'File',
      srcPinned: 'Favourites', srcMore: 'More…', srcLess: 'Less', actMore: 'More…', actLess: 'Less',
      dropHere: 'Drop to keep it', dropped: '{n} added', fromApp: 'From', pin: 'Favourite', unpin: 'Remove from favourites', pinnedMark: 'Favourite',
      noteLabel: 'My note', notePlaceholder: 'Add a note', noteSaved: 'Note saved',
      copyLink: 'Copy link', linkCopied: 'Link copied',
      showBoxes: 'Text regions', hideBoxes: 'Hide text regions', copyLine: 'Click a line to copy it', lineCopied: 'Line copied',
      dayWasOff: 'briffy was not running on this day, so nothing could be saved.', dayWasIdle: 'briffy ran for about {min} minutes; you saved nothing on this day.',
      sContext: 'Where it came from', sContextOn: 'Record the app, window and page address at the moment of a save',
      sContextHint: 'Asked once, at the instant you save something -- briffy never watches your screen. The window title needs Accessibility permission; the page address comes from the browser extension, and turning this off stops asking for both.',
      sContextTest: 'See what it can read now',
      sConnect: 'Bring in', cNotConnected: 'not connected', cConnect: 'Connect', cSync: 'Sync', cSyncing: 'syncing…',
      cDisconnect: 'Disconnect', cSynced: '{n} brought in', cNever: 'never synced', cConnecting: 'connecting…',
      cNotionToken: 'integration token', cNotionHelp: 'Make an internal integration at notion.so/my-integrations, then connect the pages you want to it',
      cImport: 'Export file', cImportPick: 'Choose…', cImportDoing: 'Reading…',
      cImportHelp: 'No integration, no sign-in: Notion Settings → Export all content (zip), Gmail → Google Takeout (mbox). Pick it here. Choosing the same export twice will not duplicate anything.',
      cImportDone: 'Took in {n} of {seen}',
      cGmailId: 'client id', cGmailSecret: 'client secret',
      cGmailHelp: 'Make a Desktop app OAuth client in Google Cloud and enable the Gmail API. Connect opens your browser to approve it.',
      cSyncDone: 'all caught up', cSyncMore: 'more to come — press again',
      sAutoRecord: 'Automatic recording', sAutoRecordOn: 'Record along when an app on the list uses the microphone', sAutoRecordState: 'State',
      sAutoRecordAllow: 'Only these', sAutoRecordAllowPh: 'add one…',
      autoAllowEmpty: 'empty — nothing will be recorded automatically', autoAllowDrop: 'click to remove', autoAllowReset: 'restore the default',
      autoAllowSite: 'meeting site', autoBrowsers: 'the browsers you have count only while on those sites:',
      autoNowUsing: 'have used the microphone (click to add):', autoNowNobody: 'nothing else has used the microphone since briffy started',
      autoWaiting: 'Waiting — nothing else is using the microphone', autoBecause: 'because {who} is using the microphone',
      sAutoRecordHint: 'Not an open microphone on the room: briffy does not touch the mic until **an app on the list opens it**, records alongside it, and lets go when that app does. A game on your phone or a TV in the room will not be recorded. The list starts as meeting and call apps. An input method never counts — what its voice input produces is text, already typed where you wanted it. Browsers are allowed by **site** (meet.google.com), not as a whole, or voice typing on any web page would be recorded too. An empty list means: follow anything not excluded. All it runs is a 10 ms question to the system every 5 seconds: who is using the microphone. It will capture the other side of a call, which in many places needs their consent.',
      autoOff: 'off', autoIdle: 'listening ({mic})', autoSpeech: 'recording…', autoDenied: 'no microphone permission', autoFailed: 'could not start',
      sDiarizeOn: 'Tell the speakers in a recording apart (fetches about 35 MB the first time)', contextNow: 'Right now: {app}{window}', contextNoTitle: 'Cannot read the window title (tick briffy under System Settings > Privacy & Security > Accessibility)', contextNone: 'This machine cannot report the front app',
      selectMode: 'Select', selectDone: 'Done', selectAll: 'Select all', selectNone: 'Clear', deleteSelected: 'Delete selected',
      nSelected: '{n} selected', confirmDeleteMany: 'Delete the {n} selected entries (and their stored copies)?', deletedN: 'Deleted {n}',
      dayCount: '{n} records', jumpTo: '{time} · {title}', today: 'Today', yesterday: 'Yesterday',
      viewGrid: 'Grid', viewList: 'List',
      selectEntry: 'Select an entry to see details', noEntries: 'Nothing yet. Press the shortcut to capture, double-click briffy to record, or drop files on it.',
      generateSummary: 'Generate summary for this day', noSummary: 'No summaries yet. briffy writes one for yesterday every morning.', noEntriesThatDay: 'No entries on that day',
      generating: 'Generating…', generated: 'Summary generated', summaryItems: '{n} items', bySource: { claude: 'Claude', local: 'local' },
      types: { screenshot: 'Screenshot', image: 'Image', audio: 'Voice', pdf: 'PDF', text: 'Text', url: 'Link', note: 'Note', file: 'File' },
      processing: 'Processing', error: 'Error', done: 'Done',
      seen: 'In the picture', summary: 'Summary', text: 'Recognized text', transcript: 'Transcript', content: 'Content',
      open: 'Open file', reveal: 'Show in folder', openLink: 'Open link', retry: 'Reprocess', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', copy: 'Copy', copied: 'Copied', copyFailed: 'Could not copy',
      confirmDelete: 'Delete this entry (and its stored copy)?', title: 'Title', textField: 'Text', duration: 'Duration',
      sPet: 'Its face', sPetHint: '3448 free characters from ipaslogo.com (free for commercial use), each in the same round frame. Click one to wear it.',
      sPetSearch: 'Search (cat, owl, fox…)', sPetReset: 'Back to default', sPetCount: '{n} found', sPetNone: 'Nothing matches',
      sPetDefault: 'Default character', petApplying: 'Downloading…', petApplied: 'Applied ✓', petFailed: 'Could not apply: {err}',
      sTheme: 'Appearance', sThemeLabel: 'Colours', sThemeHint: 'The windows, the balloon and the shelf beside the pet all follow.',
      sThemeSystem: 'Follow system', sThemeLight: 'Light', sThemeDark: 'Dark',
      sLanguages: 'Language packs', sLanguagesHint: 'Pick two languages for OCR, speech-to-text and the UI (the first one drives the UI and summary language).',
      sLang1: 'Language 1', sLang2: 'Language 2', sShortcut: 'Capture shortcut', sHotkey: 'Global shortcut', sHotkeyPlaceholder: 'Click, then press keys', sHotkeyHint: 'Click a box and press a key combination. Applied immediately.',
      sSetupRecheck: 'Check again',
      sHotkeyRegion: 'Capture a region', sHotkeyScreen: 'Capture the whole screen', sHotkeyVoice: 'Recording',
      sCaptureClipboard: 'Also copy captures to the system clipboard (this does not record them twice)',
      sGestureHint: 'On the pet: one click = whole screen, two clicks = drag a box, middle click or long press = start / stop recording.',
      captureRegion: 'Capture a region',
      sClaude: 'Claude (titles & daily summary)', sApiKey: 'API Key', sApiKeyPlaceholder: 'Leave empty to keep the current key', sTestKey: 'Test', sClearKey: 'Clear', sModel: 'Model',
      sClaudeHint: 'Without a provider the title falls back to the file name and the summary to a plain list. What is in a picture is recognised on this machine, never by AI.', sSpeech: 'Speech to text', sSttModel: 'Model', sSttLanguage: 'Language', sAuto: 'Decide among all 99 languages', sAutoPacks: 'Decide between your two languages (recommended)',
      sMirror: 'Mirror', sSpeechHint: 'Local Whisper. The model downloads on the first recording and is cached; after that it runs fully offline.', sSummary: 'Daily summary', sSummaryTime: 'Time',
      sSummaryHint: 'After this time (while the app runs) yesterday\'s summary is generated and a notification is shown.', sStorage: 'Workspace folder', sWorkspaceDir: 'Workspace folder', sChoose: 'Choose…', sOpenDir: 'Open',
      sTessPath: 'OCR language data URL (optional)', sOcrDropped: 'Also OCR dropped images', sPetHidden: 'Hide briffy (restore from the tray menu)', sSave: 'Save settings', sAbout: 'Status',
      keySet: 'Set: {hint}', keyNotSet: 'Not set', keyOk: 'Working ✓ ({model})', keyFail: 'Failed: {err}', testing: 'Testing…', saved: 'Saved', needTwoLanguages: 'The two languages must differ',
      hotkeyNeedsModifier: 'Needs Ctrl / Alt / Shift / Cmd', version: 'Version', platform: 'Platform', stats: '{days} days, {entries} entries', statsShort: '{entries} in all', screenPerm: 'Screen recording permission',
      keyCleared: 'API key cleared', sameLang: 'The two languages must differ', dirChanged: 'Workspace switched (old files are not moved automatically)',
      sOcrSection: 'Text recognition', sDownloads: 'Model downloads', sDropped: 'Pictures you drop in',
      sDroppedHint: 'Screenshots are always read for text; pictures you drop or copy in are up to you. A picture with no text is described by the classifier on this machine instead.',
      sDownloadsHint: 'The text and speech models download on first use and run offline afterwards. Fill in a mirror if the download cannot reach it.',
      gLook: 'Look & language', gPet: 'Shortcuts', gAI: 'AI service', gEngines: 'On-device engines', gCapture: 'What gets recorded', gAbout: 'Workspace & about',
      sAI: 'AI service', sProvider: 'Provider', sProviderOllama: 'Local model (Ollama)', sProviderCustom: 'Custom OpenAI-compatible endpoint',
      sAnthropicAuth: 'Sign in with', sAccountOption: 'Signed-in Claude account (ant auth login)', sAnthropicLogin: 'Sign in to Claude in the browser',
      sOpenrouterKey: 'API Key', sOpenrouterLogin: 'Sign in with OpenRouter', sRefreshModels: 'Refresh model list',
      sOllamaHost: 'Address', sDetect: 'Detect again', sOllamaModel: 'Model to use', sUseRecommended: 'Use recommended', sPull: 'Download model',
      sCustomBase: 'Base URL', sCustomKey: 'API Key', sNormalizeZh: 'Normalise Chinese transcripts to the selected Simplified / Traditional script (not a translation)',
      sAIHint: 'Used for titles, the daily summary and questions. Without one, titles fall back to file names and the summary becomes a plain list. Titles and summaries are written in your first language; captured text (OCR, transcripts) stays as it is.',
      configured: 'In use: {label}', notConfigured: 'Not configured yet – titles fall back to the file name',
      accountFound: 'Sign-in profile found: {profiles}', accountEnv: 'Credentials provided via environment variables', accountNotFound: 'Not signed in – click the button to run ant auth login in a terminal',
      cliMissing: 'The ant CLI is not installed (macOS: brew install anthropics/tap/ant; other platforms: github.com/anthropics/anthropic-cli)',
      cliMissingCmd: 'ant CLI not found – install it, then run in a terminal: {cmd}', loginStarted: 'A terminal was opened – finish the browser sign-in, then click "Detect again"',
      loginWaiting: 'Browser opened – finish signing in there…', loginOk: 'Signed in, key saved',
      hwLocal: 'This machine', hwCores: '{n} threads', hwNoGpu: 'none detected', hwRecommend: 'Recommendation', hwAlternatives: 'Alternatives',
      ollamaRunning: 'running {version}', ollamaInstalled: 'installed: {models}', ollamaNoModels: 'no models yet – click "Download model"',
      sModels: 'Models', sOtherModel: 'Use a different model (type its name)', sState: 'Status', sTestRun: 'Ask it something',
      sOllamaHint: 'Ollama is the program that runs models on your own machine. Once it is installed and running, briffy works entirely offline.',
      sModelsHint: 'The three shelves are cut for this machine\u2019s memory and graphics: comfortable means it barely uses the machine, a stretch means it loads but will be slow. Scores come from public leaderboards (ifeval for following the shape you asked for, mmlu-pro for knowing things), not guessed from the name.', fitEasy: 'runs easily', fitOk: 'runs fine', fitTight: 'tight, will be slow', fitNo: 'too big for this machine',
      tierEasy: 'Comfortable', tierEasyWhy: 'barely uses the machine, answers fastest', tierMedium: 'Balanced', tierMediumWhy: 'the right trade for this machine', tierStretch: 'A stretch', tierStretchWhy: 'it loads, but it will be slow',
      mdScored: 'scored {n}',
      mdInstalled: 'downloaded', mdUse: 'Use', mdInUse: 'in use', mdGet: 'Download', mdDelete: 'Delete', mdRecommended: 'best fit for this machine', mdVision: 'reads images', mdTextOnly: 'text only', mdLive: "From Ollama's library, ranked by public benchmarks and this machine ({n} scored) · refreshed daily", mdCached: 'Offline — showing the last cached list',
      mdConfirmDelete: 'Delete {model}? The disk space comes back and you can download it again later.', resumeTitle: 'Not finished last time: {model}', resumeGot: '{got} of {total} downloaded', resumeGo: 'Resume', resumeDrop: 'Forget it',
      hwPick: 'Recommended for this machine: {model}', hwSize: 'about {gb} GB to download', hwWhy: 'Why this one, and what else there is', ollamaReady: 'Ollama is ready',
      jobInstallStarting: 'Getting ready…', jobInstallDownloading: 'Downloading Ollama', jobInstallInstalling: 'Installing', jobInstallVerifying: 'Verifying', jobInstallDone: 'Installed',
      jobPullPreparing: 'Getting ready to download {model}', jobPullDownloading: 'Downloading {model}', jobPullVerifying: 'Verifying', jobPullFinishing: 'Finishing up', jobPullDone: '{model} is ready',
      sShowLog: 'Show details',
      ollamaNotInstalled: 'Install Ollama once and models run on this machine. About 700 MB, no account.',
      ollamaNotStarted: 'Installed but not running ({binary}) – click "Start Ollama"',
      sInstallOllama: 'Install Ollama', sStartOllama: 'Start Ollama', sDownloadOllama: 'Download manually',
      installing: 'Installing Ollama…', installOk: 'Installed. Now pick a model to download.', installFail: 'Could not install it ({err}). The download page is open — install it by hand.',
      installManual: 'No installer available here. The download page is open; come back and click "Check again".',
      starting: 'Starting Ollama…', startOk: 'Ollama started', startFail: 'Could not start it: {err}',
      pullNeedsOllama: 'Install and start Ollama before downloading a model',
      pulling: 'Downloading {model}…', pullDone: '{model} downloaded', modelsLoaded: '{n} models loaded – type to filter', orVision: 'understands images',
      sSetup: 'What is ready on this computer', sSetupHint: 'All of this happens automatically: checking the machine and preparing the local text- and speech-recognition engines. Everything below can still be changed.', sSetupRun: 'Run setup', sSetupRerun: 'Run again',
      sSetupWithOllama: 'Also install a local language model (Ollama + recommended model, about 7 GB)', sSetupLog: 'Show detailed log',
      setupRunning: 'Setting up…', setupOk: 'Setup complete ✓', setupFail: 'Setup failed: {err}',
      sOcrIndependent: 'Text recognition (OCR) uses the dedicated PP-OCR engine and never involves a language model; changing the AI service does not affect it.',
      sOcrModel: 'Model', ocrAuto: 'Choose automatically from the languages', bundled: 'bundled',
      sMic: 'Microphone', sMicRefresh: 'Refresh', sMicTest: 'Test microphone (speak for 2 s)', micDefault: 'System default', micLoading: 'Reading microphone list…',
      micTesting: 'Recording 2 seconds – please speak…', micOk: 'Sound detected ✓ ({mic}, peak {peak})', micSilent: 'No sound ({mic}). This device is silent – try another one', micError: 'Cannot open microphone: {err}',
      micNone: 'No microphone devices found',
      sClipboard: 'Clipboard', sClipboardWatch: 'Record the clipboard live (copied text, pictures and files go into the workspace)', sClipboardMin: 'Min. characters',
      sClipboardHint: 'Content copied from password managers is skipped; text copied out of the workspace itself is not recorded twice. The tray menu has the same switch.', fromClipboard: '📋 clipboard', fromBrowser: '🧩 web page',
      extOn: 'Extension connected', extOff: 'Install the extension', extOffTitle: 'Click for the installation steps – then you can send images and videos from any page here',
      extOnTitle: 'Browser extension v{version} connected – press Alt+Shift+D on any page', extApiOff: 'Extension endpoint off', extApiOffTitle: 'Turn it back on in Settings › Browser extension',
      extGuideOpened: 'Opened the installation steps in your browser',
      sExtension: 'Browser extension', sExtensionHint: 'Collect pictures and video from web pages. With the extension installed, click its icon on any page (or press Alt+Shift+D) to see every image, video and audio file there and save the ones you tick.',
      sLocalApi: 'Allow the browser extension to connect (local endpoint, 127.0.0.1 only)', sLocalApiPort: 'Port', sExportExt: 'Export extension folder…', sOpenExt: 'Open extension folder', sExtHelp: 'Installation steps',
      apiRunning: 'Endpoint running: http://127.0.0.1:{port}{last}', apiStopped: 'Endpoint off – the extension cannot connect', apiLast: ', last received {time}',
      extSteps: '<b>Chrome / Edge</b><br>1. Click "Export extension folder…" to copy the extension somewhere permanent (or use the bundled path below).<br>2. Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>).<br>3. Turn on "Developer mode".<br>4. Click "Load unpacked" and choose that folder.<br>5. Click the extension icon on any page, or press <code>Alt+Shift+D</code>.<br><br>Extension folder: <code>{dir}</code><br>If the extension says briffy is not running, check that the port above matches the one in the extension settings.',
      extExported: 'Extension exported to {dir}',
    },
  };
  const ICONS = { screenshot: '📸', image: '🖼️', audio: '🎙️', pdf: '📄', text: '📝', url: '🔗', note: '🗒️', file: '📎' };

  const state = {
    meta: null, settings: null, ui: 'zh', entries: [], dates: [], selectedId: null, editing: false,
    query: '', date: '', source: '', pinned: false, pinnedCount: 0, counts: null, chat: [], tab: 'entries',
    topics: [],
    // 三个维度叠着筛：类型（是什么）、来源（从哪儿来）、主题（关于什么）。dim 是当前展开的那一个。
    f: { type: '', origin: '', topic: '' }, dim: 'type', dimOpen: false,
    selecting: false, picked: new Set(),
    view: 'grid',
    boxesOn: false, boxes: null,      // the OCR line boxes of the record currently open
    ask: { question: '', result: null, busy: false }, ffmpeg: null,
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
  const fmtShortDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
  };
  const fmtDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  };
  const todayKey = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayLabel = (key) => (key === todayKey() ? t('today') : key === todayKey(-1) ? t('yesterday') : fmtDate(key));

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function applyI18n() {
    document.documentElement.lang = state.ui === 'zh' ? 'zh-Hans' : 'en';   // the CJK faces pick their glyph forms from this
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  }

  // ---------- tabs ----------
  function switchTab(tab) {
    if (!['entries', 'ask', 'settings'].includes(tab)) tab = 'entries';   // 每日摘要没了，别的入口落回记录
    state.tab = tab;
    // the margin carries the tools for the entries page only; the css hides them elsewhere
    document.body.dataset.tab = tab;
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === `tab-${tab}`);
    // 进「问」这一页要把已有的对话画出来。以前只 focus 不渲染，第一次进去就是一整片空白——
    // 而输入框那只托盘当时也被 CSS 藏着，于是那一页既没有内容也没有地方打字。
    if (tab === 'ask') { renderAsk(); setTimeout(() => $('#askInput').focus(), 0); }
    // 接入的状态会自己变（同步在跑、token 过期），所以每次打开设置都重新问一次，
    // 而不是沿用启动时那一份。populateSettings 只在启动和保存后跑。
    if (tab === 'settings') renderConnect();
    if (tab === 'entries' && state.view === 'grid' && jgWidth !== gridWidth()) scheduleGrid();
  }


  // ---------- 接进来：Notion / Gmail ----------
  //
  // 凭据只往一个方向走：输入框 -> 主进程 -> safeStorage。这里从来不读它们，connectList() 回来的
  // 只有状态，所以这一页上任何时候都不会有一份 token 的副本。
  const CONNECT_FIELDS = {
    notion: [{ key: 'token', label: 'cNotionToken', type: 'password' }],
    gmail: [{ key: 'clientId', label: 'cGmailId', type: 'text' }, { key: 'clientSecret', label: 'cGmailSecret', type: 'password' }],
  };
  let connectBusy = '';

  async function renderConnect() {
    const box = $('#connectList');
    if (!box) return;
    let list = [];
    try { list = await ws.connectList(); } catch (_) { list = []; }
    box.textContent = '';
    for (const svc of list) box.appendChild(connectRow(svc));
    box.appendChild(importRow());
  }

  /**
   * 第三行：导出文件。
   *
   * Notion 和 Gmail 都要凭据，而且都躲不掉——Gmail 读邮件是受限权限，自带的 client 会让每个人
   * 卡在警告页上；Notion 的公开集成必须带 client secret。导出文件一样都不需要，代价是它是一次
   * 快照而不是持续同步。走的是同一套去重，所以选两次不会变成两份。
   */
  function importRow() {
    const row = document.createElement('div');
    row.className = 'f';
    const left = document.createElement('span');
    left.className = 'fl'; left.textContent = t('cImport');
    const fc = document.createElement('span');
    fc.className = 'fc';
    row.append(left, fc);

    const state = document.createElement('span');
    state.className = 'st';

    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'btn'; pick.textContent = t('cImportPick');
    pick.disabled = !!connectBusy;
    pick.addEventListener('click', async () => {
      connectBusy = 'import';
      pick.disabled = true; pick.textContent = t('cImportDoing');
      // 一份 Takeout 可能是几万封信，跑几分钟。不报数的话按钮看着就是卡住了。
      const off = ws.onConnectProgress((p) => {
        if (!p || p.service !== 'import' || !p.more) return;
        state.textContent = t('cImportDone', { n: p.added, seen: p.seen });
      });
      let r;
      try { r = await ws.importPick(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      off();
      connectBusy = '';
      pick.disabled = false; pick.textContent = t('cImportPick');
      if (!r || r.cancelled) return;
      if (!r.ok) { note(fc, r.error, true); return; }
      state.textContent = t('cImportDone', { n: r.added, seen: r.seen });
      loadEntries();                            // 收进来的东西现在就该出现在记录页
    });

    fc.append(pick, state);
    note(fc, t('cImportHelp'), false);
    return row;
  }

  function connectRow(svc) {
    const row = document.createElement('div');
    row.className = 'f';
    const left = document.createElement('span');
    left.className = 'fl';
    left.textContent = svc.label;
    const fc = document.createElement('span');
    fc.className = 'fc';
    row.append(left, fc);

    if (!svc.connected) {
      const inputs = {};
      for (const f of (CONNECT_FIELDS[svc.name] || [])) {
        const i = document.createElement('input');
        i.type = f.type; i.placeholder = t(f.label); i.className = 'wide';
        i.autocomplete = 'off'; i.spellcheck = false;
        inputs[f.key] = i;
        fc.appendChild(i);
      }
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn'; go.textContent = t('cConnect');
      go.addEventListener('click', async () => {
        const creds = {};
        for (const [k, i] of Object.entries(inputs)) creds[k] = i.value.trim();
        go.disabled = true; go.textContent = t('cConnecting');
        const r = await ws.connectSet(svc.name, creds);
        for (const i of Object.values(inputs)) i.value = '';      // 存进去了就不在页面上留副本
        if (!r.ok) { go.disabled = false; go.textContent = t('cConnect'); note(fc, r.error, true); return; }
        renderConnect();
      });
      fc.appendChild(go);
      note(fc, t(svc.name === 'gmail' ? 'cGmailHelp' : 'cNotionHelp'), false);
      return row;
    }

    const state = document.createElement('span');
    state.className = 'st';
    state.textContent = [svc.account, svc.count ? t('cSynced', { n: svc.count }) : t('cNever'),
      svc.lastAt ? fmtTime(svc.lastAt) : '', svc.done ? t('cSyncDone') : ''].filter(Boolean).join(' · ');

    const sync = document.createElement('button');
    sync.type = 'button'; sync.className = 'btn';
    sync.textContent = connectBusy === svc.name ? t('cSyncing') : t('cSync');
    sync.disabled = !!connectBusy;
    sync.addEventListener('click', async () => {
      connectBusy = svc.name;
      sync.disabled = true; sync.textContent = t('cSyncing');
      const r = await ws.connectSync(svc.name, {});
      connectBusy = '';
      if (r && !r.ok) note(fc, r.error, true);
      renderConnect();
    });

    const drop = document.createElement('button');
    // 房里已经有这套按钮的词汇，别自己再造一套：.btn 是印在纸上能按的地方，.danger 是印泥色的删除
    drop.type = 'button'; drop.className = 'btn danger'; drop.textContent = t('cDisconnect');
    drop.addEventListener('click', async () => { await ws.connectDrop(svc.name); renderConnect(); });

    fc.append(sync, drop, state);
    if (svc.error) note(fc, svc.error, true);
    return row;
  }

  function note(fc, text, bad) {
    if (!text) return;
    const n = document.createElement('span');
    n.className = `st${bad ? ' warn' : ''}`;
    n.textContent = text;
    fc.appendChild(n);
  }

  // ---------- pet picker ----------
  // The whole free ipaslogo.com library, every one of them in the same round frame the
  // pet wears. Only ids, names and background colours cross IPC (~250 KB); the pictures
  // load lazily from the CDN and the grid grows as it is scrolled, so opening the tab is
  // instant even at 3448 entries. Picking one downloads that single original into userData.
  // 形象图库删了（2026-09-06）：常驻形象现在自己画自己（briffy-anim.js 的 body: 'full'），
  // 从 3448 个 logo 里挑一个不会有任何变化——一块点了没反应的界面比没有这块更糟。
  function setAvatarEverywhere(url) { if (url) $('#brandAvatar').src = url; }

  // ---------- entries ----------
  async function loadEntries() {
    await loadTopics();
    state.dates = await ws.listDates();
    // 主题是一份 id 清单，所以它和另外两个维度是「取交集」，不是「取代」——
    // 「那场挑战里的图片」要求两个条件同时成立。
    let ids = null;
    if (state.f.topic) { try { ids = (await ws.topicEntries(state.f.topic)).map((e) => e.id); } catch (_) { ids = []; } }
    // 「全部」里不含剪贴板：它一天到晚自己往里掉，一屏九成是剪贴板就不叫「全部」了。
    // 但这条只管**没筛没搜**的那一屏——你点了一个主题、一个类型，或者打了字去搜，
    // 那就是你明确要的东西，这条规矩不该盖过它。实测踩过：「泰晤士河步道超级马拉松挑战赛」
    // 那个主题下面五条记录全是剪贴板存的，点进去一条都看不见。
    const asked = state.query || state.f.type || state.f.origin || state.f.topic;
    state.entries = await ws.listEntries({
      query: state.query,
      dates: state.date ? [state.date] : null,
      type: state.f.type,
      origin: state.f.origin,
      ids,
      exclude: asked ? null : ['clipboard'],
    });
    ws.stats().then((st) => { state.counts = st; state.pinnedCount = st.pinned || 0; renderDims(); }).catch(() => {});
    renderDateFilter();
    renderDims();
    renderList();
    renderAxis();
    if (state.selectedId && !state.entries.some((e) => e.id === state.selectedId)) closeDetail();
    addNear();
  }

  // 「意思相近」——搜「跑步」出得来那场 walking 挑战，搜「屏幕」出得来那条讲 296 PPI 的笔记。
  //
  // 它们**不含**你打的那几个字，所以每一条都标着「相近」，不和精确命中混在一起假装是同一回事。
  // 一个搜索框安静地返回一堆不含关键词的东西，看起来就是搜坏了。
  //
  // 慢一拍是故意的：精确匹配先出来（本地字符串，立刻），相近的随后补上。中间要把问题算成向量，
  // 模型冷的时候第一次要几百毫秒。seq 挡住过期的回应——打字很快时前一次的结果不该覆盖后一次。
  let nearSeq = 0;
  async function addNear() {
    const my = ++nearSeq;
    const q = state.query;
    // 一个汉字就是一个完整的词，别按字符数一刀切（和 ask.js 里 near() 那条同一个道理）
    if (!q || (q.trim().length < 2 && !/[぀-ヿ㐀-䶿一-鿿가-힯]/u.test(q))) return;
    let more = [];
    try { more = await ws.searchNear(q, state.entries.map((e) => e.id)); } catch (_) { more = []; }
    if (my !== nearSeq || q !== state.query || !more.length) return;
    for (const e of more) e.near = true;
    state.entries = [...state.entries, ...more]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    renderList();
    renderAxis();
  }

  // ---------- 筛选：三个维度，叠着用 ----------
  //
  // 三个维度回答三个不同的问题，混在一行里就说不清了：
  //   类型  这是什么   —— 图片 / 文本 / 网页 / 录音
  //   来源  从哪儿来   —— 小红书 / 哔哩哔哩 / Claude / Terminal，实在不知道就退回它是怎么进来的
  //   主题  关于什么   —— 自动归堆的结果（topic.js）
  //
  // 它们是**叠**的：「小红书上的图片」这种要求只有叠起来才成立。所以上面那行同时也是
  // 「现在叠了哪几个」，右端一个「清空」——三个能同时按的东西，不写出来就会丢失「现在在看什么」。
  // 下面只展开一个维度的值：三行值会把顶栏撑高一整行记录的高度。
  // 类型按**格式**分（store.js 的 entryFormat）：截图和网页存下来的图都是图片，随手记和邮件都是文字。
  // 「怎么进来的」是「来源」那一档的事，两件事混在一格里就都说不清。
  const TYPE_LABEL = { image: 'tImage', text: 'tText', audio: 'tAudio', video: 'tVideo', pdf: 'tPdf',
    doc: 'tDoc', sheet: 'tSheet', slides: 'tSlides', archive: 'tArchive', link: 'tLink', other: 'tOther' };
  // 来源里那几个不是站点也不是应用的值，是「实在不知道从哪儿来」时退回的采集方式
  // 「来源」里只有真的来源：站点和应用。不知道就写「未知」，不拿「剪贴板」「截图」去糊——
  // 那是「怎么进来的」，拿它当「从哪儿来的」是循环的，而且会变成这一格里最大的一块。
  const ORIGIN_LABEL = { '?': 'fUnknown' };
  const DIMS = [['type', 'dimType'], ['origin', 'dimOrigin'], ['topic', 'dimTopic']];
  const originName = (k) => (ORIGIN_LABEL[k] ? t(ORIGIN_LABEL[k]) : k);
  const topicLabel = (id) => { const x = (state.topics || []).find((z) => z.id === id); return x ? (x.name || x.words) : id; };
  // 认不出来的类型用它自己的名字，不要都翻成「其它」——两个不同的值顶着同一个标签，
  // 界面上就成了两个一模一样的词，点哪个都说不清。
  const valueName = (dim, k) => (dim === 'type' ? (TYPE_LABEL[k] ? t(TYPE_LABEL[k]) : k) : dim === 'origin' ? originName(k) : topicLabel(k));

  /** 当前维度有哪些值可选，大的在前。@returns {[string, number][]} */
  function valuesOf(dim) {
    const c = state.counts || {};
    if (dim === 'type') return Object.entries(c.byType || {}).sort((a, b) => b[1] - a[1]);
    if (dim === 'origin') return Object.entries(c.byOrigin || {}).sort((a, b) => b[1] - a[1]);
    return (state.topics || []).filter((x) => x.name || x.words).map((x) => [x.id, x.n]);
  }

  function renderDims() {
    const box = $('#dims');
    if (!box) return;
    const any = DIMS.some(([k]) => state.f[k]);
    box.innerHTML = DIMS.map(([k, label]) => {
      const on = state.f[k];
      return `<button type="button" class="src-chip dim${state.dim === k ? ' open' : ''}${on ? ' active' : ''}" data-dim="${k}">`
        + `${esc(t(label))}${on ? `<span class="n">${esc(String(valueName(k, on)).slice(0, 14))}</span>` : ''}</button>`;
    }).join('')
      + (any ? `<button type="button" class="src-chip clear" data-clear="1">${esc(t('fClear'))}</button>` : '');
    renderValues();
  }

  let moreValues = false;
  function renderValues() {
    const box = $('#sources');
    if (!box) return;
    const dim = state.dim;
    const all = valuesOf(dim);
    const shown = moreValues ? all : all.slice(0, 8);
    box.innerHTML = `<button type="button" class="src-chip${state.f[dim] ? '' : ' active'}" data-val="">${esc(t('fAll'))}</button>`
      + shown.map(([k, n]) => `<button type="button" class="src-chip${state.f[dim] === k ? ' active' : ''}${n ? '' : ' zero'}" data-val="${esc(k)}">`
        + `${esc(String(valueName(dim, k)).slice(0, 18))}<span class="n">${n}</span></button>`).join('')
      + (all.length > shown.length ? `<button type="button" class="src-chip more" data-more="1">${esc(t('fMoreN', { n: all.length - shown.length }))}</button>`
        : (moreValues && all.length > 8 ? `<button type="button" class="src-chip more" data-more="1">${esc(t('fLess'))}</button>` : ''));
  }

  async function loadTopics() {
    if (state.topics.length) return;
    try { state.topics = await ws.topics(); } catch (_) { state.topics = []; }
  }

  // 左边的时间轴：一天一行，相对日 + 条数。日期抬头已经不显示了，所以哪一天只由它说。
  // 点一行跳过去；滚动时哪一天正压在视野顶上，哪一行就加粗。
  function renderAxis() {
    const byDay = new Map();
    for (const e of state.entries) byDay.set(e.dateKey, (byDay.get(e.dateKey) || 0) + 1);
    const days = state.dates.filter((d) => byDay.has(d));
    $('#axis').innerHTML = days.map((d) => `<button type="button" class="ax" data-day="${esc(d)}">`
      + `<span>${esc(relDay(d))}</span><span class="n">${byDay.get(d)}</span></button>`).join('');
    markAxis();
  }
  function relDay(dateKey) {
    if (dateKey === todayKey()) return t('today');
    if (dateKey === todayKey(-1)) return t('yesterday');
    const [, m, d] = dateKey.split('-');
    return `${+m}/${+d}`;   // 轴只有 60px 宽，日期得短
  }
  // 轴对的是"当前正在滚的那一张纸"。写死 #jgScroll 的时候，切到列表它就是死的：
  // 高亮不动、点一天也跳不过去，因为它找的锚点在一个 hidden 的容器里。
  function dayScroller() {
    return state.view === 'list'
      ? { box: $('#lvRows'), sel: '.lv-day' }
      : { box: $('#jgScroll'), sel: '.jg-day' };
  }
  function markAxis() {
    const { box, sel } = dayScroller();
    if (!box) return;
    let now = '';
    for (const el of box.querySelectorAll(sel)) {
      if (el.offsetTop - box.scrollTop <= 40) now = el.dataset.day; else break;
    }
    if (!now) now = box.querySelector(sel)?.dataset.day || '';
    for (const b of document.querySelectorAll('.ax')) b.classList.toggle('now', b.dataset.day === now);
  }
  function jumpToDay(dateKey) {
    const { box, sel } = dayScroller();
    const el = box && box.querySelector(`${sel}[data-day="${dateKey}"]`);
    if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - 14), behavior: 'smooth' });
  }

  function renderDateFilter() {
    const sel = $('#dateFilter');
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(t('allDates'))}</option>` + state.dates.map((d) => `<option value="${d}">${esc(fmtDate(d))}</option>`).join('');
    sel.value = state.dates.includes(cur) ? cur : '';
  }

  function statusPill(e) {
    // 搜出来的「意思相近」要标出来。用现成的 .pill——房里已经有「一个词」这个说法了，别再造一个
    if (e.near) return `<span class="pill near">${esc(t('near'))}</span>`;
    if (e.status === 'processing') return `<span class="pill processing">${esc(t('processing'))}${e.progress ? ` · ${esc(e.progress)}` : ''}</span>`;
    if (e.status === 'error') return `<span class="pill error">${esc(t('error'))}</span>`;
    // "local words" used to mark the entries a model had not seen; now that is every entry, so it says nothing
    return '';
  }

  // ---------- the grid: equal-height rows ----------
  // The layout photo libraries settled on (Google Photos, Immich, Flickr) and that Eagle makes its
  // default for design assets: every row the same height, every picture at its own proportions, read
  // left to right and then down -- so a row is also a stretch of time, which a waterfall of columns
  // filling independently could never promise. Days are sections with a sticky heading, the hours
  // inside them are labelled, and the rail down the right edge is the whole scroll in miniature.
  const ROW_TARGET = 150;                       // px; the height a row is aimed at before it is justified
  const ROW_GAP = 8;
  const TEXT_RATIO = { note: 2, text: 2, url: 2, audio: 2, pdf: 1.6, file: 1.6, video: 1.8, media: 1.8 };
  // 一条记录长成哪种纸。
  // **剪贴板排在图片前面**：从剪贴板来的东西就该长成撕下来的那一片纸，是图也一样——
  // 一屏里「哪些是我复制来的」比「哪些有画面」更要紧，而拍立得会把它伪装成一张截图。
  function cardKind(e) {
    if (e.source === 'clipboard') return 'clip';
    if (isPicture(e)) return 'shot';
    if (e.type === 'audio') return 'voice';
    if (e.source === 'bookmark') return 'mark';
    if (e.type === 'note' || e.type === 'text') return 'note';
    return 'file';
  }
  // 形状是宽高比：一条磁带 / 一张索引卡 / 一张正方形便利贴 / 一片撕下来的纸。
  // 每种再分大中小——**一条记录该占多大，取决于它有多少东西可看**，不是取决于它是哪一类。
  // 一段 7 秒的录音和一段 5 分钟的录音占同样大的地方，是上一版最刺眼的毛病。
  // 瀑布流是等高行，同一行里高度是共享的，所以「大小」落在**宽度**上：小的窄，大的宽。
  const SIZE_RATIO = {
    voice: { s: 1.5, m: 2.4, l: 3.4 },
    note:  { s: 0.85, m: 1.15, l: 1.6 },
    clip:  { s: 0.9, m: 1.2, l: 1.6 },
    mark:  { s: 1.3, m: 1.8, l: 2.4 },
    file:  { s: 1.3, m: 1.6, l: 2 },
  };
  // 有多少东西可看：录音看时长，别的看字数。图片不参与——它的形状是它自己的，不该被我们改。
  function cardSize(e) {
    const kind = cardKind(e);
    if (kind === 'voice') { const s = Number(e.durationSec) || 0; return s < 20 ? 's' : s < 120 ? 'm' : 'l'; }
    // 量的必须是**卡片上看得见的那些字**。收藏卡只显示标题和域名，拿它藏起来的整页摘录去算大小，
    // 就会得到一张又宽又空的卡——这是上一版那两张大白卡的来源。
    const shown = kind === 'mark' ? cardTitle(e) : (cardText(e) || cardTitle(e));
    const n = String(shown || '').trim().length;
    if (kind === 'mark') return n < 18 ? 's' : n < 44 ? 'm' : 'l';
    return n < 40 ? 's' : n < 160 ? 'm' : 'l';
  }
  const SOURCE_LABEL = { screenshot: 'srcScreenshot', clipboard: 'srcClipboard', bookmark: 'srcBookmark', browser: 'srcBrowser', voice: 'srcVoice', other: 'srcOther' };
  // 「其它」这一组在筛选器上是一个词，在一行上得说清楚到底是哪一件
  const OTHER_LABEL = { note: 'srcNote', file: 'srcFile' };
  const ratioCache = new Map();                 // learned from the <img> when a record carries no size
  let jgIds = '';                               // the order the grid was last dealt for
  let jgWidth = 0;                              // and the width
  let jgTimer = null;

  const clipText = (str, n) => (str.length > n ? `${str.slice(0, n).trimEnd()}…` : str);
  // The app (and window) that was in front when this was saved -- see src/main/foreground.js. Old
  // records have none, and neither do the ones saved from briffy itself, so everything below is optional.
  const ctxOf = (e) => (e && e.context && e.context.app ? e.context : null);
  function ctxShort(e) {
    const c = ctxOf(e);
    return c ? c.app : '';
  }
  function ctxHost(e) {
    const c = ctxOf(e);
    if (!c || !c.url) return '';
    try { return new URL(c.url).host; } catch (_) { return c.url; }
  }
  function ctxLong(e) {
    const c = ctxOf(e);
    if (!c) return '';
    return c.window ? `${c.app} · ${c.window}` : c.app;
  }
  const cardText = (e) => String(e.text || e.summary || '').trim();
  const isPicture = (e) => (e.type === 'screenshot' || e.type === 'image') && !!e.fileUrl;
  const emptyMarkup = (extra = '') => `<div class="empty"><div class="empty-art">🐱</div><span>${esc(extra || t('noEntries'))}</span></div>`;

  // "Nothing here" used to mean two opposite things: nothing was worth keeping, or briffy was closed
  // and the day was never offered. It knows which now (src/main/uptime.js), so it says which.
  async function emptyReason() {
    if (!state.date || state.query || state.f.type || state.f.origin || state.f.topic) return '';
    try {
      const st = await ws.dayStats(state.date);
      if (st.status === 'off') return t('dayWasOff');
      if (st.status === 'idle') return t('dayWasIdle', { min: st.uptimeMinutes });
    } catch (_) { /* an older workspace has no record of this */ }
    return '';
  }
  function fillEmptyReason(box) {
    emptyReason().then((why) => {
      if (!why) return;
      const span = box.querySelector('.empty span');
      if (span) span.textContent = why;
    });
  }

  // A note's stored title is its first line cut to length. Older records were cut at a fixed
  // character, which could land mid-word ("你看看蛛丝" | "马迹"); shown, the title runs on to the next
  // natural break so the heading and the body underneath it meet cleanly.
  function cardTitle(e) {
    const raw = e.title || e.path || e.url || '';
    const text = String(e.text || '');
    if (!raw || raw.endsWith('…') || !text.startsWith(raw) || text.length === raw.length) return raw;
    const rest = text.slice(raw.length);
    if (/^[\s\p{P}]/u.test(rest)) return raw;
    const m = /^[^\s\p{P}]{1,20}/u.exec(rest);
    return m ? `${raw}${m[0]}` : raw;
  }

  // Only what the title has not already said -- for a one-line note, nothing at all.
  function cardExcerpt(e) {
    const text = cardText(e);
    const title = String(cardTitle(e)).trim().replace(/…$/, '');
    if (!title || !text.startsWith(title)) return text;
    return text.slice(title.length).replace(/^[\s\u3000·、，。：:,.-]+/, '');
  }

  // The shape of the box a record gets. A picture keeps its own, within limits -- a very tall one
  // would otherwise shrink to a sliver, a very wide one swallow a row. Words get a fixed 3:2 card.
  function tileRatio(e) {
    if (!isPicture(e)) return (SIZE_RATIO[cardKind(e)] || SIZE_RATIO.file)[cardSize(e)];
    const w = Number(e.width) || 0, h = Number(e.height) || 0;
    const r = w && h ? w / h : (ratioCache.get(e.id) || 4 / 3);
    return Math.min(Math.max(r, 0.55), 2.4);
  }

  // Flickr's justified layout: fill a row until the boxes at the target height overflow the width,
  // then scale that row so the widths sum exactly to it. The last row keeps the target height unless
  // it is nearly full, so a lone final picture is not blown up to the width of the page.
  function justify(items, width, target = ROW_TARGET, gap = ROW_GAP) {
    const rows = [];
    let row = [];
    const widthAt = (r, h) => r.reduce((a, it) => a + tileRatio(it) * h, 0) + gap * (r.length - 1);
    const fit = (r) => (width - gap * (r.length - 1)) / r.reduce((a, x) => a + tileRatio(x), 0);
    for (const it of items) {
      row.push(it);
      if (widthAt(row, target) >= width) { rows.push({ items: row, h: Math.min(fit(row), target * 1.3) }); row = []; }
    }
    if (row.length) rows.push({ items: row, h: widthAt(row, target) / width >= 0.7 ? fit(row) : target });
    return rows;
  }

  function tileMarkup(e) {
    const kind = cardKind(e);
    const time = esc(fmtTime(e.createdAt));
    const mark = `${e.pinned ? '<span class="jg-pin"></span>' : ''}${statusPill(e)}`;

    // 截图 / 图片 —— 一张拍立得：白边包着画面，底边更宽，时间写在那道宽边上
    if (kind === 'shot') {
      return `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />`
        + `<span class="cap">${time}</span>${mark}`;
    }
    // 录音 —— 一条磁带：没有标题，底边一整条是磁粉，转写只留一行压在时间后面
    if (kind === 'voice') {
      const said = clipText(cardText(e) || cardTitle(e), 400);
      return `<div class="lab"><span class="tm">${time}</span></div>`
        + `<div class="said">${esc(said)}</div><div class="tape"></div>`
        + `<span class="dur">${esc(fmtDuration(e.durationSec))}</span>${mark}`;
    }
    // 收藏 —— 一张索引卡：一个粗标题领着，域名跟在下面，左上垂一条书签舌
    if (kind === 'mark') {
      let host = '';
      if (e.url) { try { host = new URL(e.url).host; } catch (_) { host = ''; } }
      return `<span class="ribbon"></span><div class="lab"><span class="tm">${time}</span></div>`
        + `<div class="ttl">${esc(cardTitle(e))}</div>${host ? `<div class="host">${esc(host)}</div>` : ''}${mark}`;
    }
    // 随手记 —— 一张便利贴：你的话在最上面，字更大；时间退到最下角；右下角折起
    if (kind === 'note') {
      return `<div class="said">${esc(clipText(cardText(e) || cardTitle(e), 400))}</div>`
        + `<div class="lab"><span class="tm">${time}</span></div><span class="fold"></span>${mark}`;
    }
    // 剪贴板 —— 一片撕下来的纸：原文加引号，底下写从哪个应用来
    if (kind === 'clip') {
      const where = ctxShort(e);
      // 复制来的要是一张图，那就把图嵌在这片纸里——纸边留着，时间和来源还写在纸上
      const body = isPicture(e)
        ? `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />`
        : `<div class="b"><div class="bb">${esc(clipText(cardText(e) || cardTitle(e), 300))}</div></div>`;
      return body
        + `<div class="lab"><span class="tm">${time}</span></div>`
        + `${where ? `<div class="from">${esc(t('fromApp'))} ${esc(where)}</div>` : ''}${mark}`;
    }
    // 别的（文件、网页里拿来的东西）：还是那张白便签
    const more = cardExcerpt(e);
    let host = '';
    if (e.url) { try { host = new URL(e.url).host; } catch (_) { host = ''; } }
    const body = `<b>${esc(cardTitle(e))}</b>${host ? `\n<span class="host">${esc(host)}</span>` : ''}`
      + `${more ? `\n${esc(clipText(more, 300))}` : (!host && (e.path || e.url) ? `\n<span class="host">${esc(e.path || e.url)}</span>` : '')}`;
    return `<div class="jg-txt"><div class="k"><span>${time}</span>${mark}</div>`
      + `<div class="b"><div class="bb">${body}</div></div></div>`;
  }
  const fmtDuration = (s) => {
    const n = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(n / 60)}\u2032${String(n % 60).padStart(2, '0')}\u2033`;
  };

  function tileEl(e) {
    const el = document.createElement('div');
    el.className = `jg-tile k-${cardKind(e)} z-${cardSize(e)}${state.picked.has(e.id) ? ' picked' : ''}`;
    el.dataset.id = e.id;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML = `<span class="jg-check"></span>${tileMarkup(e)}`;
    return el;
  }

  // A record that arrived without its size (a dropped file, a picture pulled from a page) reports it
  // once its picture has loaded, and the grid is dealt again to match.
  function learnRatio(img) {
    const tile = img.closest('.jg-tile');
    if (!tile || !img.naturalWidth || !img.naturalHeight) return;
    const e = state.entries.find((x) => x.id === tile.dataset.id);
    if (!e || (Number(e.width) && Number(e.height))) return;
    const r = img.naturalWidth / img.naturalHeight;
    if (ratioCache.get(e.id) === r) return;
    ratioCache.set(e.id, r);
    scheduleGrid();
  }

  // 网格的宽度就是滚动区的内容盒——问它自己要，别把页边写死两遍
  const gridWidth = () => { const s = $('#jgScroll'), cs = getComputedStyle(s);
    return Math.max(120, s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); };
  const hourKey = (iso) => String(new Date(iso).getHours()).padStart(2, '0');
  const HOURS_FROM = 12;     // a day with fewer records than this is one block, no hour labels
  const HOUR_MIN = 3;        // an hour with fewer records than this is folded into the next one

  // Split one day's records (newest first) into labelled groups by hour, folding thin hours together.
  function hourGroups(items) {
    if (items.length < HOURS_FROM) return [{ items, label: '', first: hourKey(items[0].createdAt) }];
    const byHour = [];
    for (const e of items) {
      const hk = hourKey(e.createdAt);
      const last = byHour[byHour.length - 1];
      if (last && last.hk === hk) last.items.push(e); else byHour.push({ hk, items: [e] });
    }
    const groups = [];
    let acc = null;
    for (const h of byHour) {
      if (!acc) acc = { newest: h.hk, oldest: h.hk, items: [...h.items] };
      else { acc.oldest = h.hk; acc.items.push(...h.items); }
      if (acc.items.length >= HOUR_MIN) { groups.push(acc); acc = null; }
    }
    if (acc) { if (groups.length) { const g = groups[groups.length - 1]; g.oldest = acc.oldest; g.items.push(...acc.items); } else groups.push(acc); }
    return groups.map((g) => ({ items: g.items, first: g.newest, label: g.newest === g.oldest ? `${g.newest}:00` : `${g.oldest}:00–${g.newest}:59` }));
  }
  const shortDay = (key) => { const l = dayLabel(key); return l === fmtDate(key) ? fmtShortDate(key) : l; };

  function layoutGrid() {
    const scroller = $('#jgScroll');
    const width = gridWidth();
    const keep = scroller.scrollTop;
    // newest first, as the store lists them; a day is a section, and inside it the records are
    // grouped by hour -- but only where that earns its keep. A quiet day of nine records would become
    // nine labelled rows of one tile each, so a day with fewer than a dozen records is one block, and
    // an hour with only a couple of records is folded into the next until the group has a few.
    const days = new Map();
    for (const e of state.entries) {
      if (!days.has(e.dateKey)) days.set(e.dateKey, []);
      days.get(e.dateKey).push(e);
    }
    const frag = document.createDocumentFragment();
    for (const [day, all] of days) {
      const head = document.createElement('div');
      head.className = 'jg-day';
      head.dataset.day = day;
      // 日期由左边的时间轴去说。这个空块只是锚点（时间轴跳转和高亮都认它）和一天与一天之间的留白
      head.setAttribute('aria-label', fmtDate(day));
      frag.appendChild(head);
      for (const group of hourGroups(all)) {
        if (group.label) {
          const lab = document.createElement('div');
          lab.className = 'jg-hour';
          lab.dataset.hour = `${day}T${group.first}`;
          lab.innerHTML = `<b>${esc(group.label)}</b>${esc(t('dayCount', { n: group.items.length }))}`;
          frag.appendChild(lab);
        }
        const items = group.items;
        const block = document.createElement('div');
        block.className = 'jg-rows';
        let top = 0;
        for (const row of justify(items, width)) {
          let left = 0;
          for (const e of row.items) {
            const w = tileRatio(e) * row.h;
            const tile = tileEl(e);
            // --lines: how many 18px lines of the slip are left for words -- the row height less the slip's
            // padding (14+15), its label row (19) and its tag row (17+8). See .jg-txt in the css.
            tile.style.cssText = `left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${w.toFixed(1)}px;height:${row.h.toFixed(1)}px;--lines:${Math.max(1, Math.floor((row.h - 78) / 18))};--nlines:${Math.max(1, Math.floor((row.h - 62) / 26))};--clines:${Math.max(1, Math.floor((row.h - 74) / 21))}`;
            block.appendChild(tile);
            left += w + ROW_GAP;
          }
          top += row.h + ROW_GAP;
        }
        block.style.height = `${Math.max(0, top - ROW_GAP)}px`;
        frag.appendChild(block);
      }
    }
    scroller.innerHTML = '';
    scroller.appendChild(frag);
    scroller.scrollTop = keep;
    jgWidth = width;
  }

  function scheduleGrid() {
    clearTimeout(jgTimer);
    jgTimer = setTimeout(() => { if (state.view === 'grid' && state.tab === 'entries') { jgIds = ''; renderList(); } }, 120);
  }

  // The same records, only changed: repaint what changed where it stands. A record being processed
  // sends a stream of these, and dealing the whole grid on each would blink every picture.
  function refreshTiles() {
    const scroller = $('#jgScroll');
    for (const e of state.entries) {
      const el = scroller.querySelector(`.jg-tile[data-id="${e.id}"]`);
      if (!el) continue;
      el.classList.toggle('picked', state.picked.has(e.id));
      if (isPicture(e)) {                       // keep the <img>; swap only the status badge
        for (const p of el.querySelectorAll(':scope > .pill')) p.remove();
        const pill = statusPill(e);
        if (pill) el.insertAdjacentHTML('beforeend', pill);
      } else {
        const html = `<span class="jg-check"></span>${tileMarkup(e)}`;
        if (el.dataset.sig !== html) { el.innerHTML = html; el.dataset.sig = html; }
      }
    }
  }

  // ---------- the list ----------
  // Raindrop's headlines, a mail client's message list: one record a row with the time in its own
  // column, and the chosen one previewed beside it. The densest view, and the one for tidying up.
  function rowMarkup(e) {
    const thumb = isPicture(e) ? `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />` : (ICONS[e.type] || ICONS.file);
    const where = ctxShort(e);
    // 「文件 / 链接 / 笔记」是筛选器上那一组的名字，一行只是一件东西，不能拿一组的名字当它的来源
    const src = where || t(e.source === 'other' ? (OTHER_LABEL[cardKind(e)] || 'srcFile') : (SOURCE_LABEL[e.source] || 'srcFile'));
    return `<span class="ck"></span><span class="tm">${esc(fmtTime(e.createdAt))}</span><span class="th">${thumb}</span>`
      + `<span class="ti">${e.pinned ? '<span class="row-pin"></span>' : ''}${esc(cardTitle(e))}</span>`
      + `<span class="src">${esc(src)}${e.near ? ` · ${esc(t('near'))}` : ''}</span>`;
  }

  function renderListView() {
    const box = $('#lvRows');
    const keep = box.scrollTop;
    $('#entryList').classList.toggle('selecting', state.selecting);
    if (!state.entries.length) { box.innerHTML = emptyMarkup(); fillEmptyReason(box); renderDetailInto($('#listDetail')); return; }
    if (!state.selectedId || !state.entries.some((e) => e.id === state.selectedId)) state.selectedId = state.entries[0].id;
    let html = '';
    let day = '';
    for (const e of state.entries) {
      if (e.dateKey !== day) {
        day = e.dateKey;
        // 只是锚点和一天与一天之间的留白，不写字——日期由右边的时间轴说（和网格同一条规矩）
        html += `<div class="lv-day" data-day="${esc(day)}" aria-label="${esc(fmtDate(day))}"></div>`;
      }
      html += `<div class="lv-row${e.id === state.selectedId ? ' sel' : ''}${state.picked.has(e.id) ? ' picked' : ''}" data-id="${e.id}" role="button" tabindex="0">${rowMarkup(e)}</div>`;
    }
    box.innerHTML = html;
    box.scrollTop = keep;
    renderDetailInto($('#listDetail'));
  }

  function renderList() {
    if (state.view === 'list') { jgIds = ''; renderListView(); return; }   // the grid is dealt again when it returns
    const grid = $('#entryGrid');
    const scroller = $('#jgScroll');
    grid.classList.toggle('selecting', state.selecting);
    if (!state.entries.length) { scroller.innerHTML = emptyMarkup(); fillEmptyReason(scroller); jgIds = ''; return; }
    const ids = state.entries.map((e) => e.id).join(',');
    if (ids === jgIds && jgWidth === gridWidth() && scroller.querySelector('.jg-tile')) { refreshTiles(); return; }
    jgIds = ids;
    layoutGrid();
  }

  // ---------- 路过：同一天的另一种看法 ----------
  //
  // 一段一行：时间 · 时长 · 应用 · 窗口标题。点开才展那一段里读过的网页正文——
  // 默认全展开的话，一天会变成很长的一页，而这一页的用处是「一眼看完这一天」。
  //
  // 短的折起来：实测一天原始 9,952 次前台变化归并成 746 段，其中够三分钟的只有 71 段。
  // 剩下那些是切出去看一眼又回来，摊开来只会把真正待过的那几段淹掉。
  const SHORT_S = 180;
  let trailOpen = new Set();
  let trailAll = false;

  async function renderTrail() {
    const box = $('#tvRows');
    if (!box) return;
    if (!state.settings || state.settings.recordTrail !== true) {
      box.innerHTML = `<div class="tv-note">${esc(t('trailOff'))}</div>`;
      return;
    }
    const day = state.date || todayKey();
    let all = [];
    try { all = await ws.trailSessions(day); } catch (_) { all = []; }
    if (!all.length) { box.innerHTML = `<div class="tv-note">${esc(t('trailEmpty'))}</div>`; return; }
    const shown = trailAll ? all : all.filter((b) => b.secs >= SHORT_S);
    const hidden = all.length - shown.length;
    box.innerHTML = shown.map((b, i) => {
      const key = b.from;
      const open = trailOpen.has(key);
      const mins = Math.max(1, Math.round(b.secs / 60));
      const title = b.window && b.window !== b.app ? b.window : '';
      return `<div class="tv-row${open ? ' open' : ''}" data-key="${esc(key)}" role="button" tabindex="0">`
        + `<span class="tm">${esc(fmtTime(b.from))}–${esc(fmtTime(b.to))}</span>`
        + `<span class="dur">${esc(t('trailMin', { n: mins }))}</span>`
        + `<span class="app">${esc(b.app)}</span>`
        + `<span class="ti">${esc(title)}</span>`
        + `${b.pages.length ? `<span class="np">${esc(t('trailPages', { n: b.pages.length }))}</span>` : ''}`
        + `</div>`
        + (open && b.pages.length
          ? `<div class="tv-pages">${b.pages.map((p) => `<div class="tv-page"><div class="ti">${esc(p.title || p.url)}</div>`
            + `<div class="bb">${esc(String(p.text || '').slice(0, 600))}</div></div>`).join('')}</div>`
          : '');
    }).join('')
      + (hidden > 0 ? `<button type="button" class="tv-more" data-trail-all="1">${esc(t('trailShort', { n: hidden }))} · ${esc(t('trailAll'))}</button>` : '');
  }

  function applyView(view) {
    state.view = ['list', 'trail'].includes(view) ? view : 'grid';
    try { localStorage.setItem('briffy.view', state.view); } catch (_) { /* storage unavailable */ }
    $('#entryGrid').hidden = state.view !== 'grid';
    $('#entryList').hidden = state.view !== 'list';
    $('#entryTrail').hidden = state.view !== 'trail';
    if (state.view === 'trail') renderTrail();
    for (const b of document.querySelectorAll('#viewSeg button')) b.classList.toggle('active', b.dataset.view === state.view);
    if (state.view === 'grid') jgIds = '';          // dealt while hidden, if at all: deal it again at its real width
    renderList();
    markAxis();                                    // 轴跟的是当前这张纸，换了纸就得重新看一眼
    if (state.view === 'list') renderDetail();
  }

  // ---------- picking several at once ----------
  function renderBulk() {
    const bar = $('#bulkBar');
    bar.hidden = !state.selecting;
    $('#bulkCount').textContent = t('nSelected', { n: state.picked.size });
    bar.querySelector('[data-bulk="delete"]').disabled = state.picked.size === 0;
  }

  // 选中一整天。additive：接着已有的选择加，否则只留这一天
  function pickDay(dateKey, additive) {
    if (!state.selecting) setSelecting(true);
    if (!additive) state.picked.clear();
    for (const e of state.entries) if (e.dateKey === dateKey) state.picked.add(e.id);
    renderBulk();
    renderList();
  }

  // 拉框选：在空白处按下往外拖，框到哪些便签就选哪些。
  // 框本身用 fixed 定位，这样它和便签都在同一套视口坐标里，滚动、缩放都不用换算。
  let marqueeMoved = false;
  function startMarquee(down, scroller, itemSel) {
    marqueeMoved = false;
    const bounds = scroller.getBoundingClientRect();
    const x0 = down.clientX, y0 = down.clientY;
    const top0 = scroller.scrollTop;
    const additive = down.metaKey || down.ctrlKey || down.shiftKey;
    const before = additive ? new Set(state.picked) : new Set();
    let box = null;
    let moved = false;
    let last = down;

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const draw = () => {
      // 起点是钉在纸上的，不是钉在屏幕上的：纸滚过多少，起点就跟着走多少
      const ax = x0, ay = y0 - (scroller.scrollTop - top0);
      const x1 = clamp(last.clientX, bounds.left, bounds.right);
      const y1 = clamp(last.clientY, bounds.top, bounds.bottom);
      const r = { left: Math.min(ax, x1), top: Math.min(ay, y1), right: Math.max(ax, x1), bottom: Math.max(ay, y1) };
      if (!moved && (r.right - r.left > 5 || r.bottom - r.top > 5)) {
        moved = true; marqueeMoved = true;
        if (!state.selecting) setSelecting(true);
        box = document.createElement('div');
        box.className = 'marquee';
        document.body.appendChild(box);
      }
      if (!moved) return;
      const top = clamp(r.top, bounds.top, bounds.bottom);
      const bottom = clamp(r.bottom, bounds.top, bounds.bottom);
      box.style.cssText = `left:${r.left}px;top:${top}px;width:${r.right - r.left}px;height:${bottom - top}px`;
      state.picked = new Set(before);
      for (const tile of scroller.querySelectorAll(itemSel)) {
        const t = tile.getBoundingClientRect();
        const hit = t.right > r.left && t.left < r.right && t.bottom > r.top && t.top < r.bottom;
        if (hit) state.picked.add(tile.dataset.id);
        tile.classList.toggle('picked', state.picked.has(tile.dataset.id));
      }
      renderBulk();
    };
    const paint = (ev) => { last = ev; draw(); };

    // 拖到上下边缘就接着往下滚：一屏装不下的时候，正常的做法是纸自己走，
    // 而不是让人松手、滚一段、再重新框一次
    const EDGE = 28;
    const timer = setInterval(() => {
      if (!moved) return;
      const y = last.clientY;
      let d = 0;
      if (y < bounds.top + EDGE) d = -Math.ceil((bounds.top + EDGE - y) / 2);
      else if (y > bounds.bottom - EDGE) d = Math.ceil((y - (bounds.bottom - EDGE)) / 2);
      if (!d) return;
      const at = scroller.scrollTop;
      scroller.scrollTop = clamp(at + clamp(d, -40, 40), 0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop !== at) draw();
    }, 16);

    const up = () => {
      clearInterval(timer);
      window.removeEventListener('pointermove', paint);
      window.removeEventListener('pointerup', up);
      if (box) box.remove();
      if (moved) renderList();
      setTimeout(() => { marqueeMoved = false; }, 0);   // 让紧随其后的那次 click 看得到它
    };
    window.addEventListener('pointermove', paint);
    window.addEventListener('pointerup', up);
  }

  function setSelecting(on) {
    state.selecting = on;
    if (!on) state.picked.clear();
    document.body.classList.toggle('picking', on);   // 批量条顶掉左、中两只托盘
    const btn = $('#selectToggle');
    btn.classList.toggle('on', on);
    // 它现在是个图标按钮：只换提示语，别往里写字——写了会把 SVG 冲掉
    btn.dataset.i18nTitle = on ? 'selectDone' : 'selectMode';
    btn.title = t(btn.dataset.i18nTitle);
    renderBulk();
    renderList();
  }

  function currentEntry() { return state.entries.find((e) => e.id === state.selectedId) || null; }

  // The grid wants the whole width, so a record opens in a window over it. The list has a preview
  // pane beside it, and the same rendering goes there.
  function openDetail(id) {
    state.selectedId = id;
    state.editing = false;
    $('#detailModal').hidden = false;
    renderDetail();
    renderList();
  }

  function closeDetail() {
    if ($('#detailModal').hidden) return;
    $('#detailModal').hidden = true;
    state.editing = false;
    if (state.view === 'grid') state.selectedId = null;   // the list keeps its row
    renderList();
    if (state.view === 'list') renderDetail();
  }

  const detailBox = () => (!$('#detailModal').hidden ? $('#detail') : $('#listDetail'));
  function renderDetail() { renderDetailInto(detailBox()); }

  // ---------- 图谱：一条记录周围两跳 ----------
  //
  // 布局是**算出来的，不是模拟出来的**：节点少（实测中位 4 张、最多 10 张），一圈一圈摆开就够，
  // 而力导向那种要跑物理、每帧重画、位置还每次都不一样——同一条记录两次打开长得不该不一样。
  // 中心在正中，一跳一圈，二跳外面一圈，各自贴着自己的来处。
  function graphSvg(g, centreId) {
    const W = 680; const H = 420; const cx = W / 2; const cy = H / 2;
    // 半径要让最外一圈也留在画布里：cy - r2 * SQUASH 得大于上下的余量，否则节点会跑出去。
    const R1 = 130; const R2 = 218; const SQUASH = 0.66;
    const pos = new Map([[centreId, [cx, cy]]]);
    const ang = new Map([[centreId, -Math.PI / 2]]);
    const put = (id, a, r) => {
      pos.set(id, [cx + Math.cos(a) * r, cy + Math.sin(a) * r * SQUASH]);
      ang.set(id, a);
    };
    // 一跳：绕中心一圈匀开，从正上方起
    const one = g.nodes.filter((n) => n.hop === 1);
    one.forEach((n, i) => put(n.id, -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(1, one.length), R1));
    // 二跳：贴着把它带进来的那一个，在它的角度上下散开
    const two = g.nodes.filter((n) => n.hop === 2);
    const parentOf = (id) => {
      for (const [a, b] of g.edges) {
        if (a === id && ang.has(b) && b !== centreId) return b;
        if (b === id && ang.has(a) && a !== centreId) return a;
      }
      return one[0] ? one[0].id : centreId;
    };
    const grouped = new Map();
    for (const n of two) {
      const k = parentOf(n.id);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(n);
    }
    for (const [parent, list] of grouped) {
      const base = ang.get(parent) ?? -Math.PI / 2;
      list.forEach((n, i) => put(n.id, base + (i - (list.length - 1) / 2) * 0.42, R2));
    }

    const at = (id) => pos.get(id) || [cx, cy];
    const edges = g.edges.filter(([a, b]) => pos.has(a) && pos.has(b))
      .map(([a, b]) => `<line class="gr-edge" x1="${at(a)[0].toFixed(1)}" y1="${at(a)[1].toFixed(1)}" x2="${at(b)[0].toFixed(1)}" y2="${at(b)[1].toFixed(1)}" />`).join('');
    // 节点最后画，压在线上面：线从方块中心出发，不遮住字
    const nodes = g.nodes.map((n) => {
      const [x, y] = at(n.id);
      const label = String(cardTitle(n) || '').slice(0, 14);
      const w = Math.max(58, label.length * 9 + 18);
      return `<g class="gr-node h${n.hop}" data-rel="${esc(n.id)}" transform="translate(${(x - w / 2).toFixed(1)},${(y - 12).toFixed(1)})">`
        + `<rect width="${w}" height="24" /><text x="${(w / 2).toFixed(1)}" y="16" text-anchor="middle">${esc(label)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${edges}${nodes}</svg>`;
  }

  async function openGraph(id) {
    // 图谱和详情是同一条记录的两种看法，不该同时开着——两层弹窗叠起来谁也读不清。
    const dm = $('#detailModal');
    if (dm) dm.hidden = true;
    const e = state.entries.find((x) => x.id === id) || currentEntry();
    $('#graphTitle').textContent = t('graph');
    $('#graphBody').innerHTML = '';
    $('#graphModal').hidden = false;
    let g = { nodes: [], edges: [] };
    try { g = await ws.graph(id); } catch (_) { g = { nodes: [], edges: [] }; }
    const centre = g.nodes.find((n) => n.hop === 0);
    $('#graphTitle').textContent = centre ? cardTitle(centre) : (e ? cardTitle(e) : t('graph'));
    $('#graphBody').innerHTML = g.nodes.length > 1
      ? graphSvg(g, id)
      : `<div class="gr-note">${esc(t('graphEmpty'))}</div>`;
  }

  // 打开一条记录时当场算它的邻居，不存图——存下来只会多一个会过期的东西。
  // seq 挡住过期的回应：翻得快时前一条的邻居不该落在后一条底下。
  let relSeq = 0;
  async function fillRelated(id, box) {
    const my = ++relSeq;
    let list = [];
    try { list = await ws.related(id); } catch (_) { list = []; }
    if (my !== relSeq || !list.length) return;
    const slot = box.querySelector('.dt-related');
    if (!slot) return;
    slot.hidden = false;
    slot.innerHTML = `<h3>${esc(t('related'))}</h3>`
      + list.map((e) => `<button type="button" class="rel" data-rel="${esc(e.id)}">`
        + `<span class="tm">${esc(fmtDate(e.dateKey))}</span>`
        + `<span class="ti">${esc(cardTitle(e))}</span></button>`).join('');
  }

  function renderDetailInto(box) {
    const e = currentEntry();
    if (!e) { box.innerHTML = `<div class="empty"><div class="empty-art">🐾</div><span>${esc(t('selectEntry'))}</span></div>`; return; }
    if (state.editing) { renderEditForm(e, box); return; }
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

    // 一条记录摊开来看：左边是东西本身，右边是关于它的字。
    // 顺序是「东西 → 你写的 → 机器写的 → 动作」——备注是整个面板上唯一属于你的东西，
    // 所以它紧跟在东西后面，不该被一排按钮和一段机器转写压到下面去。
    const meta = [
      `${fmtDate(e.dateKey)} ${fmtTime(e.createdAt)}`,
      t('types')[e.type] || e.type,
      e.origin === 'clipboard' ? t('fromClipboard') : '',
      e.origin === 'browser' ? t('fromBrowser') : '',
      ctxLong(e) ? `${t('fromApp')} ${ctxLong(e)}` : '',
      e.sttLanguage || '',
      e.model || '',
    ].filter(Boolean).map(esc);
    // 来源那一行原本单独占一行，两行 11px 灰字叠在一起谁也读不出来，并成一行
    const ctxUrl = ctxOf(e) && ctxOf(e).url
      ? ` · <a href="#" data-action="openContextUrl">${esc(ctxHost(e))}</a>` : '';
    // 一条记录摊开来看，一列走完：头（标题 · 日期 · 主题）→ 东西 → 机器写的。
    // 动作全部收到右上角，和标题一行——它们和那个关闭叉是同一级的东西，所以站在一起。
    const inModal = !!(box.closest && box.closest('.modal-card'));
    const sec = (label, body, tool = '') => (body
      ? `<section class="dt-sec"><div class="dt-sec-head"><h3>${esc(label)}</h3>${tool}</div>${body}</section>` : '');
    // 每一段都能单独复制：复制的对象是这一段，不是整条记录，所以按钮长在这一段的标题旁边
    const copyOf = (field) => `<button type="button" class="mini" data-action="copySec" data-of="${field}">${esc(t('copy'))}</button>`;
    const machine = [
      sec(t('summary'), e.summary ? `<p class="summary-text">${esc(e.summary)}</p>` : '', copyOf('summary')),
      sec(t('seen'), e.visionLabels ? `<p class="summary-text">${esc(e.visionLabels)}</p>` : '', copyOf('visionLabels')),
      sec(textLabel, e.text ? `<div class="text-block">${esc(e.text)}</div>` : '', copyOf('text')),
    ].filter(Boolean).join('');

    box.innerHTML = `
      <div class="dt${(!isPicture(e) && e.type !== 'audio') ? ' bare' : ''}">
        <header class="dt-head">
          <h2>${esc(e.title || e.path || e.url || '')}</h2>
          <div class="dt-acts">
            <button type="button" class="act${e.pinned ? ' on' : ''}" data-action="pin"
              title="${esc(t(e.pinned ? 'unpin' : 'pin'))}">${esc(t('pin'))}</button>
            <button type="button" class="act" data-action="graph">${esc(t('graph'))}</button>
            <button type="button" class="act danger" data-action="delete">${esc(t('delete'))}</button>
            ${inModal ? `<button type="button" class="act act-close" data-close aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>` : ''}
          </div>
        </header>
        <!-- 日期和备注跟着滚：钉住的只有标题和那三只托盘——「这是哪一条、能对它做什么」，
             翻到哪儿都要在手边；日期和你写的那一句读一遍就够了 -->
        <div class="dt-sub">
          <div class="time">${meta.join(' · ')}${ctxUrl}</div>
          <div class="dt-note">
            <input id="noteField" class="note-line" readonly value="${esc(e.note || '')}"
              placeholder="${esc(t('notePlaceholder'))}" aria-label="${esc(t('noteLabel'))}" />
          </div>
        </div>
        <div class="dt-media">
          <div class="preview">${preview}${(isPicture(e) || e.ocrBoxes) ? `<div class="pic-tools">
            ${e.ocrBoxes ? `<button type="button" class="pic-btn${state.boxesOn ? ' on' : ''}" data-action="boxes">${esc(t(state.boxesOn ? 'hideBoxes' : 'showBoxes'))}</button>` : ''}
            ${isPicture(e) ? `<button type="button" class="pic-btn" data-action="copy">${esc(t('copy'))}</button>` : ''}
          </div>` : ''}</div>
          ${state.boxesOn && e.ocrBoxes ? `<p class="st">${esc(t('copyLine'))}</p>` : ''}
          ${statusLine}
        </div>
        ${machine ? `<div class="dt-machine">${machine}</div>` : ''}
        <div class="dt-related" hidden></div>
      </div>`;

    // 「相关」——讲同一件事的那几条。慢一拍补上来（要算向量），空手就整块不出现：
    // 向量分数没有绝对意义，硬凑三条只会给出三条不相干的东西，那比没有更糟。
    fillRelated(e.id, box);

    // The note is the user's own line and nothing else writes it, so it saves itself when they leave it.
    // 一行主题。默认是只读的一句说明，点一下才交出光标——省得一打开详情就有个输入框在等你打字。
    const note = box.querySelector('#noteField');
    if (note) {
      const edit = () => {
        if (!note.readOnly) return;
        note.readOnly = false;
        note.focus();
        note.setSelectionRange(note.value.length, note.value.length);
      };
      note.addEventListener('click', edit);
      note.addEventListener('keydown', (ev) => {
        if (note.readOnly && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); edit(); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); note.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); note.value = e.note || ''; note.blur(); }
      });
      note.addEventListener('blur', async () => {
        note.readOnly = true;
        const value = note.value.trim();
        if (value === (e.note || '')) return;
        const updated = await ws.updateEntry(e.id, { note: value });
        if (updated) { upsert(updated); toast(t('noteSaved')); }
      });
    }
    if (state.boxesOn && e.ocrBoxes) drawBoxes(box, e);
  }

  // ---------- where the words are ----------
  //
  // PP-OCR reported a box for every line it read and briffy kept them (see src/main/ocr-boxes.js).
  // Shown over the picture they turn a wall of recognised text back into something you can point at:
  // hover a line to find it on the original, click it to copy just that line.
  let boxWatcher = null;    // one at a time: the previous overlay's observer is dropped before a new one

  async function drawBoxes(box, e) {
    const img = box.querySelector('#previewImg');
    if (!img) return;
    const data = state.boxes && state.boxes.id === e.id ? state.boxes.data : await ws.entryBoxes(e.id);
    if (!data || !data.lines || !data.lines.length) return;
    state.boxes = { id: e.id, data };
    const wrap = img.parentElement;
    if (!wrap) return;
    wrap.querySelectorAll('.ocr-layer').forEach((n) => n.remove());

    const layer = document.createElement('div');
    layer.className = 'ocr-layer';
    // Positions are a share of the picture, so the boxes hold as it is resized.
    const W = data.w || img.naturalWidth || 1;
    const H = data.h || img.naturalHeight || 1;
    layer.innerHTML = data.lines.map(([x, y, w, h, , text], i) =>
      `<span class="ocr-box" data-i="${i}" title="${esc(text)}" style="left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%;width:${(w / W * 100).toFixed(3)}%;height:${(h / H * 100).toFixed(3)}%"></span>`).join('');
    layer.addEventListener('click', async (ev) => {
      const hit = ev.target.closest('.ocr-box');
      if (!hit) return;
      ev.stopPropagation();
      await navigator.clipboard.writeText(data.lines[Number(hit.dataset.i)][5] || '');
      toast(t('lineCopied'));
    });
    wrap.appendChild(layer);

    // The picture is drawn with object-fit: contain, so it is letterboxed inside its box whenever the
    // proportions differ -- and a screenshot inside a 380px-tall frame almost always differs. Laying
    // the overlay over the whole frame would then shift every box sideways by the size of the bar, so
    // the layer is fitted to the painted picture instead, and refitted whenever the window changes.
    const fit = () => {
      const rw = img.clientWidth; const rh = img.clientHeight;
      if (!rw || !rh) return;
      const scale = Math.min(rw / W, rh / H);
      const pw = W * scale; const ph = H * scale;
      layer.style.left = `${img.offsetLeft + (rw - pw) / 2}px`;
      layer.style.top = `${img.offsetTop + (rh - ph) / 2}px`;
      layer.style.width = `${pw}px`;
      layer.style.height = `${ph}px`;
    };
    if (img.complete) fit(); else img.addEventListener('load', fit, { once: true });
    if (window.ResizeObserver) {
      // An element has no 'remove' event to hang this on, and a detail view is re-rendered on every
      // click, so the observer is owned here and the old one is dropped rather than left watching a
      // picture nobody can see any more.
      if (boxWatcher) boxWatcher.disconnect();
      boxWatcher = new ResizeObserver(fit);
      boxWatcher.observe(img);
    }
  }

  function renderEditForm(e, box = detailBox()) {
    box.innerHTML = `
      <form class="edit-form" id="editForm">
        <label><span>${esc(t('title'))}</span><input name="title" value="${esc(e.title || '')}" /></label>
        <label><span>${esc(t('textField'))}</span><textarea name="text">${esc(e.text || '')}</textarea></label>
        <div class="actions"><button type="submit" class="btn primary">${esc(t('save'))}</button><button type="button" class="btn" data-action="cancelEdit">${esc(t('cancel'))}</button></div>
      </form>`;
    $('#editForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const updated = await ws.updateEntry(e.id, { title: fd.get('title'), text: fd.get('text') });
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

  async function detailAction(action, btn = null) {
    const e = currentEntry();
    if (!e) return;
    switch (action) {
      case 'open': await ws.openEntry(e.id); break;
      case 'reveal': await ws.revealEntry(e.id); break;
      case 'openLink': await ws.openExternal(e.url); break;
      case 'retry': await ws.retryEntry(e.id); break;
      case 'edit': state.editing = true; renderDetail(); break;
      case 'moreActions': state.moreActions = !state.moreActions; renderDetail(); break;
      case 'cancelEdit': state.editing = false; renderDetail(); break;
      // 每一段自己的复制：复制这一段，不是整条记录
      case 'copySec': {
        await navigator.clipboard.writeText(String((btn && e[btn.dataset.of]) || '').trim());
        toast(t('copied'));
        break;
      }
      // 一张图该复制的是那张图，不是它被认出来的字
      case 'copy': {
        if (isPicture(e)) { const r = await ws.copyEntry(e.id); toast(t(r && r.ok ? 'copied' : 'copyFailed')); break; }
        await navigator.clipboard.writeText(e.text || '');
        toast(t('copied'));
        break;
      }
      case 'openContextUrl': await ws.openExternal(ctxOf(e) ? ctxOf(e).url : ''); break;
      case 'graph': openGraph(e.id); break;
      case 'pin': {
        const updated = await ws.updateEntry(e.id, { pinned: !e.pinned });
        if (updated) { upsert(updated); state.pinnedCount += updated.pinned ? 1 : -1; renderDims(); renderDetail(); renderList(); }
        break;
      }
      case 'copyLink': {
        const link = await ws.entryLink(e.id);
        if (link) { await navigator.clipboard.writeText(link); toast(t('linkCopied')); }
        break;
      }
      case 'boxes':
        state.boxesOn = !state.boxesOn;
        if (!state.boxesOn && boxWatcher) { boxWatcher.disconnect(); boxWatcher = null; }
        renderDetail();
        break;
      case 'delete':
        if (!window.confirm(t('confirmDelete'))) return;
        await ws.deleteEntry(e.id);
        state.entries = state.entries.filter((x) => x.id !== e.id);
        if (!$('#detailModal').hidden) closeDetail();
        else { state.selectedId = null; renderList(); }
        break;
      default: break;
    }
  }

  // 记一句话：一张从左下角升起的纸，写完就收起来
  function toggleNote(on) {
    const pad = $('#notePad');
    const show = on === undefined ? pad.hidden : on;
    pad.hidden = !show;
    if (show) setTimeout(() => $('#quickInput').focus(), 0);
  }

  // ---------- ask ----------
  // recall.js in the main process decides which entries a question is about; the model then answers over
  // only those and cites them by number. Those numbers are the chips in the answer and the badges on the
  // cards beside it, so every sentence can be traced back to the records it came from.
  async function runAsk() {
    const q = $('#askInput').value.trim();
    if (!q || state.ask.busy) return;
    $('#askInput').value = '';
    switchTab('ask');
    state.ask = { question: q, result: null, busy: true };
    $('#btnAsk').disabled = true;
    renderAsk();
    try {
      state.ask.result = await ws.ask(q);
    } catch (err) {
      state.ask.result = { question: q, answer: '', used: [], sources: [], range: null, scored: true, noProvider: false, error: err.message, total: 0 };
    } finally {
      state.ask.busy = false;
      $('#btnAsk').disabled = false;
      if (state.ask.result) state.chat.push(state.ask.result);   // 问过的留在这一页上
      renderAsk();
    }
  }

  function askMeta(r) {
    const bits = [];
    if (r.range) bits.push(r.range.from === r.range.to ? fmtDate(r.range.from) : t('askRange', { from: fmtDate(r.range.from), to: fmtDate(r.range.to) }));
    // 「全部」只有在真的是全部的时候才说。够不到就说最近多少条、一共多少条——
    // 一周 208 条只给了模型 40 条，写成「全部记录」是在骗人，也让人看不出答案为什么不对。
    if (!r.scored && r.sources.length) {
      bits.push(r.inRange > r.sources.length ? t('askRecent', { n: r.sources.length, of: r.inRange }) : t('askWhole'));
    }
    if (r.sources.length) bits.push(t('askCount', { n: r.sources.length }));
    if (r.model) bits.push(r.model);
    return bits.join(' \u00b7 ');
  }

  // 模型写回来的是 markdown，这里把它变成纸上的字。
  //
  // 这个函数一直被 turnHtml 调用，却从来没有被定义过——所以只要有回答送到，渲染就抛
  // ReferenceError，整页停在「正在翻记录…」不动。「没有 AI 聊天页面」是这么来的：页面是有的，
  // 是它一画就崩。
  //
  // 只认答案里真的会出现的那几样，而且**没有斜体**：纸面标准里那一条是硬的（永远无斜体）。
  // 先转义再解析，所以模型写什么都不会变成标签——withCitations 也依赖这个前提。
  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;                      // 'ul' | 'ol'
    let code = null;                      // 代码块里的行

    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, (m, b) => `<b>${b}</b>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, txt, href) => `<a href="${href}" target="_blank" rel="noreferrer">${txt}</a>`);
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`</${list.tag}>`); list = null; } };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (code !== null) {                                   // 代码块里一切照抄
        if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else code.push(raw);
        continue;
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); code = []; continue; }
      if (!line.trim()) { flushPara(); flushList(); continue; }

      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || number) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        if (!list) { list = { tag }; out.push(`<${tag}>`); }
        out.push(`<li>${inline((bullet || number)[1])}</li>`);
        continue;
      }
      const head = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (head) {                                            // 标题在一段回答里就是一行加重的话
        flushPara(); flushList();
        out.push(`<p class="mdh">${inline(head[1])}</p>`);
        continue;
      }
      flushList();
      para.push(line);
    }
    if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    flushPara(); flushList();
    return out.join('');
  }

  // [2] in the answer becomes a chip pointing at source card 2. md() has already escaped everything,
  // so the brackets are plain text by the time we get here; numbers with no card are left alone.
  function withCitations(html, count) {
    return html.replace(/\[(\d{1,2})\]/g, (whole, n) => (Number(n) >= 1 && Number(n) <= count ? `<span class="cite" data-n="${n}">${n}</span>` : whole));
  }

  function sourceCard(e, n, cited) {
    const thumb = (e.type === 'screenshot' || e.type === 'image') && e.fileUrl
      ? `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />` : (ICONS[e.type] || ICONS.file);
    return `<div class="card src${cited ? ' cited' : ''}" data-id="${e.id}" data-n="${n}">
      <div class="num">${n}</div>
      <div class="thumb t-${esc(e.type)}">${thumb}</div>
      <div class="card-body">
        <div class="card-title">${esc(e.title || e.path || e.url || '')}</div>
        <div class="card-meta"><span>${esc(fmtDate(e.dateKey))}</span><span>${fmtTime(e.createdAt)}</span><span>${esc(t('types')[e.type] || e.type)}</span></div>
      </div></div>`;
  }

  // 问过的话留在这一页上，一轮一轮往下排。最后一轮引用的记录列在右边。
  function renderAsk() {
    const box = $('#askAnswer');
    const turns = state.chat;
    if (!turns.length && !state.ask.busy) {
      box.innerHTML = `<div class="empty"><span>${esc(t('askEmpty'))}</span></div>`;
      return;
    }
    let html = turns.map(turnHtml).join('');
    if (state.ask.busy) html += `<div class="turn"><p class="ask-q">${esc(state.ask.question)}</p><div class="ask-note">${esc(t('askThinking'))}</div></div>`;
    box.innerHTML = html;
    box.parentElement.scrollTop = box.parentElement.scrollHeight;
  }
  // 被引用的记录是回答里的一小片纸，不是另一栏。点它跳到那条记录。
  function citeCard(e, n, cited) {
    const thumb = (e.type === 'screenshot' || e.type === 'image') && e.fileUrl
      ? `<img src="${esc(e.fileUrl)}" loading="lazy" alt="" />` : (ICONS[e.type] || ICONS.file);
    return `<button type="button" class="citecard${cited ? ' cited' : ''}" data-id="${esc(e.id)}" data-n="${n}">`
      + `<span class="cn">${n}</span><span class="ct">${thumb}</span>`
      + `<span class="cb"><b>${esc(cardTitle(e))}</b><span>${esc(fmtTime(e.createdAt))}</span></span></button>`;
  }

  function turnHtml(r) {
    let note = '';
    if (r.error) note = `<div class="ask-note warn">${esc(t('askFailed', { err: r.error }))}</div>`;
    else if (r.noProvider) note = `<div class="ask-note">${esc(t('askNoProvider'))}</div>`;
    else if (!r.sources.length) note = `<div class="ask-note">${esc(r.total ? t('askNoMatch') : t('askNoEntries'))}</div>`;
    const meta = askMeta(r);
    return `<div class="turn"><p class="ask-q">${esc(r.question)}</p>`
      + (meta ? `<div class="meta">${esc(meta)}</div>` : '')
      + note
      + (r.answer ? withCitations(md(r.answer), r.sources.length) : '')
      + (r.sources.length ? `<div class="cites">${r.sources.map((e, i) => citeCard(e, i + 1, r.used.includes(i + 1))).join('')}</div>` : '')
      + `</div>`;
  }

  let flashTimer = null;
  function flashSource(n) {
    const turn = $('#askAnswer').lastElementChild;
    const el = turn && turn.querySelector(`.citecard[data-n="${n}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearTimeout(flashTimer);
    for (const c of document.querySelectorAll('.citecard.flash')) c.classList.remove('flash');
    el.classList.add('flash');
    flashTimer = setTimeout(() => el.classList.remove('flash'), 1400);
  }

  // A source can be anywhere in the log, so the entries tab has to drop its filters to show it.
  async function openEntry(id) {
    state.query = ''; $('#search').value = '';
    state.date = ''; $('#dateFilter').value = '';
    await loadEntries();
    switchTab('entries');
    setSelecting(false);
    openDetail(id);
    const el = document.querySelector(`#jgScroll .jg-tile[data-id="${id}"], #lvRows .lv-row[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
  }

  // ---------- settings ----------
  // What automatic recording is doing right now, in a line.
  function renderAutoRecord(info) {
    const el = $('#autoRecordState');
    if (!el) return;
    const st = info || {};
    if (!st.on) { el.textContent = t('autoOff'); return; }
    if (st.state === 'denied') { el.textContent = t('autoDenied'); return; }
    if (st.state === 'failed') { el.textContent = t('autoFailed'); return; }
    // 谁开着麦克风，直接写出来——这个功能整个建立在这件事上。写系统里那个名字（「微信输入法」），
    // 不是可执行文件名（WeType）：后者没法让人判断该不该录。
    const who = (st.holders || []).map((h) => h.app || h.name).join('、');
    if (!st.inUse) { el.textContent = t('autoWaiting'); return; }
    el.textContent = `${st.state === 'speech' ? t('autoSpeech') : t('autoIdle', { mic: st.mic || '' })} · ${t('autoBecause', { who })}`;
  }

  // 白名单本身。一个 240px 的输入框装不下十八项用顿号连起来的名字——那串有 180 个字符，读不了也改不了。
  // 所以名单是一排词，点一下去掉一个；旁边一个小框加新的。
  let allowList = [];
  // 名单里存的是进程名（TencentMeeting），要显示的是这台电脑上那个软件叫什么（腾讯会议）。
  // 主进程扫过应用目录才知道两者的对应关系，所以翻译是它给的，见 src/main/apps.js。
  let allowInfo = new Map();
  let allowSuggested = [];
  function renderAllow() {
    const box = $('#autoRecordAllowList');
    if (!box) return;
    box.textContent = '';
    if (!allowList.length) {
      const none = document.createElement('span');
      none.className = 'chip zero';
      none.textContent = t('autoAllowEmpty');
      box.appendChild(none);
      return;
    }
    for (const name of allowList) {
      const info = allowInfo.get(name) || {};
      const c = document.createElement('span');
      c.className = `chip drop-app${info.kind === 'site' ? ' is-site' : ''}`;
      c.textContent = info.label || name;
      c.title = info.kind === 'site' ? `${t('autoAllowSite')} · ${t('autoAllowDrop')}` : `${name} · ${t('autoAllowDrop')}`;
      c.addEventListener('click', () => {
        allowList = allowList.filter((x) => x !== name);
        renderAllow(); renderMicNow(lastListen); queueSave();
      });
      box.appendChild(c);
    }
    // 改过之后总得有条路回去，否则「点掉了不该点的那个」就只能靠自己重新打一遍
    if (allowSuggested.length && allowList.join('\u0001') !== allowSuggested.join('\u0001')) {
      const r = document.createElement('span');
      r.className = 'chip add-app';
      r.textContent = t('autoAllowReset');
      r.addEventListener('click', resetAllow);
      box.appendChild(r);
    }
  }
  function addAllow(name) {
    const t2 = String(name || '').trim();
    if (!t2 || allowList.some((x) => x.toLowerCase() === t2.toLowerCase())) return;
    allowList = allowList.concat(t2);
    renderAllow(); renderMicNow(lastListen); queueSave();
  }
  function resetAllow() {
    allowList = allowSuggested.slice();
    renderAllow(); renderMicNow(lastListen); queueSave();
  }

  // 装了哪些浏览器。列出来是因为「浏览器也在白名单里」这件事本来看不见——名单里只有站点，
  // 而用户想知道的是「我的 Chrome 算不算」。答案是：停在上面那些网站时算，别的时候不算。
  function renderBrowsers(list) {
    const el = $('#autoRecordBrowsers');
    if (!el) return;
    el.textContent = list.length ? `${t('autoBrowsers')} ${list.join('、')}` : '';
  }

  // 现在有谁在用麦克风，每个都能点一下加进白名单。
  let lastListen = null;
  //
  // 列的是 `seen` 而不是 `holders`：holders 已经过了白名单，一旦白名单非空，别的应用就再也不出现，
  // 也就没办法被加进去——那样这个输入框只能靠手打进程名，等于没有。
  function renderMicNow(info) {
    lastListen = info || lastListen;
    info = lastListen;
    const el = $('#autoRecordNow');
    if (!el) return;
    // 这次运行里用过麦克风的，新的在前；没有就退回成此刻占着的
    const list = ((info && info.recent) || []).length ? info.recent : ((info && info.seen) || []);
    if (!list.length) { el.textContent = t('autoNowNobody'); return; }
    el.textContent = t('autoNowUsing') + ' ';
    for (const h of list) {
      const b = document.createElement('span');
      b.className = 'chip add-app';
      b.textContent = h.app || h.name;
      // 写进名单的是进程名，不是显示名：「微信输入法」这五个字在 exe 路径里一个也找不到。
      b.title = h.name;
      if (allowList.some((x) => x.toLowerCase() === h.name.toLowerCase())) continue;   // 已经在名单里了
      b.addEventListener('click', () => addAllow(h.name));
      el.appendChild(b);
    }
  }


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
    for (const b of document.querySelectorAll('#themeSeg button')) b.classList.toggle('active', b.dataset.theme === (s.theme || 'system'));
    $('#normalizeChineseScript').checked = s.normalizeChineseScript !== false;
    $('#recordContext').checked = s.recordContext !== false;
    $('#recordTrail').checked = s.recordTrail === true;   // 默认关着：它记的是你路过的，不是你存的
    $('#autoRecord').checked = s.autoRecord === true;
    allowSuggested = (m.apps && m.apps.suggested) || [];
    const described = (m.apps && m.apps.allow) || [];
    allowInfo = new Map(described.map((x) => [x.entry, x]));
    allowList = described.length ? described.map((x) => x.entry) : (s.autoRecordAllow || []).slice();
    renderAllow();
    renderBrowsers((m.apps && m.apps.browsers) || []);
    $('#diarize').checked = s.diarize === true;
    renderAutoRecord(m.listen);
    renderMicNow(m.listen);
    renderConnect();
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
    $('#workspaceDir').value = m.workspaceDir || '';
    $('#ocrDroppedImages').checked = !!s.ocrDroppedImages;
    $('#petHidden').checked = !!s.petHidden;
    const perm = m.platform === 'darwin' ? `<br><b>${esc(t('screenPerm'))}:</b> ${esc(m.screenPermission)}` : '';
    $('#aboutBox').innerHTML = `<b>${esc(t('version'))}:</b> ${esc(m.version)} · <b>${esc(t('platform'))}:</b> ${esc(m.platform)}<br>${esc(t('stats', m.stats))}${perm}`;
    $('#sideStats').textContent = t('statsShort', m.stats);
  }
  function renderSttLanguage() {
    const langs = [$('#lang1').value, $('#lang2').value];
    const names = Object.fromEntries(state.meta.languages.map((l) => [l.code, l.name]));
    const cur = state.settings.sttLanguage || 'packs';
    $('#sttLanguage').innerHTML = [
      `<option value="packs"${cur === 'packs' ? ' selected' : ''}>${esc(t('sAutoPacks'))}</option>`,
      `<option value="auto"${cur === 'auto' ? ' selected' : ''}>${esc(t('sAuto'))}</option>`,
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
  // no save button: a change saves itself. text fields wait until you pause typing; secrets wait until you leave the box
  let saveTimer = null;
  function queueSave(delay = 0) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveSettings().catch((e) => toast(String(e?.message || e))); }, delay); }
  let savedTimer = null;
  function flashSaved() {
    const el = $('#settingsStatus'); el.textContent = t('saved'); el.classList.add('show');
    clearTimeout(savedTimer); savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }
  async function saveSettings(ev) {
    if (ev) ev.preventDefault();
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
      recordContext: $('#recordContext').checked,
      recordTrail: $('#recordTrail').checked,
      autoRecord: $('#autoRecord').checked,
      autoRecordAllow: allowList.slice(),
      diarize: $('#diarize').checked,
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
    flashSaved();
    if (patch.workspaceDir !== undefined) { toast(t('dirChanged')); await loadEntries(); }
  }
  async function refreshMeta(settings) {
    state.meta = await ws.getSettings();
    setAvatarEverywhere(state.meta.avatarUrl);
    state.settings = settings || state.meta.settings;
    state.ui = state.settings.languages[0].startsWith('zh') ? 'zh' : 'en';
    applyI18n();
    populateSettings();
    renderList(); renderDetail();
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
    // 一条空的进度槽是「有件事没做完」的意思。没在跑的时候它不该在那儿画一道灰线。
    $('#setupPanel .bar').classList.toggle('hidden', !st.running);
    $('#setupPanel .bar i').style.width = `${st.percent || 0}%`;
    $('#setupLogBox').classList.toggle('hidden', !$('#setupLog').textContent.trim());
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
    // Two things decide whether someone goes ahead: which model, and how big the download is. Those
    // lead. The machine's specs and the runner-up models are real but are not a decision anyone is
    // making here, so they fold away.
    // One recommendation on the page, not two. The shelves below are what actually decides it, so this
    // line reads from them; computing it separately is how it came to advise a 27B while offering a 2B.
    const shelf = (st.catalogue && st.catalogue.tiers) || {};
    const starred = [...(shelf.easy || []), ...(shelf.medium || []), ...(shelf.stretch || [])].find((m) => m.recommended);
    const pickModel = starred ? starred.model : rec.model;
    const pickSize = starred ? starred.sizeGB : rec.sizeGB;
    const size = pickSize ? t('hwSize', { gb: pickSize }) : '';
    // 「Ollama 装了没有」是这一段的状态行，「用哪个模型」是下一段的第一句 —— 它们是两件事，
    // 挤在同一块灰字里就成了一段谁也不读的说明。
    const state$ = $('#ollamaState');
    if (ol.running) {
      const names = ol.models.map((m) => m.name);
      state$.className = 'st ok';
      state$.textContent = t('ollamaReady') + (names.length ? ` · ${t('ollamaInstalled', { models: names.join(', ') })}` : '');
      $('#ollamaModels').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
    } else {
      state$.className = 'st warn';
      state$.textContent = ol.installed ? t('ollamaNotStarted', { binary: ol.binary || '' }) : t('ollamaNotInstalled');
    }
    const alts = rec.alternatives.map((x) => `<code>${esc(x.model)}</code> ${x.sizeGB} GB · ${esc(x.note)}`).join('<br>');
    $('#hwBox').innerHTML = `<div class="lede">${esc(t('hwPick', { model: pickModel || '?' }))}${size ? ` <span class="muted">${esc(size)}</span>` : ''}</div>`
      + `<details class="why"><summary>${esc(t('hwWhy'))}</summary>`
      + `<div>${esc(rec.reason)}${rec.notes.length ? ` ${esc(rec.notes.join(' '))}` : ''}</div>`
      + `<div class="muted">${esc(hw.cpu)} · ${esc(t('hwCores', { n: hw.cores }))} · RAM ${hw.ramGB} GB · ${esc(gpus)}</div>`
      + (alts ? `<div class="alts"><b>${esc(t('hwAlternatives'))}</b><br>${alts}</div>` : '')
      + `</details>`;
    $('#ollamaModel').placeholder = rec.model || '';
    renderModelCards();
    // only offer the step that is actually needed
    $('#ollamaSetup').classList.toggle('hidden', !!ol.running);
    $('#btnInstallOllama').classList.toggle('hidden', !!ol.installed);
    $('#btnStartOllama').classList.toggle('hidden', !ol.installed);
    $('#btnPull').disabled = !ol.running;
  }
  // What decides a multi-gigabyte download: which model, how big, and whether this machine can run it.
  // A text field with a datalist answered none of those, and a model already on disk looked identical
  // to one that was not.
  // Three shelves, three models each, cut for this machine and this week: what runs comfortably here,
  // what is a fair trade, and the heaviest that will load at all. Quality is a public leaderboard score
  // (ifeval for following instructions in the shape asked for, mmlu-pro for knowing things), not a
  // guess from the name -- so the table moves when the leaderboard does.
  const TIERS = [['easy', 'tierEasy'], ['medium', 'tierMedium'], ['stretch', 'tierStretch']];
  // 一个模型是一行，不是一张卡片。九张带影子的白方块把设置页变成了另一个应用的界面 ——
  // 这一页上只有真实物件才有影子，而目录里的一个名字不是物件。名字 / 说明 / 动作三列对齐，
  // 正在用的那一行划一道荧光笔（选中永远是荧光笔，不是抬起来）。
  function modelRow(m, installed, current, running) {
    const have = installed.has(m.model);
    const inUse = m.model === current;
    const bits = [`${m.sizeGB} GB`, m.vision ? t('mdVision') : t('mdTextOnly')];
    if (m.measured) bits.push(t('mdScored', { n: (m.quality * 100).toFixed(0) }));
    if (have) bits.push(t('mdInstalled'));
    if (inUse) bits.push(t('mdInUse'));
    const acts = [];
    if (!have) acts.push(`<button type="button" class="btn primary" data-get="${esc(m.model)}"${running ? '' : ' disabled'}>${esc(t('mdGet'))}</button>`);
    else if (!inUse) acts.push(`<button type="button" class="btn" data-use="${esc(m.model)}">${esc(t('mdUse'))}</button>`);
    if (have) acts.push(`<button type="button" class="btn" data-del="${esc(m.model)}">${esc(t('mdDelete'))}</button>`);
    return `<div class="mdl-row${inUse ? ' in-use' : ''}">`
      + `<span class="mdl-n">${esc(m.model)}${m.recommended ? `<i class="tag-rec">${esc(t('mdRecommended'))}</i>` : ''}</span>`
      + `<span class="mdl-m">${esc(bits.join(' · '))}</span>`
      + `<span class="mdl-a">${acts.join('')}</span></div>`;
  }
  function renderModelCards() {
    const st = state.providerStatus;
    if (!st) return;
    const tiers = (st.catalogue && st.catalogue.tiers) || {};
    const installed = new Set(((st.ollama && st.ollama.models) || []).map((m) => m.name));
    const current = state.settings.ollamaModel || (st.recommendation && st.recommendation.model) || '';
    const running = !!(st.ollama && st.ollama.running);
    $('#modelCards').innerHTML = TIERS.map(([key, label]) => {
      const list = tiers[key] || [];
      if (!list.length) return '';
      return `<div class="mdl-tier"><div class="mdl-h">${esc(t(label))}<span>${esc(t(`${label}Why`))}</span></div>`
        + list.map((m) => modelRow(m, installed, current, running)).join('') + `</div>`;
    }).join('');
    const c = st.catalogue || {};
    $('#modelsNote').textContent = c.live
      ? t('mdLive', { n: c.scored || 0 }) : t('mdCached');

    const pend = st.pendingPull;
    const box = $('#resumePull');
    if (pend && pend.model && !installed.has(pend.model)) {
      const got = pend.totalBytes ? t('resumeGot', { got: mb(pend.receivedBytes || 0), total: mb(pend.totalBytes) }) : '';
      box.innerHTML = `<span><b>${esc(t('resumeTitle', { model: pend.model }))}</b>${got ? ` · ${esc(got)}` : ''}</span>`
        + `<button type="button" class="btn primary" data-get="${esc(pend.model)}">${esc(t('resumeGo'))}</button>`
        + `<button type="button" class="btn" id="btnDropPull">${esc(t('resumeDrop'))}</button>`;
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  }

  async function useModel(model) {
    state.settings.ollamaModel = model;
    $('#ollamaModel').value = model;
    await ws.saveSettings({ ollamaModel: model });
    await loadProviderStatus();
  }
  async function deleteModel(model) {
    if (!window.confirm(t('mdConfirmDelete', { model }))) return;
    try { await ws.ollamaRemove(model); } catch (e) { toast(e.message); }
    await loadProviderStatus();
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
    $('#pullProgress').textContent = '';
    showJob('jobPullPreparing', { model });
    try {
      const r = await ws.ollamaPull(model);
      if (r && r.ok) {
        finishJob('jobPullDone', { model });
        await useModel(model);          // downloading it is asking to use it
      } else {
        const code = r && r.code;
        failJob(code === 'ollama-not-installed' ? t('ollamaNotInstalled')
          : code === 'ollama-not-running' ? t('pullNeedsOllama')
            : `${t('error')}: ${(r && r.error) || ''}`);
      }
      await loadProviderStatus();
    } catch (e) {
      failJob(`${t('error')}: ${e.message}`);
    } finally {
      $('#btnPull').disabled = false;
      pullingModel = '';
    }
  }

  // Installing Ollama and pulling a model look the same to whoever is waiting: something large is
  // coming down. One block serves both -- what is happening, in words, and how far along it is.
  // A job with nothing to measure yet shows a moving stripe rather than a bar stuck at zero.
  function showJob(labelKey, params) {
    $('#ollamaJob').classList.remove('hidden');
    $('#jobLabel').textContent = t(labelKey, params);
    $('#jobNumbers').textContent = '';
    $('#jobBar').style.width = '0%';
    $('#jobBar').parentElement.classList.add('waiting');
    $('#installLog').textContent = '';
  }
  const mb = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`);
  function updateJob({ labelKey, params, percent, received, total }) {
    if (labelKey) $('#jobLabel').textContent = t(labelKey, params);
    const bar = $('#jobBar');
    if (percent === undefined || percent === null) {
      bar.parentElement.classList.add('waiting');
    } else {
      bar.parentElement.classList.remove('waiting');
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    $('#jobNumbers').textContent = total
      ? `${mb(received || 0)} / ${mb(total)}`
      : (percent === undefined || percent === null ? '' : `${percent}%`);
  }
  function finishJob(labelKey, params) {
    $('#jobLabel').textContent = t(labelKey, params);
    $('#jobBar').parentElement.classList.remove('waiting');
    $('#jobBar').style.width = '100%';
  }
  function failJob(msg) {
    $('#jobLabel').textContent = msg;
    $('#jobBar').parentElement.classList.remove('waiting');
    $('#jobBar').style.width = '0%';
    $('#jobLogBox').open = true;   // it went wrong, so the detail stops being noise
  }

  function appendLog(line) {

    const box = $('#installLog');
    box.classList.remove('hidden');
    box.textContent = `${box.textContent}${box.textContent ? '\n' : ''}${line}`.split('\n').slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  // ffmpeg: found on the machine or installed through its package manager; never bundled.
  async function loadFfmpeg(refresh = false) {
    const st = await ws.ffmpegStatus({ refresh }).catch(() => null);
    if (!st) return;
    state.ffmpeg = st;
    $('#ffmpegStatus').textContent = st.installed
      ? t('ffmpegFound', { version: st.version, path: st.ffmpeg })
      : t('ffmpegMissing');
    $('#btnFfmpegInstall').classList.toggle('hidden', !!st.installed);
  }
  async function installFfmpeg() {
    const btn = $('#btnFfmpegInstall');
    const log = $('#ffmpegLog');
    btn.disabled = true;
    log.textContent = ''; log.classList.remove('hidden');
    $('#ffmpegStatus').textContent = t('ffmpegInstalling');
    try {
      const r = await ws.ffmpegInstall();
      if (r && r.manual) $('#ffmpegStatus').textContent = t('ffmpegManual', { url: r.url });
      else await loadFfmpeg(true);
    } catch (e) {
      $('#ffmpegStatus').textContent = `${t('error')}: ${e.message}`;
    } finally { btn.disabled = false; }
  }

  async function installOllama() {
    $('#btnInstallOllama').disabled = true;
    $('#pullProgress').textContent = '';
    showJob('jobInstallStarting');
    try {
      const r = await ws.ollamaInstall();
      if (r.manual) { failJob(t('installManual')); await ws.openExternal(r.url); }
      else if (r.ok) finishJob('jobInstallDone');
      else { failJob(t('installFail', { err: r.exitCode !== undefined ? `exit ${r.exitCode}` : (r.error || '') })); await ws.openExternal(r.url || 'https://ollama.com/download'); }
      await loadProviderStatus(true);
    } catch (e) {
      failJob(t('installFail', { err: e.message }));
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
    let savedView = 'grid';
    try { savedView = localStorage.getItem('briffy.view') || 'grid'; } catch (_) { /* storage unavailable */ }
    applyView(savedView === 'list' ? 'list' : 'grid');
    await loadEntries();

    // 底栏：左下角新建，中间问，右下角设置
    // 底栏那两个入口是开关：再点一下就回记录页，否则设置页没有出口
    $('#btnSettings').addEventListener('click', () => switchTab(state.tab === 'settings' ? 'entries' : 'settings'));
    $('#btnAskPage').addEventListener('click', () => switchTab(state.tab === 'ask' ? 'entries' : 'ask'));
    $('#winClose').addEventListener('click', () => window.close());

    // 拖外部文件进窗口 = 拖到常驻头像上：同一个入口，只是这里多一层蒙版说清楚松手会发生什么
    const veil = $('#dropVeil');
    let dragDepth = 0;
    const hasFiles = (dt) => !!dt && [...(dt.types || [])].some((x) => x === 'Files' || x === 'text/uri-list');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e.dataTransfer)) return; dragDepth++; veil.hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth = 0; veil.hidden = true;
      const dt = e.dataTransfer;
      const paths = [...(dt.files || [])].map((f) => ws.pathForFile(f)).filter(Boolean);
      const uriList = dt.getData('text/uri-list') || '';
      const urls = uriList.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /^https?:/i.test(l));
      const text = dt.getData('text/plain') || '';
      if (!paths.length && !urls.length && !text) return;
      try {
        const added = await ws.drop({ paths, urls: paths.length ? [] : urls, text: paths.length || urls.length ? '' : text });
        toast(t('dropped', { n: (added || []).length }));
      } catch (err) { toast(err.message); }
    });
    $('#btnNew').addEventListener('click', () => toggleNote());
    $('#quickInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { toggleNote(false); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#quickAdd').requestSubmit(); }
    });
    // 时间轴：点一行跳过去，滚动时它自己跟着走
    $('#axis').addEventListener('click', (e) => {
      const b = e.target.closest('.ax');
      if (!b) return;
      // 多选模式下（或按住 Cmd），点一天就是选中这一天——轴本来就是按天分的
      if (state.selecting || e.metaKey || e.ctrlKey) { pickDay(b.dataset.day, e.metaKey || e.ctrlKey || e.shiftKey); return; }
      jumpToDay(b.dataset.day);
    });
    $('#jgScroll').addEventListener('scroll', markAxis, { passive: true });
    $('#lvRows').addEventListener('scroll', markAxis, { passive: true });
    let searchTimer = null;
    // 内容让开顶栏那一截。顶栏的高度会变——多一行主题、筛选换行、窗口变窄——所以量出来，
    // 别写死。以前是 112px 写死在两处 CSS 里，主题那一行一出现就压在第一条记录上。
    const top = document.querySelector('.top');
    if (top && window.ResizeObserver) {
      const fit = () => document.documentElement.style.setProperty('--top-h', `${Math.round(top.getBoundingClientRect().bottom)}px`);
      new ResizeObserver(fit).observe(top);
      fit();
    }
    // 上面那行：切换展开哪个维度；已经选中的那个再点一下就取消
// 「相关」里点一条 = 打开那一条。委托到 document 上：这一块在详情面板里，
    // 而详情面板在列表视图和弹窗里各有一份，两处都要能点。
$('#graphModal').addEventListener('click', (ev) => {
      // 点背景或叉都关；点一个节点是把图移过去，不是打开那条记录——图谱的用处就是走链
      if (ev.target.closest('[data-graph-close]') || ev.target === $('#graphModal')) { $('#graphModal').hidden = true; return; }
      const n = ev.target.closest('.gr-node');
      if (n && n.dataset.rel) openGraph(n.dataset.rel);
    });
        document.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('[data-rel]');
      if (!b) return;
      state.selectedId = b.dataset.rel;
      if (!state.entries.some((x) => x.id === state.selectedId)) { loadEntries(); return; }
      renderDetail(); renderList();
    });
    $('#tvRows').addEventListener('click', (e) => {
      if (e.target.closest('[data-trail-all]')) { trailAll = true; renderTrail(); return; }
      const row = e.target.closest('.tv-row');
      if (!row) return;
      const k = row.dataset.key;
      if (trailOpen.has(k)) trailOpen.delete(k); else trailOpen.add(k);
      renderTrail();
    });
        $('#dims').addEventListener('click', (e) => {
      if (e.target.closest('[data-clear]')) { state.f = { type: '', origin: '', topic: '' }; loadEntries(); return; }
      const b = e.target.closest('[data-dim]');
      if (!b) return;
      const k = b.dataset.dim;
      if (state.dim === k && state.f[k]) { state.f[k] = ''; loadEntries(); return; }
      state.dim = k; moreValues = false; renderDims();
    });
    $('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = e.target.value; loadEntries(); }, 200); });
    $('#dateFilter').addEventListener('change', (e) => { state.date = e.target.value; loadEntries(); });
    $('#quickAdd').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('#quickInput').value.trim();
      if (!v) return;
      $('#quickInput').value = '';
      if (/^(https?:\/\/|www\.)\S+$/i.test(v)) await ws.addUrl(v); else await ws.addNote(v);
    });
    $('#themeSeg').addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-theme]');
      if (!b) return;
      for (const x of document.querySelectorAll('#themeSeg button')) x.classList.toggle('active', x === b);
      await ws.saveSettings({ theme: b.dataset.theme });      // seeing it change is the confirmation
    });
    // 下面那行：选当前维度的值。再点一次同一个就是取消。
    $('#sources').addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { moreValues = !moreValues; renderValues(); return; }
      const chip = e.target.closest('[data-val]');
      if (!chip) return;
      const v = chip.dataset.val;
      state.f[state.dim] = state.f[state.dim] === v ? '' : v;
      loadEntries();
    });
    let lastPicked = null;
    // Press: open the record, or in select mode pick it. Shift picks everything between this and the
    // last one picked, in the order on screen -- the way Immich and the Finder do it.
    function pressEntry(id, ev) {
      const additive = !!(ev && (ev.metaKey || ev.ctrlKey));
      if (!state.selecting) {
        if (!additive) { openDetail(id); return; }
        setSelecting(true);              // Cmd 点一下就进多选，不用先去按那个按钮
      }
      if (ev && ev.shiftKey && lastPicked) {
        const ids = state.entries.map((e) => e.id);
        const a = ids.indexOf(lastPicked), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) state.picked.add(x);
      } else if (state.picked.has(id)) state.picked.delete(id);
      else state.picked.add(id);
      lastPicked = id;
      renderBulk();
      renderList();
    }
    const scroller = $('#jgScroll');
    scroller.addEventListener('click', (e) => { const tile = e.target.closest('.jg-tile'); if (tile) pressEntry(tile.dataset.id, e); });
    // 空白处按下往外拖 = 拉框选。这是 startMarquee 唯一的入口，之前它是段没人调用的死代码
    scroller.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.jg-tile')) return;          // 便签自己处理点击
      startMarquee(e, scroller, '.jg-tile');
    });
    // 在空白处点一下（没拖动）就是取消选择——和 Finder 一样
    scroller.addEventListener('click', (e) => {
      if (e.target.closest('.jg-tile')) return;
      if (state.selecting && !marqueeMoved) setSelecting(false);
    });
    scroller.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tile = e.target.closest('.jg-tile');
      if (!tile) return;
      e.preventDefault();               // Space would scroll the grid
      pressEntry(tile.dataset.id, e);
    });
    scroller.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') learnRatio(e.target); }, true);   // load does not bubble
    // The list: a click chooses the row for the preview pane, a double click or Enter opens the window.
    $('#lvRows').addEventListener('click', (e) => {
      const row = e.target.closest('.lv-row');
      if (!row) return;
      if (state.selecting) { pressEntry(row.dataset.id, e); return; }
      state.selectedId = row.dataset.id; state.editing = false;
      renderListView();
    });
    // 列表里也能拉框：换个视图不该换一套操作
    $('#lvRows').addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.lv-row')) return;
      startMarquee(e, $('#lvRows'), '.lv-row');
    });
    $('#lvRows').addEventListener('click', (e) => {
      if (e.target.closest('.lv-row')) return;
      if (state.selecting && !marqueeMoved) setSelecting(false);
    });
    $('#lvRows').addEventListener('dblclick', (e) => { const row = e.target.closest('.lv-row'); if (row && !state.selecting) openDetail(row.dataset.id); });
    $('#lvRows').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.lv-row');
      if (!row) return;
      e.preventDefault();
      if (state.selecting) pressEntry(row.dataset.id, e); else openDetail(row.dataset.id);
    });
    $('#viewSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-view]'); if (b) applyView(b.dataset.view); });
    $('#selectToggle').addEventListener('click', () => setSelecting(!state.selecting));
    $('#bulkBar').addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-bulk]');
      if (!b) return;
      if (b.dataset.bulk === 'all') { for (const x of state.entries) state.picked.add(x.id); renderList(); renderBulk(); return; }
      if (b.dataset.bulk === 'none') { state.picked.clear(); renderList(); renderBulk(); return; }
      if (b.dataset.bulk === 'exit') { setSelecting(false); return; }
      const n = state.picked.size;
      if (!n || !window.confirm(t('confirmDeleteMany', { n }))) return;
      b.disabled = true;
      for (const id of [...state.picked]) await ws.deleteEntry(id);
      state.entries = state.entries.filter((x) => !state.picked.has(x.id));
      setSelecting(false);
      toast(t('deletedN', { n }));
      loadEntries();
    });
    $('#detailModal').addEventListener('click', (ev) => { if (ev.target.closest('[data-close]')) closeDetail(); });
    document.addEventListener('keydown', (ev) => {
      // 多选的键盘约定：Cmd/Ctrl+A 全选、Esc 退出
      if (state.tab === 'entries' && !/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) {
        if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'a') {
          ev.preventDefault();
          if (!state.selecting) setSelecting(true);
          for (const e of state.entries) state.picked.add(e.id);
          renderBulk(); renderList();
          return;
        }
        if (ev.key === 'Escape' && state.selecting) { ev.preventDefault(); setSelecting(false); return; }
      }
      if (ev.key === 'Escape') {
        if (!$('#detailModal').hidden) { closeDetail(); return; }
        if (state.selecting) setSelecting(false);
        return;
      }
      if (state.tab !== 'entries' || state.view !== 'list' || !$('#detailModal').hidden) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      const i = state.entries.findIndex((e) => e.id === state.selectedId);
      const j = Math.min(state.entries.length - 1, Math.max(0, (i < 0 ? 0 : i) + (ev.key === 'ArrowDown' ? 1 : -1)));
      if (!state.entries[j]) return;
      state.selectedId = state.entries[j].id;
      renderListView();
      const row = document.querySelector(`#lvRows .lv-row[data-id="${state.selectedId}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
    // Rows are measured against the width, so a resized window has to be dealt again.
    window.addEventListener('resize', () => { if (state.view === 'grid' && state.tab === 'entries') scheduleGrid(); });
    function detailClick(e) {
      // 点一下那张图，它去自己的窗口里被看——图是用来看的，看图和读它的说明是两件事
      if (e.target.closest('#previewImg')) {
        const cur = currentEntry();
        if (cur && ws.openViewer) ws.openViewer(cur.id);
        return;
      }
      // 这里原来还会往 body 上贴一张全屏的 .lightbox。图片窗口把它取代了，但那段一开始没删，
      // 于是点一下同时发生两件事：开窗口，再贴一张 z-index:20 的大图——它盖住整个主页，
      // 又压在 z-index:60 的详情窗底下，看着正是「详情卡片后面的主页变成了图片」。
      const btn = e.target.closest('[data-action]');
      if (btn) { e.preventDefault(); detailAction(btn.dataset.action, btn); }
    }
    $('#detail').addEventListener('click', detailClick);
    $('#listDetail').addEventListener('click', detailClick);
    $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); runAsk(); });
    // 回车送出，Shift+回车换行。textarea 默认回车就是换行，所以这一条必须自己写；
    // 输入法正在选字时（isComposing）不能算送出，否则打到一半就被发出去了。
    $('#askInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      runAsk();
    });
    $('#askAnswer').addEventListener('click', (e) => { const c = e.target.closest('.cite'); if (c) flashSource(c.dataset.n); });
    $('#askAnswer').addEventListener('click', (e) => { const card = e.target.closest('.citecard'); if (card) openEntry(card.dataset.id); });
    $('#modelCards').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.get) { $('#ollamaModel').value = b.dataset.get; pullModel(); }
      else if (b.dataset.use) useModel(b.dataset.use);
      else if (b.dataset.del) deleteModel(b.dataset.del);
    });
    $('#resumePull').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'btnDropPull') { await ws.forgetPendingPull(); await loadProviderStatus(); return; }
      if (b.dataset.get) { $('#ollamaModel').value = b.dataset.get; pullModel(); }
    });
    // One group at a time. The pet picker is heavy, so it is only built when its group is opened.
    $('#settingsNav').addEventListener('click', (e) => {
      const b = e.target.closest('.sg-btn');
      if (!b) return;
      const g = b.dataset.group;
      for (const x of document.querySelectorAll('.sg-btn')) x.classList.toggle('active', x === b);
      for (const p of document.querySelectorAll('.sg-pane')) p.classList.toggle('active', p.dataset.group === g);
      document.querySelector('.sg-panes').scrollTop = 0;   // 标签行不滚动，所以只需要把内容退回顶部
      if (g === 'ai') loadProviderStatus().catch(() => {});
      if (g === 'capture') loadFfmpeg().catch(() => {});
    });
    $('#btnFfmpegInstall').addEventListener('click', installFfmpeg);

    $('#btnFfmpegRecheck').addEventListener('click', () => loadFfmpeg(true));
    ws.onFfmpegInstall(({ line }) => { const l = $('#ffmpegLog'); l.textContent = `${l.textContent}${line}\n`.slice(-4000); l.scrollTop = l.scrollHeight; });
    loadFfmpeg().catch(() => {});

    const form = $('#settingsForm');
    form.addEventListener('submit', (e) => e.preventDefault());
    const isSetting = (el) => el && el.matches('input, select') && el.id !== 'workspaceDir';
    form.addEventListener('change', (e) => { if (isSetting(e.target)) queueSave(); });
    // 「再加一个」：回车或离开都算加。它不是一个设置项（名单在 allowList 里），所以不能交给上面那条
    const addBox = $('#autoRecordAllowAdd');
    if (addBox) {
      const take = () => { addAllow(addBox.value); addBox.value = ''; };
      addBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } });
      addBox.addEventListener('blur', take);
    }
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (!isSetting(el) || el.tagName !== 'INPUT') return;
      if (el.type === 'password' || el.type === 'checkbox' || el.hasAttribute('list')) return;   // wait for change
      queueSave(700);
    });
    $('#lang1').addEventListener('change', renderSttLanguage);
    $('#lang2').addEventListener('change', renderSttLanguage);
    for (const id of ['#hotkeyRegion', '#hotkeyScreen', '#hotkeyVoice']) $(id).addEventListener('keydown', (e) => {
      e.preventDefault();
      const { mods, key } = keyFromEvent(e);
      if (!key) return;
      if (!mods.length) { $('#hotkeyError').textContent = t('hotkeyNeedsModifier'); return; }
      e.target.value = [...mods, key].join('+');
      queueSave();
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
    ws.onOllamaInstall(({ line, phase, percent }) => {
      appendLog(line);
      const key = { downloading: 'jobInstallDownloading', installing: 'jobInstallInstalling', verifying: 'jobInstallVerifying', done: 'jobInstallDone' }[phase];
      updateJob({ labelKey: key || undefined, percent: phase === 'downloading' ? percent : undefined });
    });
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
    // Shows what this machine can actually answer -- and, the first time, makes macOS ask for the
    // permission, so the user finds out here rather than by noticing records with nothing on them.
    $('#btnContextTest').addEventListener('click', async () => {
      const out = $('#contextStatus');
      out.textContent = '…';
      const r = await ws.contextProbe();
      if (!r || !r.ok) { out.textContent = t('contextNone'); return; }
      out.textContent = r.window
        ? t('contextNow', { app: r.app, window: ` · ${r.window}` })
        : `${t('contextNow', { app: r.app, window: '' })} — ${t('contextNoTitle')}`;
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
      // Ollama's own words ('pulling manifest', a sha256) are true and useless to read; the phase is
      // what someone waiting actually wants, and the megabytes are how they judge whether to wait.
      const key = { preparing: 'jobPullPreparing', downloading: 'jobPullDownloading', verifying: 'jobPullVerifying', finishing: 'jobPullFinishing', done: 'jobPullDone' }[p.phase] || 'jobPullDownloading';
      updateJob({ labelKey: key, params: { model: p.model }, percent: p.percent, received: p.receivedBytes, total: p.totalBytes });
    });
    $('#btnChooseDir').addEventListener('click', async () => {
      const dir = await ws.chooseDir();
      if (dir) { $('#workspaceDir').value = dir; $('#workspaceDir').dataset.chosen = dir; queueSave(); }
    });
    $('#btnOpenDir').addEventListener('click', () => ws.openWorkspaceDir());

    ws.onEntry(({ entry, kind }) => {
      if (!entry) return;
      if (kind === 'delete') {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        if (state.selectedId === entry.id) { state.selectedId = null; state.editing = false; }
      } else {
        if (state.query) { const hay = `${entry.title} ${(entry.tags || []).join(' ')} ${entry.visionLabels || ''} ${entry.text} ${entry.summary}`.toLowerCase(); if (!hay.includes(state.query.toLowerCase()) && !state.entries.some((x) => x.id === entry.id)) return; }
        upsert(entry);
      }
      renderList();
      if (kind === 'delete' && $('#detailModal').hidden === false && !state.selectedId) closeDetail();
      else if (state.selectedId === entry.id && !state.editing) renderDetail();
    });
    ws.onSettings((s) => {
      // don't clobber a form the user is editing; the save handler refreshes explicitly
      if (state.tab === 'settings') { state.settings = s; return; }
      refreshMeta(s);
    });
    ws.onNavigate(({ tab, arg }) => {
      if (tab) switchTab(tab);
      if (tab === 'entries' && arg) {
        // briffy://day/<date> hands over a date, briffy://entry/<id> an id -- both arrive here.
        if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
          state.date = arg; state.selectedId = null;
          loadEntries().then(() => { const sel = $('#dateFilter'); if (sel) sel.value = arg; });
        } else {
          state.selectedId = arg; state.editing = false;
          loadEntries().then(() => { if (state.entries.some((x) => x.id === arg)) openDetail(arg); else { renderList(); renderDetail(); } });
        }
      }
    });
  }

  init().catch((e) => { console.error(e); toast(String(e.message || e)); });
})();
