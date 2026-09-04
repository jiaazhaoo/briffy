// Mock of the preload `window.pet` API for browser previews of the cat. Click cycles through states.
(() => {
  const states = ['idle', 'capturing', 'processing', 'recording', 'success', 'error', 'summary'];
  let i = 0;
  const stateCbs = [];
  window.pet = {
    click: () => { i = (i + 1) % states.length; stateCbs.forEach((cb) => cb({ state: states[i], badge: states[i] === 'summary' })); document.title = states[i]; },
    dragStart() {}, dragMove() {}, dragEnd() {}, contextMenu() {}, openWorkspace() {},
    drop: async () => [], pathForFile: () => '', recordingState() {}, submitAudio: async () => null,
    requestMic: async () => true, micDenied() {}, getConfig: async () => ({ micDeviceId: '' }), micDevices() {}, micTestResult() {}, log: (...a) => console.log(...a),
    onState: (cb) => stateCbs.push(cb), onCommand() {},
  };
  const q = new URLSearchParams(location.search);
  if (q.get('state')) setTimeout(() => stateCbs.forEach((cb) => cb({ state: q.get('state'), badge: q.get('badge') === '1' })), 50);
  // runs from <head>, so there is no body yet - paint the root instead
  if (q.get('zoom')) { document.documentElement.style.zoom = q.get('zoom'); document.documentElement.style.background = q.get('bg') || '#dfe3ea'; }
})();
