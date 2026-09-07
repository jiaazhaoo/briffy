'use strict';
// Which picture stands in for briffy outside its own window: the workspace sidebar and the
// notification icon.
//
// There used to be a picker here -- a snapshot of ipaslogo.com's 3448 free marks, browsed in
// settings, one of them downloaded into userData and worn in a round frame. It went on 2026-09-06
// along with the frame itself: the pet draws itself now (assets/brand/briffy-anim.js), and a
// gallery of pictures it can no longer become is a panel that does nothing when you click it.
// What is left is the bundled picture and the one a user may have picked back when they could.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'pet');
const BUILTIN = path.join(ASSETS, 'avatar.png');

function userFile() { return path.join(app.getPath('userData'), 'pet-avatar.png'); }

// The picked picture lives in userData; the bundled one is the fallback and is
// read-only once the app is packaged.
function file(store) {
  const picked = userFile();
  return store.getSettings().petAvatar && fs.existsSync(picked) ? picked : BUILTIN;
}

function isBuiltin(store) { return file(store) === BUILTIN; }

function url(store) {
  const f = file(store);
  let stamp = 0;
  try { stamp = fs.statSync(f).mtimeMs; } catch (_) { /* falls back to 0 */ }
  return `${pathToFileURL(f).href}?v=${Math.round(stamp)}`;   // ?v busts the renderer's image cache
}

module.exports = { url, file, isBuiltin };
