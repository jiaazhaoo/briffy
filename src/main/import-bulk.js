'use strict';
// 把一次性导出的东西整包拖进来：Notion 的 zip、Gmail Takeout 的 mbox、或者一个文件夹。
//
// 这条路存在的理由是**授权太贵**。Gmail 的 gmail.readonly 是受限权限，要给别人用就得过 CASA
// Tier 2 审计（每年一次、六到十二周、几千到几万美元）；Notion 的公开集成必须带 client secret，
// 而 secret 要么打进应用里被人扒出来，要么 briffy 自己养一台服务器——两条都和「东西只在你机器上」冲突。
//
// 导出文件绕开了全部这些：你在 Notion 或 Google 那边点一次导出，把文件拖进来，完事。没有 OAuth、
// 没有 token、没有网络请求、没有审计。代价是它是一次快照而不是持续同步——想要持续的，才需要去填
// 那些凭据。两条路并存，不互相取代。
//
// zip 用系统自带的 unzip，和这个项目里用 pmset、osascript、mdls 是同一类：操作系统本来就有的命令，
// 不是随包夹带的二进制（那条是硬规矩，ffmpeg 就是这么定的）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv', '.html', '.htm', '.json']);
const MAX_TEXT = 20000;           // 一条记录留这么多字够搜了，全文还在原文件里
const SKIP_DIRS = new Set(['__MACOSX', '.git', 'node_modules']);

/** 一个 mbox 里的每一封信。mbox 用行首的 "From " 分隔，正文里出现的会被转义成 ">From "。 */
function* splitMbox(text) {
  const lines = text.split('\n');
  let buf = [];
  for (const line of lines) {
    if (/^From \S+ /.test(line) && buf.length) { yield buf.join('\n'); buf = []; }
    buf.push(line);
  }
  if (buf.length) yield buf.join('\n');
}

/** RFC 2047 的 =?utf-8?B?...?= 编码头，中文主题几乎都是这个样子。 */
function decodeHeader(v) {
  return String(v || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    } catch (_) { return whole; }
  });
}

/** 一封信拆成头和正文。折行的头（下一行以空白开头）要接回去。 */
function parseMessage(raw) {
  const split = raw.indexOf('\n\n');
  const head = split < 0 ? raw : raw.slice(0, split);
  let body = split < 0 ? '' : raw.slice(split + 2);
  const headers = {};
  let last = '';
  for (const line of head.split('\n')) {
    if (/^\s/.test(line) && last) { headers[last] += ` ${line.trim()}`; continue; }
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    last = m[1].toLowerCase();
    headers[last] = m[2];
  }
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  if (enc === 'base64') { try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8'); } catch (_) { /* 原样 */ } }
  else if (enc === 'quoted-printable') {
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (/text\/html/i.test(headers['content-type'] || '') || /<html|<body|<div/i.test(body.slice(0, 400))) {
    body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  }
  return {
    id: (headers['message-id'] || '').replace(/[<>]/g, '') || null,
    subject: decodeHeader(headers.subject) || '(no subject)',
    from: decodeHeader(headers.from),
    to: decodeHeader(headers.to),
    date: headers.date || '',
    body: body.trim().slice(0, MAX_TEXT),
  };
}

/** 一个文件夹里所有值得收的文本文件。 */
function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const d of names) {
    if (d.name.startsWith('.') || SKIP_DIRS.has(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out, depth + 1);
    else if (TEXT_EXT.has(path.extname(d.name).toLowerCase())) out.push(full);
  }
  return out;
}

function unzip(file, into) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/unzip', ['-q', '-o', file, '-d', into], { timeout: 10 * 60 * 1000 },
      (err) => (err ? reject(new Error(`unzip: ${err.message}`)) : resolve(into)));
  });
}

/** Notion 导出的文件名带一串 32 位十六进制 id，读起来是噪音。 */
function titleOf(file) {
  return path.basename(file, path.extname(file)).replace(/\s+[0-9a-f]{32}$/i, '').trim() || path.basename(file);
}

/**
 * 把一个导出物拆成一条条待入库的东西。**只读，不写**——写进工作区是调用方的事，
 * 这样这个文件可以在 node 下直接测。
 * @param {string} src zip、mbox、文件夹，或单个文本文件
 * @param {(item:object)=>void} take
 * @returns {Promise<{kind:string, count:number}>}
 */
async function read(src, take) {
  const st = fs.statSync(src);
  const ext = path.extname(src).toLowerCase();

  if (st.isFile() && (ext === '.mbox' || ext === '.mbx')) {
    const text = fs.readFileSync(src, 'utf8');
    let n = 0;
    for (const raw of splitMbox(text)) {
      if (!raw.trim()) continue;
      const m = parseMessage(raw);
      if (!m.body && !m.subject) continue;
      const at = m.date ? new Date(m.date) : null;
      take({
        id: m.id || `${src}:${n}`,
        title: m.subject,
        text: [m.from && `From ${m.from}`, m.to && `To ${m.to}`, '', m.body].filter(Boolean).join('\n'),
        at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : '',
        origin: 'gmail',
      });
      n++;
    }
    return { kind: 'mbox', count: n };
  }

  if (st.isFile() && ext === '.zip') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-import-'));
    try {
      await unzip(src, tmp);
      const out = await read(tmp, take);
      return { kind: 'zip', count: out.count };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 系统会收 */ }
    }
  }

  const files = st.isDirectory() ? walk(src) : [src];
  let n = 0;
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    if (!text.trim()) continue;
    let at = '';
    try { at = fs.statSync(f).mtime.toISOString(); } catch (_) { /* 用现在 */ }
    take({ id: f, title: titleOf(f), text: text.slice(0, MAX_TEXT), at, origin: 'notion' });
    n++;
  }
  return { kind: st.isDirectory() ? 'folder' : 'file', count: n };
}

/**
 * 拖进来的这个东西，是一包导出，还是就是一个文件？
 *
 * 判断要保守，因为猜错的代价不对称：把一包 Notion 当成文件，用户少了一次方便；把用户想原样
 * 存的 zip 拆开，他丢的是他要的东西。所以只有三种算导出：
 *   文件夹  —— 本来就会被 ingestFiles 整个跳过，拆开是纯赚的
 *   .mbox   —— 没有人会拖一个 mbox 进来是想留个不能搜的黑盒
 *   .zip    —— 只有里面确实是一堆文本（Notion 导出的样子）才算，其它 zip 照旧原样存
 * @returns {Promise<''|'folder'|'mbox'|'zip'>} 空串表示按普通文件处理
 */
async function sniff(src) {
  let st;
  try { st = fs.statSync(src); } catch (_) { return ''; }
  if (st.isDirectory()) return 'folder';
  const ext = path.extname(src).toLowerCase();
  if (ext === '.mbox' || ext === '.mbx') return 'mbox';
  if (ext !== '.zip') return '';
  const names = await new Promise((resolve) => {
    execFile('/usr/bin/unzip', ['-Z', '-1', src], { timeout: 30 * 1000, maxBuffer: 32 * 1024 * 1024 },
      (err, out) => resolve(err ? [] : String(out).split('\n')));
  });
  let text = 0;
  for (const n of names) if (TEXT_EXT.has(path.extname(n.trim()).toLowerCase())) text++;
  return text >= 3 ? 'zip' : '';
}

module.exports = { read, sniff, splitMbox, parseMessage, decodeHeader, walk, titleOf, TEXT_EXT };
