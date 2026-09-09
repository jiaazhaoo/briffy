'use strict';
// 一张截图的正文：先问辅助功能那棵树，识别（OCR）当兜底。
//
// screenpipe 的做法（text_source = accessibility | ocr）。理由不是快，是**干净**：全屏截图的 OCR
// 把屏幕上所有的字一视同仁地读下来——菜单栏「File Edit View History」、别的标签页的标题、书签栏、
// 水印——每一张都有，于是它们成了「所有截图共用的词」，把不相干的记录串成一件事。之前靠一张词表挡
// （entity.js 的 CHROME），越挡越长。辅助功能树按**窗口**给字：只读你面前那一扇；浏览器只读网页
// 那一块（AXWebArea），家具根本进不来。
//
// 走的是和 window-list.js 同一座桥：JXA 里 ObjC.bindFunction 直接调 ApplicationServices 的 AX 函数，
// 什么都不用编译、不用打包。System Events 那条路在这里不行——它在 Chrome 上读到的是空树
// （foreground.js 里有账）；原生 AX 调用不一样，先把 AXManualAccessibility 打开（Chrome 和 Electron
// 都认），树就有了。
//
// 2026-09-09 在这台机器上量的（scratchpad/ax-probe.js）：
//   Chrome     一页 622 个节点，网页那块 9420 字，203 ms
//   Safari     170 个节点，2782 字，171 ms——网页在 AXTabGroup 底下，所以不能按角色跳过标签组
//   Terminal   17 个节点，1858 字，86 ms——终端里的字 OCR 从来读不准，这里一字不差
//   Finder     319 个节点，1180 字，254 ms
//   Electron   （briffy 自己）214 个节点，86 ms
//   Claude 桌面版：拿不到窗口，它不开放这棵树。这种就落回 OCR。
//   AXEnhancedUserInterface 也试过：Safari 反而给不出窗口，而且它会改系统的窗口动画。不用。
//
// 树上的字和画面上的字不是一回事：树给的是整份文档（滚出屏幕的也在），画面只有一屏。对搜索和
// 双链这是好事（你看的那一页说了什么）；对「点一下图上的字」不是——所以走了这条路的记录没有
// 字框（ocrBoxes），看图窗里的「文字位置」就不出现。手动重新处理会重新识别，那时换回 OCR。
//
// 只给整屏截图用。框选的那一块是你亲手选的，它的字就该是框里的字。
const { execFile } = require('child_process');
const foreground = require('./foreground');

const MAC = process.platform === 'darwin';
const TIMEOUT_MS = 3000;     // 实测 90–260 ms；到这儿说明那个应用挂了，别陪着等
const MAX_NODES = 4000;      // 一页网页六百来个；四千是「这棵树没完没了」的界
const BUDGET_MS = 1500;      // 走树的上限，到了就带着已有的字回来
const MAX_CHARS = 12000;
// 「够用」的门槛：三行、六十个字母（一个汉字算两个：它是一个词素，不是一个字母）。低于这个——
// 一扇空的 Notes、一个只有「Play / Pause」的播放器——那不是正文，画面上可能还有别的，交给 OCR。
const MIN_LINES = 3;
const MIN_LETTERS = 60;

// 三个 AX 函数要自己绑：桥不认 CFTypeRef* 那个出参（「Ref has incompatible type」），按 id* 绑就通了。
const SCRIPT = `
ObjC.import('Cocoa');
ObjC.import('ApplicationServices');
ObjC.bindFunction('AXUIElementCreateApplication', ['id', ['int']]);
ObjC.bindFunction('AXUIElementCopyAttributeValue', ['int', ['id', 'id', 'id*']]);
ObjC.bindFunction('AXUIElementSetAttributeValue', ['int', ['id', 'id', 'id']]);
function attr(el, name) { const r = Ref(); return $.AXUIElementCopyAttributeValue(el, $(name), r) === 0 ? r[0] : null; }
function str(v) { if (!v) return ''; try { const s = ObjC.unwrap(v); return typeof s === 'string' ? s : ''; } catch (e) { return ''; } }
function kids(el) { const v = attr(el, 'AXChildren'); if (!v) return []; try { return ObjC.unwrap(v) || []; } catch (e) { return []; } }
const TEXTY = { AXStaticText: 1, AXTextArea: 1, AXTextField: 1, AXHeading: 1, AXLink: 1, AXCell: 1 };
const FURNITURE = { AXToolbar: 1, AXMenuBar: 1 };
function run(argv) {
  const bundleId = argv[0], web = argv[1] === 'web';
  const maxNodes = +argv[2], budgetMs = +argv[3], maxChars = +argv[4];
  const t0 = Date.now();
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(bundleId));
  if (!apps.count) return JSON.stringify({ err: 'not running' });
  const app = $.AXUIElementCreateApplication(apps.objectAtIndex(0).processIdentifier);
  $.AXUIElementSetAttributeValue(app, $('AXManualAccessibility'), $(true));
  let win = attr(app, 'AXFocusedWindow') || attr(app, 'AXMainWindow');
  if (!win) { const ws = attr(app, 'AXWindows'); const arr = ws ? ObjC.unwrap(ws) : null; win = arr && arr.length ? arr[0] : null; }
  if (!win) return JSON.stringify({ err: 'no window', ms: Date.now() - t0 });
  const title = str(attr(win, 'AXTitle'));
  const lines = []; let chars = 0, nodes = 0, prev = '';
  const stack = [[win, false]];
  const deadline = t0 + budgetMs;
  while (stack.length && nodes < maxNodes && chars < maxChars && Date.now() < deadline) {
    const pair = stack.pop(); const el = pair[0]; nodes++;
    const role = str(attr(el, 'AXRole'));
    if (!web && FURNITURE[role]) continue;
    const inWeb = pair[1] || role === 'AXWebArea';
    if (TEXTY[role] && (!web || inWeb)) {
      const v = (str(attr(el, 'AXValue')) || str(attr(el, 'AXTitle'))).trim();
      if (v && v !== prev) { lines.push(v); chars += v.length; prev = v; }
    }
    const ch = kids(el);
    for (let i = ch.length - 1; i >= 0; i--) stack.push([ch[i], inWeb]);
  }
  return JSON.stringify({ title: title, text: lines.join('\\n'), nodes: nodes, ms: Date.now() - t0, cut: stack.length > 0 });
}
`;

/**
 * 那个应用最前面那扇窗里的字。
 * @param {{bundleId:string, browser?:boolean}} o
 * @returns {Promise<{text:string,title:string,nodes:number,ms:number,cut:boolean}|null>} 拿不到就 null，
 *   不报错：没授权（辅助功能）、应用不开放这棵树、超时，对采集来说都只是「换 OCR」。
 */
function read({ bundleId, browser = false }) {
  if (!MAC || !bundleId || !foreground.isEnabled()) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, String(bundleId), browser ? 'web' : 'all',
      String(MAX_NODES), String(BUDGET_MS), String(MAX_CHARS)],
    { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 24 },
    (err, stdout) => {
      if (err) { resolve(null); return; }
      let r; try { r = JSON.parse(stdout); } catch (_) { resolve(null); return; }
      resolve(r && !r.err && r.text ? r : null);
    });
  });
}

/** briffy 后面那个应用（截图那一刻 briffy 自己在前台，见 foreground.frontApp）。 */
async function readFront({ skipSelf = true } = {}) {
  if (!MAC || !foreground.isEnabled()) return null;
  const front = await foreground.frontApp({ skipSelf });
  if (!front || !front.bundleId) return null;
  return read({ bundleId: front.bundleId, browser: foreground.BROWSER_BUNDLES.has(front.bundleId) });
}

/** 这些字够不够当正文（够了就不再识别）。 */
function enough(text) {
  const t = String(text || '');
  const lines = t.split('\n').filter((l) => /\p{L}/u.test(l)).length;
  const letters = (t.match(/\p{L}/gu) || []).length + (t.match(/[\u3400-\u9fff]/g) || []).length;
  return lines >= MIN_LINES && letters >= MIN_LETTERS;
}

// 截图那一刻问的，处理那一刻才用：记录先存，树的答案几百毫秒后到，处理排队也是几百毫秒后开始。
const held = new Map();   // entryId -> Promise
function hold(id, promise) { if (id && promise) held.set(id, promise); }
/** @returns {Promise<{text:string,title:string}|null>} 够用的正文，否则 null（该走 OCR 了） */
async function take(id) {
  const p = held.get(id);
  if (!p) return null;
  held.delete(id);
  const r = await p.catch(() => null);
  return r && enough(r.text) ? r : null;
}

module.exports = { read, readFront, enough, hold, take, MIN_LINES, MIN_LETTERS };
