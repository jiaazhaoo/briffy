'use strict';
(() => {
  const ob = window.ob;
  const $ = (s) => document.querySelector(s);

  const T = {
    zh: {
      setup: '开始使用', next: '继续', back: '上一步', start: '开始用', skip: '跳过', later: '以后再说',
      helloTitle: '把你一天里看到的、听到的都记下来',
      helloSub: '截图、语音、拖进来的文件，都会自动整理进工作区。全部留在这台电脑上。',
      langSub: '这决定文字识别、语音识别和界面语言。第一种语言也是每日摘要的书写语言。',
      permSub: '不给也能用，只是对应的功能会关着。',
      aiSub: '每条记录的标题和每日摘要都由它来写。现在跳过也行，之后在设置里随时能配。',
      engineSub: '文字识别和语音识别都在这台电脑上跑，不联网。第一次需要准备一下。',
      footNote: '全部存在这台电脑上 · 随时可以在设置里关掉任何一项',
      langTitle: '你平时用哪两种语言？', lang1: '语言 1', lang2: '语言 2',
      permTitle: '两项权限，打开全部能力',
      permMic: '听你说的话', permMicWhy: '录一段语音，自动转成文字',
      permScreen: '看你屏幕上的东西', permScreenWhy: '截图并识别里面的文字',
      grant: '去授权 →', granted: '已授权', denied: '已拒绝', opening: '正在打开系统设置…',
      permRestart: '在系统设置里打开开关后，需要重启一次 briffy 才生效。',
      permDev: '注意：现在是从源码运行，系统设置里要找的是「{name}」而不是 briffy。',
      permSkip: '不给也能用——录音和截图会关着，其它照常。',
      aiTitle: '谁来读这些记录？',
      aiOpenrouter: 'OpenRouter', aiOpenrouterWhy: '浏览器授权一次，模型任选',
      aiLocal: '本机模型', aiLocalWhy: '完全离线，需要装 Ollama',
      aiNone: '先不配', aiNoneWhy: '标题退回文件名',
      engineTitle: '正在准备本机引擎',
      doneTitle: '好了', doneSub: 'briffy 已经在屏幕右下角了。{ai}',
      doneAiOn: 'AI 服务：{label}。', doneAiOff: '还没配 AI 服务，随时可以在设置里补上。',
      gClick: '<b>单击 briffy</b> 截整个屏幕', gDouble: '<b>双击 briffy</b> 框选截图',
      gMiddle: '<b>中键或长按</b> 开始 / 结束录音', gDrop: '<b>把文件拖到 briffy 身上</b> 存进工作区',
      gRight: '<b>右键 briffy</b> 打开工作区和设置',
    },
    en: {
      setup: 'setup', next: 'Continue', back: 'Back', start: 'Start using it', skip: 'Skip', later: 'Later',
      helloTitle: 'Keep what you saw and heard today',
      helloSub: 'Screenshots, voice notes and anything you drop on it go into the workspace. All of it stays on this computer.',
      langSub: 'This drives text recognition, speech recognition and the interface. The first one is also what the daily summary is written in.',
      permSub: 'It works without them; the matching features just stay off.',
      aiSub: 'It writes the title and the daily summary for every record. Skipping is fine — Settings has it whenever you want.',
      engineSub: 'Text and speech recognition both run on this machine, offline. The first run has to prepare them.',
      footNote: 'Everything stays on this computer · any of it can be switched off in Settings',
      langTitle: 'Which two languages do you use?', lang1: 'Language 1', lang2: 'Language 2',
      permTitle: 'Two permissions turn everything on',
      permMic: 'Hear what you say', permMicWhy: 'Record a voice note and turn it into text',
      permScreen: 'See what is on your screen', permScreenWhy: 'Capture the screen and read the text in it',
      grant: 'Grant →', granted: 'granted', denied: 'denied', opening: 'Opening System Settings…',
      permRestart: 'After you flip the switch in System Settings, briffy has to be restarted for it to take effect.',
      permDev: 'Note: running from source, so the entry to look for is "{name}", not briffy.',
      permSkip: 'It works without these — recording and capture stay off, everything else is fine.',
      aiTitle: 'Who reads these records?',
      aiOpenrouter: 'OpenRouter', aiOpenrouterWhy: 'Authorise once in the browser, any model',
      aiLocal: 'A local model', aiLocalWhy: 'Fully offline, needs Ollama',
      aiNone: 'Not now', aiNoneWhy: 'Titles fall back to the file name',
      engineTitle: 'Getting this machine ready',
      doneTitle: 'Ready', doneSub: 'briffy is in the bottom-right corner. {ai}',
      doneAiOn: 'AI service: {label}.', doneAiOff: 'No AI service yet — you can add one in Settings anytime.',
      gClick: '<b>Click briffy</b> to capture the whole screen', gDouble: '<b>Double-click</b> to drag a box',
      gMiddle: '<b>Middle-click or long press</b> to start / stop recording', gDrop: '<b>Drop files on it</b> to save them',
      gRight: '<b>Right-click</b> for the workspace and settings',
    },
  };
  let ui = 'zh';
  const t = (k, p) => {
    let s = (T[ui] && T[ui][k]) || T.en[k] || k;
    if (p) for (const [a, b] of Object.entries(p)) s = s.split(`{${a}}`).join(String(b));
    return s;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ORDER = ['hello', 'lang', 'perm', 'ai', 'engine', 'done'];
  const state = { i: 0, meta: null, perms: null, provider: '', engineDone: false };

  function applyI18n() {
    document.documentElement.lang = ui === 'zh' ? 'zh-Hans' : ui;   // the CJK faces pick their glyph forms from this
    // A key with no translation keeps whatever the markup already said, rather than showing its own name.
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const k = el.dataset.i18n;
      const dict = T[ui] || T.en;
      if (dict[k] !== undefined) el.textContent = dict[k];
      else if (T.en[k] !== undefined) el.textContent = T.en[k];
    }
  }

  function paintHeader() {
    $('#steps').innerHTML = ORDER.map((_, i) =>
      `<i class="${i < state.i ? 'done' : i === state.i ? 'now' : ''}"></i>`).join('');
    $('#count').textContent = `${state.i + 1} / ${ORDER.length}`;
    $('#btnBack').hidden = state.i === 0;
    const last = state.i === ORDER.length - 1;
    $('#btnNext').textContent = last ? t('start') : (ORDER[state.i] === 'perm' ? t('next') : t('next'));
    // Nothing to do on the engine step but wait, so the way forward opens when it is finished.
    $('#btnNext').disabled = ORDER[state.i] === 'engine' && !state.engineDone;
  }

  function show(i) {
    state.i = Math.max(0, Math.min(ORDER.length - 1, i));
    for (const el of document.querySelectorAll('.step')) el.classList.toggle('active', el.dataset.step === ORDER[state.i]);
    paintHeader();
    if (ORDER[state.i] === 'perm') refreshPerms();
    if (ORDER[state.i] === 'engine') startEngines();
    if (ORDER[state.i] === 'done') paintDone();
  }

  // ---------- permissions ----------
  // Two permissions that behave nothing alike: the microphone can be asked for, screen recording can
  // only be pointed at. The card says which of those is about to happen before it happens.
  const PERMS = [
    { id: 'mic', icon: '🎙️', title: 'permMic', why: 'permMicWhy' },
    { id: 'screen', icon: '🖥️', title: 'permScreen', why: 'permScreenWhy' },
  ];
  function nextUngranted() {
    const p = state.perms || {};
    return (PERMS.find((x) => p[x.id] !== 'granted') || {}).id || '';
  }
  function renderPerms() {
    const p = state.perms || {};
    const now = nextUngranted();
    $('#permCards').innerHTML = PERMS.map((x) => {
      const st = p[x.id] || 'unknown';
      const ok = st === 'granted';
      const cls = ok ? 'granted' : x.id === now ? 'now' : 'idle';
      const right = ok
        ? `<span class="state ok">${esc(t('granted'))}</span>`
        : `<button type="button" class="act" data-perm="${x.id}">${esc(t('grant'))}</button>`;
      return `<div class="perm ${cls}">
        <div class="ico">${ok ? '✓' : x.icon}</div>
        <div><div class="t">${esc(t(x.title))}</div><div class="d">${esc(t(x.why))}</div></div>
        ${right}
      </div>`;
    }).join('');
    const note = $('#permNote');
    if (!now) { note.textContent = ''; note.className = 'note'; return; }
    note.className = 'note';
    note.textContent = state.perms && !state.perms.packaged
      ? t('permDev', { name: state.perms.grantedTo }) : t('permSkip');
  }
  async function refreshPerms() {
    state.perms = await ob.permissions();
    renderPerms();
  }

  // ---------- provider ----------
  const CHOICES = [
    { id: 'openrouter', t: 'aiOpenrouter', w: 'aiOpenrouterWhy' },
    { id: 'ollama', t: 'aiLocal', w: 'aiLocalWhy' },
    { id: '', t: 'aiNone', w: 'aiNoneWhy' },
  ];
  function renderChoices() {
    $('#aiChoices').innerHTML = CHOICES.map((c) =>
      `<button type="button" class="choice${c.id === state.provider ? ' on' : ''}" data-ai="${c.id}">
        <b>${esc(t(c.t))}</b><span>${esc(t(c.w))}</span></button>`).join('');
  }

  // ---------- engines ----------
  let engineStarted = false;
  function renderEngine(steps) {
    $('#engineSteps').innerHTML = (steps || []).map((s) =>
      `<li class="${s.state || ''}"><span class="dot"></span><span>${esc(s.label)}</span>
       <span class="detail">${esc(s.detail || '')}</span></li>`).join('');
  }
  async function startEngines() {
    if (engineStarted) return;
    engineStarted = true;
    // setup.js reports { type: 'state', steps, percent, current, running } and a stream of log lines.
    ob.onSetup((p) => {
      if (!p || p.type !== 'state') return;
      renderEngine(p.steps);
      if (p.running === false) { state.engineDone = true; paintHeader(); }
    });
    try { await ob.runSetup(); } catch (_) { /* the report already showed what failed */ }
    state.engineDone = true;
    paintHeader();
  }

  // briffy draws itself on the two steps that have a picture on them: the first one, where it is
  // introducing itself, and the last one, where it says the setup worked. See assets/brand/briffy-anim.js.
  const faces = {};
  for (const id of ['obHello', 'obDone']) {
    const box = document.getElementById(id);
    if (box && window.briffyAnim) faces[id] = window.briffyAnim.attach(box);
  }

  async function paintDone() {
    if (faces.obDone) faces.obDone.poke('success');   // 到了这一页就点个头；再回来一次就再点一次
    const s = await ob.summary();
    $('#doneSub').textContent = t('doneSub', {
      ai: s.configured ? t('doneAiOn', { label: s.label }) : t('doneAiOff'),
    });
    $('#gestures').innerHTML = ['gClick', 'gDouble', 'gMiddle', 'gDrop', 'gRight']
      .map((k) => `<li>${t(k)}</li>`).join('');
  }

  // ---------- wiring ----------
  $('#permCards').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-perm]');
    if (!b) return;
    b.disabled = true;
    const note = $('#permNote');
    const r = await ob.grant(b.dataset.perm);
    state.perms = await ob.permissions();
    renderPerms();
    if (r && r.needsRestart) { note.className = 'note warn'; note.textContent = t('permRestart'); }
  });
  $('#aiChoices').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ai]');
    if (!b) return;
    state.provider = b.dataset.ai;
    renderChoices();
  });
  $('#btnBack').addEventListener('click', () => show(state.i - 1));
  $('#btnNext').addEventListener('click', async () => {
    const step = ORDER[state.i];
    if (step === 'lang') await ob.save({ languages: [$('#lang1').value, $('#lang2').value] });
    if (step === 'ai' && state.provider) await ob.save({ provider: state.provider });
    if (step === 'done') { await ob.finish(state.provider); return; }
    show(state.i + 1);
  });
  // the app is watched from a distance while it prepares; keep the permission page honest if the user
  // grants something in System Settings without coming back
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ORDER[state.i] === 'perm') refreshPerms(); });
  window.addEventListener('focus', () => { if (ORDER[state.i] === 'perm') refreshPerms(); });

  (async () => {
    state.meta = await ob.meta();
    ui = state.meta.ui === 'zh' ? 'zh' : 'en';
    applyI18n();
    const opts = (sel, cur) => {
      sel.innerHTML = state.meta.languages.map((l) =>
        `<option value="${l.code}"${l.code === cur ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    };
    opts($('#lang1'), state.meta.languages0);
    opts($('#lang2'), state.meta.languages1);
    state.provider = '';
    renderChoices();
    show(0);
  })();
})();
