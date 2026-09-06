'use strict';
// Scrolling somebody else's window, by a known amount.
//
// This exists because of a specific failure. The long screenshot used to watch the user scroll and work
// out how far the content had moved by comparing one frame with the next. That cannot be made to work.
// Real interfaces are periodic -- rows, cards, list items, message bubbles, all near-identical -- so a
// join one whole card too far down looks very nearly as good as the right one, and no amount of
// "is the best match distinct enough" testing separates them. Measured on an ordinary page of repeated
// sections: the matcher locked onto the wrong period and spliced the same two sections in over and
// over, turning 90 px of real scrolling into 7445 px of picture. Silently. The earlier test that passed
// used random noise, which is the easiest case correlation will ever meet, and proved nothing.
//
// The way out is not a better matcher. It is to stop guessing: if briffy does the scrolling, it knows
// roughly how far the content should have gone, and the search can be confined to that. A wrong period
// then falls outside the window and is refused instead of chosen.
//
// Getting a distance into the event at all took three attempts, so the notes are here rather than lost:
//
//   CGEventCreateScrollWheelEvent(src, unit, wheels, delta)     variadic; the delta never arrives
//                                                                through the JXA bridge. Every event
//                                                                scrolled exactly one viewport, whatever
//                                                                was asked for -- 20 px and 400 px alike.
//   CGEventCreateScrollWheelEvent2(src, unit, wheels, d, 0, 0)  not variadic, and still one viewport a
//                                                                time. Consistent, but not a distance.
//   ...Event2 with the delta written afterwards with              works. 50/100/200/400 px asked came back
//   CGEventSetIntegerValueField                                   as 40/80/160/320 -- a flat 0.8, which is
//                                                                 all this needs.
//
// It is 0.8 and not 1.0 because Chromium reads the line-unit field (×8 px a line) rather than the pixel
// one; other apps read the pixel field. Both are set, and the caller measures what it actually got, so
// neither the factor nor which field an app prefers has to be known in advance.
//
// One osascript is kept alive for the whole shot and fed one line per step, because starting one costs
// about 100 ms and a long page is fifty steps.
//
// The cost of admission: posting a CGEvent needs Accessibility, which is a permission briffy does not
// otherwise want. It is asked for at the moment a long shot is started and never before -- see
// `ensure` -- and if it is refused the long shot says so rather than quietly producing a bad picture.
const { spawn } = require('child_process');
const { systemPreferences } = require('electron');

const IDLE_EXIT_MS = 10 * 60 * 1000;   // 驱动进程自己的活命上限

// Read from stdin, post a scroll for each line, answer 'ok'. Blocking reads, no polling.
const DRIVER = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
// NSData 的 length 经过 JXA 桥出来是**字符串**，不是数字。写成 d.length === 0 永远不成立，
// 于是父进程一死、管道关掉之后，availableData 不停返回空数据而循环永远不退出——一个核 100%，
// 实测烧了四个半小时才被发现。数字比较必须先 Number()。
const empty = (d) => !d || Number(d.length) === 0;
// 再加一道保险：长截图最多跑几分钟，超过这个时间没收到任何指令就自己走，
// 免得哪天又因为别的原因没退成。
const DEADLINE = Date.now() + ${IDLE_EXIT_MS};
const inh = $.NSFileHandle.fileHandleWithStandardInput;
const outh = $.NSFileHandle.fileHandleWithStandardOutput;
function reply(s) {
  outh.writeData($.NSString.alloc.initWithUTF8String(s).dataUsingEncoding($.NSUTF8StringEncoding));
}
while (true) {
  if (Date.now() > DEADLINE) break;
  const data = inh.availableData;
  if (empty(data)) break;
  const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)) || '';
  for (const line of text.split('\\n')) {
    const t = line.trim();
    if (!t) continue;
    const p = t.split(' ').map(Number);
    if (p.length < 3 || p.some(isNaN)) { reply('no\\n'); continue; }
    if (p[0] >= 0) $.CGWarpMouseCursorPosition({ x: p[0], y: p[1] });
    const dy = -Math.round(p[2]);
    const e = $.CGEventCreateScrollWheelEvent2($(), 1, 1, 0, 0, 0);
    // 88 kCGScrollWheelEventIsContinuous · 96 PointDeltaAxis1 (pixels) · 11 DeltaAxis1 (lines, 8 px each)
    $.CGEventSetIntegerValueField(e, 88, 1);
    $.CGEventSetIntegerValueField(e, 96, dy);
    $.CGEventSetIntegerValueField(e, 11, Math.round(dy / 8));
    $.CGEventPost(0, e);
    reply('ok\\n');
  }
}
`;

let child = null;
let waiting = [];   // resolvers, one per step in flight
let buf = '';

/** @returns {boolean} whether briffy may post events at all. */
function allowed() {
  if (process.platform !== 'darwin') return false;
  try { return systemPreferences.isTrustedAccessibilityClient(false) === true; } catch (_) { return false; }
}

/**
 * Asks for Accessibility if it is not already granted. The system dialog only appears the first time;
 * afterwards this is a straight read and the user has to go to System Settings themselves.
 * @returns {boolean} whether it is granted **now** -- granting it takes effect without a restart, but
 *   not before the user has actually clicked through, so a false here is normal on the first attempt.
 */
function ensure() {
  if (process.platform !== 'darwin') return false;
  try { return systemPreferences.isTrustedAccessibilityClient(true) === true; } catch (_) { return false; }
}

function open() {
  if (child && !child.killed) return true;
  if (!allowed()) return false;
  try {
    child = spawn('osascript', ['-l', 'JavaScript', '-e', DRIVER], { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (_) { child = null; return false; }
  child.unref();                        // 它不该拖着主进程不让退出
  // 主进程走的时候把它带走。孤儿进程曾经在这里空转了四个半小时。
  process.once('exit', () => { try { child && child.kill('SIGKILL'); } catch (_) { /* 已经没了 */ } });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const done = waiting.shift();
      if (done) done(line === 'ok');
    }
  });
  const gone = () => { child = null; const w = waiting; waiting = []; for (const d of w) d(false); };
  child.on('exit', gone);
  child.on('error', gone);
  return true;
}

/**
 * One step. Warps the pointer to (x, y) first when given one, because a scroll event goes to whatever
 * is under the pointer and the control strip is deliberately in front.
 * The acknowledgement means the event was posted, not that anything moved. Nothing here can know that
 * -- the window may be at the bottom of its content, may not scroll at all, or may have swallowed the
 * event, which Chromium does to the first one after a pause often enough to matter. Whoever calls this
 * has to look at the result and try again.
 *
 * @param {{x?:number, y?:number, dy:number}} step x/y in global screen points; dy in pixels, positive
 *   scrolls the content down (i.e. moves the view further down the page).
 * @returns {Promise<boolean>}
 */
function step({ x = -1, y = -1, dy }) {
  if (!open()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const at = waiting.indexOf(done);
      if (at >= 0) waiting.splice(at, 1);
      resolve(false);
    }, 2000);
    function done(ok) { clearTimeout(timer); resolve(ok); }
    waiting.push(done);
    try { child.stdin.write(`${Math.round(x)} ${Math.round(y)} ${Math.round(dy)}\n`); } catch (_) { done(false); }
  });
}

function close() {
  if (!child) return;
  try { child.stdin.end(); } catch (_) { /* already gone */ }
  try { child.kill(); } catch (_) { /* already gone */ }
  child = null;
  const w = waiting; waiting = [];
  for (const d of w) d(false);
}

module.exports = { allowed, ensure, open, step, close };
