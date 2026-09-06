// Mock of `window.ob` for browser previews of the first-run flow.
// ?perm=none|mic|all  which permissions are already granted   ?lang=en  英文界面
(() => {
  const q = new URLSearchParams(location.search);
  const perm = q.get('perm') || 'none';
  const granted = { none: {}, mic: { mic: 1 }, all: { mic: 1, screen: 1 } }[perm] || {};
  const state = { mic: granted.mic ? 'granted' : 'not-determined', screen: granted.screen ? 'granted' : 'not-determined' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setupCbs = [];
  window.ob = {
    meta: async () => ({
      ui: q.get('lang') === 'en' ? 'en' : 'zh',
      languages0: 'zh-Hans', languages1: 'en',
      languages: [
        { code: 'zh-Hans', name: '中文（简体）' }, { code: 'zh-Hant', name: '中文（繁體）' },
        { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' },
        { code: 'fr', name: 'Français' }, { code: 'de', name: 'Deutsch' }, { code: 'es', name: 'Español' },
      ],
    }),
    permissions: async () => ({ platform: 'darwin', ...state, grantedTo: 'Electron', packaged: false }),
    grant: async (which) => {
      await sleep(600);
      if (which === 'mic') { state.mic = 'granted'; return { ok: true, status: 'granted' }; }
      // screen recording cannot be granted from inside the app: the settings pane opens and a restart follows
      return { ok: false, status: 'denied', needsRestart: true };
    },
    save: async () => ({ ok: true }),
    summary: async () => ({ configured: false, label: '' }),
    finish: async () => ({ ok: true }),
    onSetup: (cb) => { setupCbs.push(cb); return () => {}; },
    runSetup: async () => {
      const steps = [
        { id: 'detect', label: '检查这台电脑', state: '' },
        { id: 'ocr', label: '准备文字识别', state: '' },
        { id: 'stt', label: '准备语音识别', state: '' },
        { id: 'done', label: '完成', state: '' },
      ];
      const emit = (running) => setupCbs.forEach((cb) => cb({ type: 'state', steps, running }));
      for (const s of steps) {
        s.state = 'run'; emit(true); await sleep(900);
        s.state = 'done'; s.detail = s.id === 'ocr' ? 'PP-OCRv6 small' : s.id === 'stt' ? 'whisper-base' : '';
        emit(true);
      }
      emit(false);
      return { ok: true };
    },
  };
})();
