'use strict';
// 问过的那些对话，留在磁盘上。
//
// 在这之前「问」这一页只有 state.chat 一个数组，切到别的页再回来就空了——问过一遍的东西
// 第二天想不起来是怎么问的，也翻不回去。
//
// 为什么不引一个现成的聊天库：查过三个（2026-09-07）。@assistant-ui/react 最活跃但要 React
// 和打包器，而这个渲染层两样都没有；deep-chat 有 CDN 版能直接 script 引，但 378KB 而且用
// shadow DOM，样式得走它自己那套 API，和 paper-ui 会一直打架；@nlux/core 最后一次发布是
// 2024-08-15，死了。更要紧的是**三个都只做渲染，都不做历史**——缺的这一块它们本来就不给。
// 而渲染那一块这一页已经有了（轮次、引用卡片、markdown、会长高的输入框），还是按纸写的。
//
// 存法照着天文件：一条对话一个文件，追加一轮只重写那一个文件，不动别人。
// 列表靠读目录，不另建索引——几百条对话读目录是毫秒级，而一份索引会和真相不同步。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TITLE = 60;
const KEEP_TURNS = 200;        // 一条对话最多留这么多轮，再多就是另一件事了

let store = null;
function init(deps) { store = deps.store; }

function dir() { return path.join(store.workspaceDir, 'chats'); }
function fileFor(id) { return path.join(dir(), `${id}.json`); }
const ok = (id) => /^[a-f0-9-]{8,40}$/i.test(String(id || ''));

/** 标题就是第一句问的话，不过模型。它已经是用户自己写的一句话了，再让模型改写一遍只会更远。 */
function titleOf(turns) {
  const first = (turns || []).find((t) => t && t.question);
  return String((first && first.question) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

function read(id) {
  if (!ok(id)) return null;
  try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch (_) { return null; }
}

function write(chat) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = `${fileFor(chat.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(chat, null, 1));
  fs.renameSync(tmp, fileFor(chat.id));    // 换名是原子的：写到一半被杀不会留下半个文件
  return chat;
}

/** 每条对话的一行摘要，新的在前。正文不读进来——列表只要标题和时间。 */
function list({ limit = 200 } = {}) {
  let files = [];
  try { files = fs.readdirSync(dir()).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    const c = read(f.slice(0, -5));
    if (!c || !c.id) continue;
    out.push({ id: c.id, title: c.title || titleOf(c.turns) || '', at: c.updatedAt || c.createdAt || '', n: (c.turns || []).length });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

function create() {
  const now = new Date().toISOString();
  return write({ id: crypto.randomUUID(), title: '', createdAt: now, updatedAt: now, turns: [] });
}

/**
 * 把一轮问答记上。第一轮同时定下标题。
 * @param {string} id 空的话开一条新的
 * @returns {{chat:object, created:boolean}}
 */
function append(id, turn) {
  let chat = read(id);
  const created = !chat;
  if (!chat) chat = create();
  chat.turns.push(turn);
  if (chat.turns.length > KEEP_TURNS) chat.turns = chat.turns.slice(-KEEP_TURNS);
  if (!chat.title) chat.title = titleOf(chat.turns);
  chat.updatedAt = new Date().toISOString();
  return { chat: write(chat), created };
}

function rename(id, title) {
  const chat = read(id);
  if (!chat) return null;
  chat.title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  chat.updatedAt = new Date().toISOString();
  return write(chat);
}

function remove(id) {
  if (!ok(id)) return false;
  try { fs.unlinkSync(fileFor(id)); return true; } catch (_) { return false; }
}

module.exports = { init, list, read, create, append, rename, remove, titleOf, MAX_TITLE, KEEP_TURNS };
