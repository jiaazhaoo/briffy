// Mock of the preload `window.pet` API for browser previews of the cat. Click cycles through states.
(() => {
  const q = new URLSearchParams(location.search);   // ?skin=logo 换成图库里的标记，看不会动的那一版
  const states = ['idle', 'capturing', 'processing', 'recording', 'success', 'error', 'summary'];
  let i = 0;
  const stateCbs = [];
  window.pet = {
    hover: () => {},          // the shelf is a separate window; nothing to do in the browser preview
    click: () => { i = (i + 1) % states.length; stateCbs.forEach((cb) => cb({ state: states[i], badge: states[i] === 'summary' })); document.title = states[i]; },
    dragStart() {}, dragMove() {}, dragEnd() {}, contextMenu() {}, openWorkspace() {},
    drop: async () => [], pathForFile: () => '', recordingState() {}, submitAudio: async () => null,
    requestMic: async () => true, micDenied() {}, getConfig: async () => ({ micDeviceId: '', avatarBuiltin: q.get('skin') !== 'logo' }), micDevices() {}, micTestResult() {}, log: (...a) => console.log(...a),
    onState: (cb) => stateCbs.push(cb), onCommand() {},
  };
  if (q.get('state')) setTimeout(() => stateCbs.forEach((cb) => cb({ state: q.get('state'), badge: q.get('badge') === '1' })), 50);
  // runs from <head>, so there is no body yet - paint the root instead
  if (q.get('zoom')) { document.documentElement.style.zoom = q.get('zoom'); document.documentElement.style.background = q.get('bg') || '#dfe3ea'; }
})();
