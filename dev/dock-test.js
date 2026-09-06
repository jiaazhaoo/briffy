'use strict';
// The Dock tile follows the windows a person actually looks at.
//
//   npx electron dev/dock-test.js
//
// briffy lives in the tray with a cat on the desktop, so it has no business holding a Dock slot most
// of the time. The workspace is different: it is an ordinary window you sit in front of, and while it
// is open the app should be a normal app -- in the Dock, in Cmd+Tab, clickable to come back to.
//
// macOS does roughly this by itself, which is exactly why it is worth a test: nothing in the code used
// to say so, and the first person to hide the Dock icon for the cat's sake would have taken the
// workspace's tile with it and not noticed.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-dock-')));

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Electron quits when the last window closes, and closing the last window is half of what this test
// measures. The real app keeps itself alive for the tray the same way.
app.on('window-all-closed', () => { /* stay up, like main.js does */ });

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') { console.log('macOS only'); process.exit(0); }

  const { Store } = require('../src/main/store');
  const windows = require('../src/main/windows');

  const store = new Store();
  store.init();
  store.updateSettings({ setupDone: true, petHidden: true });
  windows.init({ store, typeLabel: (t) => t, shelfStrings: () => ({ open: '', copied: '', empty: '' }) });

  // Electron can set the activation policy but not read it back, and app.dock has no "are you
  // showing?" either. So the check asks macOS about this very process, by pid -- which also keeps it
  // from accidentally measuring the user's own briffy if that happens to be running too.
  //
  // `background only` is true for an app with no Dock tile and no Cmd+Tab entry, false for a normal one.
  const { execFileSync } = require('child_process');
  const inDock = () => {
    const out = execFileSync('osascript', ['-e',
      `tell application "System Events" to get background only of (first process whose unix id is ${process.pid})`],
    { encoding: 'utf8' }).trim();
    return out === 'false' ? 'regular' : 'accessory';
  };
  const policy = inDock;

  windows.syncDock();
  await sleep(300);
  check('with no window open, briffy stays out of the Dock', policy() === 'accessory', `policy=${policy()}`);

  const ws = windows.openWorkspace('entries');
  await sleep(1200);
  check('opening the workspace puts it in the Dock', policy() === 'regular', `policy=${policy()}`);
  check('and the window really is there', !!ws && !ws.isDestroyed(), '');

  // Asking twice must not double anything up or flip it back.
  windows.openWorkspace('entries');
  await sleep(400);
  check('opening it again keeps it there', policy() === 'regular', `policy=${policy()}`);

  ws.close();
  await sleep(1200);
  check('closing the workspace takes the tile away again', policy() === 'accessory', `policy=${policy()}`);

  // And the whole way round a second time, because a one-shot flag would pass the first lap only.
  const ws2 = windows.openWorkspace('entries');
  await sleep(1200);
  check('a second open brings it back', policy() === 'regular', `policy=${policy()}`);
  ws2.close();
  await sleep(1200);
  check('a second close removes it', policy() === 'accessory', `policy=${policy()}`);

  // Onboarding is an ordinary window too, and on a first run it is the only one there is.
  const ob = windows.openOnboarding();
  await sleep(1200);
  check('the first-run window counts as well', policy() === 'regular', `policy=${policy()}`);
  ob.close();
  await sleep(1200);
  check('and gives the tile back when it closes', policy() === 'accessory', `policy=${policy()}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
