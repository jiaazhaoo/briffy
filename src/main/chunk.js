'use strict';
// 把一条记录切成能喂给向量模型的几块。
//
// 切块不是优化，是必须的。这个模型一次只读 128 个 token——一条一万三千字的网页，不切的话它
// 只会被自己的**开头**代表，而存下来的网页开头永远是语言选择、Cookie 提示和 Checkout 面包屑。
// 那正是这个项目里已经栽过一次的坑（见 llm.js 的 windowAround）。
//
// 这里也是 dev/semantic-bench.js 用的那一份，所以基准跑的和线上跑的是同一套切法。
const crypto = require('crypto');

const CHUNK = 220;          // 一块大约这么多字符：128 token 中文装 100 出头，英文多些
const OVERLAP = 40;         // 块之间叠一点，别把一句话从中间切断
const MAX_CHUNKS = 10;      // 一条记录最多切这么多块，够覆盖前两千字
const MIN_CHARS = 8;        // 比这还短的块没有意义

/** 拿去做向量的那段字。标题排在最前面——它常常就是答案本身（「Ollama 地址」「Dell ultrawide…」）。 */
function textOf(entry) {
  const e = entry || {};
  const head = String(e.title || '').trim();
  const body = String(e.text || e.summary || '').replace(/\s+/g, ' ').trim();
  return (head && body ? `${head}。${body}` : (head || body)).trim();
}

/** @returns {string[]} */
function chunksOf(entry) {
  const whole = textOf(entry);
  if (!whole) return [];
  const out = [];
  for (let i = 0; i < whole.length && out.length < MAX_CHUNKS; i += (CHUNK - OVERLAP)) {
    const c = whole.slice(i, i + CHUNK);
    if (c.trim().length >= MIN_CHARS) out.push(c);
    if (i + CHUNK >= whole.length) break;
  }
  return out.length ? out : [whole];
}

/**
 * 这条记录的向量还作不作数。
 *
 * 天文件是整体重写的——今天每存一条新东西，整个今天都会被重新索引一遍。要是向量跟着索引里的
 * rowid 走，那每存一次就得把今天已经算过的全部重算。所以按记录 id + 内容指纹认：内容没变，
 * 向量就还是那份。指纹里带上模型和切法，换了模型或改了块长，旧向量自动全部作废。
 */
function hashOf(entry, model) {
  return crypto.createHash('sha1')
    .update(`${model}|${CHUNK}|${OVERLAP}|${MAX_CHUNKS}|${textOf(entry)}`)
    .digest('hex').slice(0, 16);
}

module.exports = { textOf, chunksOf, hashOf, CHUNK, OVERLAP, MAX_CHUNKS };
