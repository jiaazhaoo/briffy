'use strict';
// 出门前把秘密盖掉。
//
// **原件一个字都不改。** 你存下来的截图、识别出来的文字、转写出来的话，永远是它本来的样子——
// 这条和「采集的原件从不翻译、不改写」是同一条。这里做的是另一件事：**离开这台电脑的那一份**
// 里，把卡号、密钥、身份证号换成一个占位词。今天唯一会离开的路是模型调用（「问」、每日摘要、
// 重新处理、一键翻译，见 llm.js），以后有了同步和分享也走这一层。
//
// 判据全是**确定性的**，没有模型：
//   · 银行卡    Luhn 校验位 + 13~19 位 + 首位 2~6（发卡行号段）
//   · 身份证    18 位加权校验位 + 出生日期真的存在
//   · IBAN      mod-97 校验
//   · 密钥      各家自己的形状（sk- / AKIA / ghp_ / xox?- / AIza / JWT / PEM）
//   · 写着名字的秘密   password: xxx、密码：xxx、验证码 123456
//   · 联系方式  邮箱、手机号（只在最严那一档）
//
// 为什么不用模型认：入库不跑模型这条规矩在这儿一样算数（它要在每次提问前跑），而且模型认隐私
// 是概率性的——一次漏掉就是真的漏出去了。校验位不会。Presidio（微软那套开源脱敏）走的也是
// 这条路：正则 + 校验位 + 上下文词，模型只是可选的第四层。
//
// 三档，默认中间那档：
//   off      不动。
//   secrets  盖掉**秘密**：密钥、卡号、身份证、写着名字的密码和验证码。默认。
//            这一档不碰邮箱和电话——盖了它们，「他电话多少」「谁给我发的邮件」就答不出来了，
//            而那正是这个软件存在的理由。
//   all      再加上邮箱和手机号。给「我的记录里全是客户资料」那种人。
//
// 纯函数，node 直接跑得起来（见 dev/redact-test.js）。
const LEVELS = ['off', 'secrets', 'all'];

// 占位词是英文的：读它的是模型，而系统提示词也是英文。模型偶尔会把它抄进答案里，
// 那时用户看到的是「[card number]」——看得懂，而且它说的正是实话。
const LABEL = {
  card: '[card number]',
  id: '[id number]',
  iban: '[iban]',
  key: '[api key]',
  pem: '[private key]',
  secret: '[secret]',
  code: '[code]',
  email: '[email]',
  phone: '[phone]',
};

// ── 校验位 ────────────────────────────────────────────────────────────────

/** 银行卡号的校验位。@param {string} s 只有数字 */
function luhn(s) {
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// 中国大陆身份证第 18 位：前 17 位各自乘一个权重，和对 11 取余查表。
const ID_W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = '10X98765432';
function idOk(s) {
  const body = s.slice(0, 17);
  if (!/^\d{17}$/.test(body)) return false;
  // 出生日期得真的存在。光有校验位的话，随便一串 18 位数字有 1/11 会蒙对；
  // 加上「第 7~14 位是 1900 年以后的一个真日期」，蒙对的概率就小到可以不管了。
  const y = +body.slice(6, 10);
  const m = +body.slice(10, 12);
  const d = +body.slice(12, 14);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (body.charCodeAt(i) - 48) * ID_W[i];
  return ID_CHECK[sum % 11] === s[17].toUpperCase();
}

/** IBAN 的 mod-97：搬到末尾、字母换成数字、整个数除以 97 应该余 1。 */
function ibanOk(raw) {
  const s = raw.replace(/[ -]/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
    if (v < 0 || v > 35) return false;
    rem = (rem * (v > 9 ? 100 : 10) + v) % 97;
  }
  return rem === 1;
}

// ── 认 ────────────────────────────────────────────────────────────────────
//
// 每条规则是 {kind, re, ok?}：re 找形状，ok 拿校验位确认。没有 ok 的那几条，形状本身就够独特
// （AKIA 后面十六个大写字母不会是别的东西）。

// 卡号只按**人真的会怎么写**来找：连着一串，或者四个一组用同一个分隔符。
// 不写成「13~19 位数字中间随便夹分隔符」是有理由的：识别糊了的截图里满是
// 「00 0 Q 日 0 0 0」这种，那种写法会把它们也捞进来，再撞上 1/10 的 Luhn 就是一次误伤。
const CARD_PLAIN = /(?<![\d.])\d{13,19}(?![\d.])/g;
const CARD_GROUP = /(?<![\d.])\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}(?![\d.])/g;
const CARD_AMEX = /(?<![\d.])\d{4}([ -])\d{6}\1\d{5}(?![\d.])/g;

const RULES = [
  // ── 密钥：形状就是身份，不需要校验位
  { kind: 'pem', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: 'key', re: /\bsk-(?:ant|or|proj|live|test)?-?[A-Za-z0-9_-]{20,}/g },   // OpenAI / Anthropic / OpenRouter / Stripe
  { kind: 'key', re: /\b(?:pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },            // Stripe 的另外两种
  { kind: 'key', re: /\bAKIA[0-9A-Z]{16}\b/g },                                  // AWS
  { kind: 'key', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },                        // GitHub
  { kind: 'key', re: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },                          // GitLab
  { kind: 'key', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },                      // Slack
  { kind: 'key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },                             // Google
  { kind: 'key', re: /\bhf_[A-Za-z0-9]{30,}\b/g },                               // Hugging Face
  { kind: 'key', re: /\bnpm_[A-Za-z0-9]{30,}\b/g },                              // npm
  { kind: 'key', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },   // JWT

  // ── 写着自己名字的秘密。「password: hunter2」——名字就在旁边，不用猜。
  //    值取到行尾或者引号收口；太短的不算（「password: 」后面跟一句话不是密码）。
  //    名字前面容一段前缀，为的是 access_token= / refresh_token= / xsec_token= 这些是**故意**命中的，
  //    不是靠「token」正好是它的后半截撞上的——网址里带着令牌是真的会漏出去的一种。
  { kind: 'secret', re: /((?:[A-Za-z][A-Za-z0-9]*[_-])?(?:password|passwd|passphrase|api[\s_-]?key|secret|token)|授权码|口令|密码)(\s*[:：=]\s*)(["']?)([^\s"'\n]{6,120})\3/gi, group: 4, urlCut: true },
  //    验证码：中间容得下「是」「为」「is」这类字，但不容得下换行。
  { kind: 'code', re: /((?:验证码|校验码|动态码|verification code|security code|one[\s-]?time code|OTP)[^\n\d]{0,12})(\d{4,8})(?!\d)/gi, group: 2 },

  // ── 号码：形状 + 校验位
  { kind: 'card', re: CARD_AMEX, ok: cardOk, notInUrl: true },
  { kind: 'card', re: CARD_GROUP, ok: cardOk, notInUrl: true },
  { kind: 'card', re: CARD_PLAIN, ok: cardOk, notInUrl: true },
  { kind: 'id', re: /(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g, ok: idOk, notInUrl: true },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, ok: ibanOk, notInUrl: true },

  // ── 联系方式，只在最严那一档
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, strict: true },
  //    中国大陆手机、英国手机、+ 开头的国际号、美式括号写法。都要求前后不是数字。
  { kind: 'phone', re: /(?<![\d+])1[3-9]\d{9}(?![\d])/g, strict: true },
  { kind: 'phone', re: /(?<![\d+])07\d{3}[ -]?\d{6}(?![\d])/g, strict: true },
  { kind: 'phone', re: /\+\d{1,3}[ -]?(?:\d[ -]?){7,13}\d/g, strict: true },
  { kind: 'phone', re: /\(\d{3}\)[ ]?\d{3}-\d{4}/g, strict: true },
];

/**
 * 网址或者路径里的一截数字不是号码。
 *
 * 这一条是量出来的（2026-09-09，这个工作区）：facebook.com/marketplace/item/5783977545161628、
 * space.bilibili.com/3546387704712130 都是 16 位、都落在发卡行号段里，只是碰巧没过 Luhn——
 * 而 Luhn 每十个就会放过一个。它们是**帖子的编号**，一个网站上有几亿个，迟早有一个过。
 * 代价：真写在网址里的卡号（checkout?card=4111…）会漏掉。那一种少见得多，而且它旁边
 * 通常还写着 card=，那是 secret 那条规则的事。
 */
function inUrl(s, at) {
  let i = at;
  while (i > 0 && !/\s/.test(s[i - 1])) i--;
  return s.slice(i, at).includes('/');
}

/** 卡号：去掉分隔符之后 13~19 位、首位落在发卡行号段（2~6）、Luhn 过。 */
function cardOk(raw) {
  const s = raw.replace(/[ -]/g, '');
  if (s.length < 13 || s.length > 19) return false;
  if (s[0] < '2' || s[0] > '6') return false;   // Visa 4 / MasterCard 2,5 / Amex 3 / Discover·银联 6
  if (/^(\d)\1+$/.test(s)) return false;        // 0000000000000000 之类，Luhn 有时也过
  return luhn(s);
}

// ── 盖 ────────────────────────────────────────────────────────────────────

/**
 * 这段字里有哪些该盖掉的东西。
 * @param {string} text
 * @param {{level?:string}} opts
 * @returns {Array<{kind:string, at:number, len:number}>} 按位置排好、互不重叠
 */
function scan(text, { level = 'secrets' } = {}) {
  const s = String(text || '');
  if (!s || level === 'off') return [];
  const strict = level === 'all';
  const hits = [];
  for (const r of RULES) {
    if (r.strict && !strict) continue;
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(s)) !== null) {
      if (m[0] === '') { r.re.lastIndex++; continue; }
      // group：只盖值，不盖它前面那个「password:」——盖了标签，模型就不知道这里本来是什么了
      const g = r.group || 0;
      let val = m[g];
      if (!val) continue;
      const at = g ? m.index + m[0].indexOf(val, (m[1] || '').length) : m.index;
      // 网址里 & 是下一个参数的开头，不是密码的一部分。在正文里它可以是——所以只在网址里断。
      if (r.urlCut && inUrl(s, at) && val.includes('&')) val = val.slice(0, val.indexOf('&'));
      if (val.length < 6 && r.urlCut) continue;
      if (r.ok && !r.ok(val)) continue;
      if (r.notInUrl && inUrl(s, at)) continue;
      hits.push({ kind: r.kind, at, len: val.length });
    }
  }
  // 重叠的只留一个：先按起点，起点相同留长的。一串 JWT 里面可能又长得像别的东西。
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  const out = [];
  let end = -1;
  for (const h of hits) {
    if (h.at < end) continue;
    out.push(h);
    end = h.at + h.len;
  }
  return out;
}

/**
 * 把该盖的盖掉。**返回的是一份新的字，原来那份不动。**
 * @param {string} text
 * @param {{level?:string}} opts
 * @returns {{text:string, hits:Object<string,number>, n:number}} hits 是按种类数的个数
 */
function mask(text, { level = 'secrets' } = {}) {
  const s = String(text || '');
  const found = scan(s, { level });
  if (!found.length) return { text: s, hits: {}, n: 0 };
  const hits = {};
  let out = '';
  let at = 0;
  for (const h of found) {
    out += s.slice(at, h.at) + (LABEL[h.kind] || '[redacted]');
    at = h.at + h.len;
    hits[h.kind] = (hits[h.kind] || 0) + 1;
  }
  out += s.slice(at);
  return { text: out, hits, n: found.length };
}

/** 「隐去 3 处：卡号 ×1、密钥 ×2」——写进日志用的一句话。 */
function summary(hits) {
  const parts = Object.entries(hits || {}).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`);
  return parts.join('、');
}

/** 设置里那个值，认不出来就用默认那档。 */
function levelOf(settings) {
  const v = String((settings || {}).redact || '');
  return LEVELS.includes(v) ? v : 'secrets';
}

module.exports = { mask, scan, summary, levelOf, luhn, idOk, ibanOk, cardOk, inUrl, LEVELS, LABEL };
