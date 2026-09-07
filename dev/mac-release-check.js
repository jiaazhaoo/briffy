// Checks a built macOS app the way Gatekeeper and Apple's notary service will, before a user does.
//
// Everything here is a thing that looks fine on a developer's machine and breaks on someone else's:
// a native .dylib nobody signed, an entitlement the build forgot (briffy asks macOS which window you
// were looking at -- without com.apple.security.automation.apple-events that call returns nothing and
// says nothing), a ticket that was never stapled so the app only opens while the network is up.
//
//   node dev/mac-release-check.js [path/to/briffy.app]
//   node dev/mac-release-check.js --preflight     # before the build: certificate + notarisation env
//
// With no argument it finds the newest .app under release/. Exit code is 1 if any check fails, so this
// can sit at the end of `npm run release:mac`.
const { execFileSync, execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEAM = '5B88JH77HT';
const BUNDLE_ID = 'com.briffy.app';

// Entitlements that must be in the signature, not merely in build/entitlements.mac.plist: codesign
// silently ignores a file it cannot parse, and an app signed without these fails at runtime only.
const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
  'com.apple.security.automation.apple-events',
];

// Info.plist keys the OS reads to decide what to ask the user, and what to say while asking. A missing
// purpose string is not cosmetic: App Review rejects on it, and some prompts do not appear at all.
const REQUIRED_INFO = [
  'NSMicrophoneUsageDescription',
  'NSAppleEventsUsageDescription',
  'NSDesktopFolderUsageDescription',
  'NSDocumentsFolderUsageDescription',
  'NSDownloadsFolderUsageDescription',
  'LSMinimumSystemVersion',
];

let failures = 0;
let skipped = 0;
function ok(label, detail) { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
function bad(label, detail) { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
function skip(label, detail) { skipped++; console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`); }
function section(name) { console.log(`\n${name}`); }

function run(file, args) {
  // spawnSync, not execFileSync: codesign -dv writes its whole report to stderr and exits 0, and
  // execFileSync hands back stdout only -- which is empty. That reads as "unsigned" for an app that
  // is signed perfectly well, which is the one wrong answer this script must never give.
  const r = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status === null ? -1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` || String((r.error && r.error.message) || '') };
}

function findApp() {
  const given = process.argv[2];
  if (given) return given;
  const release = path.join(__dirname, '..', 'release');
  if (!fs.existsSync(release)) return '';
  const found = [];
  for (const dir of fs.readdirSync(release)) {
    const full = path.join(release, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.app')) found.push(path.join(full, name));
    }
  }
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || '';
}

// --- preflight: run before the build, not after ------------------------------------------------
// electron-builder does not fail when the notarisation credentials are absent. It prints one line --
// `skipped macOS notarization` -- and hands back a .dmg that opens perfectly on this machine and
// nowhere else. Twenty minutes of build time to find out. So `npm run release:mac` asks first.
if (process.argv.includes('--preflight')) {
  const need = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const missing = need.filter((k) => !process.env[k]);
  const id = run('security', ['find-identity', '-v', '-p', 'codesigning']).out;
  console.log('Preflight');
  if (/Developer ID Application:/.test(id)) ok('Developer ID Application certificate');
  else bad('Developer ID Application certificate', 'not in the keychain — nothing can be signed for distribution');
  if (!missing.length) ok('notarisation credentials', need.join(', '));
  else bad(`notarisation credentials missing: ${missing.join(', ')}`, 'the build would skip notarisation silently — see docs/RELEASE.md');
  console.log(`\n${failures ? '✗ not ready to release' : '✓ ready'}`);
  process.exit(failures ? 1 : 0);
}

const app = findApp();
if (!app || !fs.existsSync(app)) {
  console.error('No .app found. Build one first (npm run pack, or npm run dist:mac), or pass a path.');
  process.exit(1);
}
console.log(`Checking ${app}`);

// --- 1. the signature itself -------------------------------------------------------------------
section('Signature');
{
  // --deep walks every nested bundle and Mach-O. Slow (a minute on this app) and the only check that
  // notices one unsigned .dylib three levels down inside app.asar.unpacked.
  const v = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (v.code === 0) ok('codesign --verify --deep --strict');
  else bad('codesign --verify --deep --strict', v.out.trim().split('\n').slice(-4).join(' | '));

  const d = run('codesign', ['-dv', '--verbose=4', app]);
  const info = d.out;
  const authority = (info.match(/^Authority=(.+)$/m) || [])[1] || '';
  if (/^Developer ID Application:/.test(authority)) ok('signed for direct distribution', authority);
  else if (/^Apple Distribution:|^3rd Party Mac Developer/.test(authority)) bad('signed with the Mac App Store identity, not Developer ID', authority);
  else bad('not signed by a distribution identity', authority || 'no Authority line');

  if (info.includes(`TeamIdentifier=${TEAM}`)) ok('team identifier', TEAM);
  else bad('team identifier', (info.match(/TeamIdentifier=(\S+)/) || [])[1] || 'missing');

  if (info.includes(`Identifier=${BUNDLE_ID}`)) ok('bundle identifier', BUNDLE_ID);
  else bad('bundle identifier', (info.match(/^Identifier=(\S+)/m) || [])[1] || 'missing');

  // flags=0x10000(runtime) is the hardened runtime. Notarisation refuses a build without it.
  if (/flags=.*runtime/.test(info)) ok('hardened runtime');
  else bad('hardened runtime', 'flags do not include runtime');

  const ts = (info.match(/Timestamp=(.+)/) || [])[1];
  if (ts) ok('secure timestamp', ts.trim());
  else bad('secure timestamp', 'signed with --timestamp=none? notarisation will reject it');
}

// --- 2. entitlements that were actually embedded -----------------------------------------------
section('Entitlements');
{
  const e = run('codesign', ['-d', '--entitlements', ':-', app]);
  const xml = e.out;
  for (const key of REQUIRED_ENTITLEMENTS) {
    if (xml.includes(key)) ok(key);
    else bad(key, 'not in the signature');
  }
  // A Developer ID build must not be sandboxed: the sandbox would cut off osascript, ffmpeg and the
  // workspace folder outside the container, all of which this build relies on.
  if (xml.includes('com.apple.security.app-sandbox')) bad('com.apple.security.app-sandbox', 'present — this is the Developer ID build, it should not be sandboxed');
  else ok('not sandboxed', 'correct for the Developer ID build');
}

// --- 3. Info.plist -----------------------------------------------------------------------------
section('Info.plist');
{
  const plist = path.join(app, 'Contents', 'Info.plist');
  const read = (key) => {
    try { return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim(); }
    catch (_) { return ''; }
  };
  for (const key of REQUIRED_INFO) {
    const value = read(key);
    if (value) ok(key, value.length > 58 ? `${value.slice(0, 55)}…` : value);
    else bad(key, 'missing');
  }
  // The cat lives in the menu bar and only takes a Dock tile while a window is open (windows.js
  // syncDock). Without LSUIElement a tile appears at launch and is pulled away a moment later.
  if (read('LSUIElement') === 'true' || read('LSUIElement') === '1') ok('LSUIElement', 'starts as a menu-bar app');
  else bad('LSUIElement', 'a Dock tile will flash at launch');

  // briffy:// links have to resolve to this app or every citation in a recap is dead.
  const urls = read('CFBundleURLTypes');
  if (urls.includes('briffy')) ok('CFBundleURLTypes', 'briffy:// registered');
  else bad('CFBundleURLTypes', 'briffy:// not registered');
}

// --- 4. architecture ---------------------------------------------------------------------------
section('Architecture');
{
  const exe = path.join(app, 'Contents', 'MacOS', 'briffy');
  const l = run('lipo', ['-archs', exe]);
  const archs = l.out.trim();
  if (l.code !== 0) bad('main executable', l.out.trim());
  else if (archs === 'arm64') ok('arm64 only', 'Intel Macs are not served by this build — intentional, sherpa-onnx has no darwin-x64 prebuilt');
  else ok('architectures', archs);
}

// --- 5. every Mach-O outside the asar ----------------------------------------------------------
section('Native binaries outside the asar');
{
  // These are the ones that get missed: .node and .dylib sitting in Resources/app.asar.unpacked.
  // --deep above should have caught an unsigned one, but it reports only the first failure, and
  // knowing which of eleven libraries is unsigned is the difference between a fix and a hunt.
  const unpacked = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked');
  if (!fs.existsSync(unpacked)) { skip('app.asar.unpacked', 'not present'); }
  else {
    let list = [];
    try {
      list = execSync(`find "${unpacked}" -type f \\( -name '*.node' -o -name '*.dylib' -o -name '*.so' \\)`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
        .split('\n').filter(Boolean);
    } catch (_) { /* none */ }
    if (!list.length) skip('native binaries', 'none found');
    const unsigned = [];
    for (const f of list) if (run('codesign', ['--verify', '--strict', f]).code !== 0) unsigned.push(path.relative(unpacked, f));
    if (list.length && !unsigned.length) ok(`all ${list.length} signed`, list.map((f) => path.basename(f)).join(', ').slice(0, 90));
    for (const f of unsigned) bad('unsigned', f);
  }
}

// --- 6. notarisation ---------------------------------------------------------------------------
section('Notarisation');
{
  const s = run('xcrun', ['stapler', 'validate', app]);
  if (s.code === 0) ok('ticket stapled', 'opens on a machine that has never seen this app, offline');
  else bad('ticket stapled', 'not notarised yet — expected for `npm run pack`; a release build must pass this');

  // What Gatekeeper will actually decide. -t install is the policy used for a downloaded app.
  const g = run('spctl', ['-a', '-vvv', '-t', 'install', app]);
  if (g.code === 0 && /accepted/.test(g.out)) ok('Gatekeeper', (g.out.match(/source=(.+)/) || [])[1] || 'accepted');
  else bad('Gatekeeper', g.out.trim().split('\n').join(' | ') || 'rejected');
}

console.log(`\n${failures ? '✗' : '✓'} ${failures} failed, ${skipped} skipped`);
process.exit(failures ? 1 : 0);
