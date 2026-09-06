'use strict';
// Was briffy even running?
//
// A day with no records is ambiguous, and the two readings are opposites: either nothing was worth
// keeping, or the app was closed and the day was never offered. The daily recap used to say "nothing
// was recorded" for both, which is a lie half the time. So the app leaves a mark for every five-minute
// slot it is awake in -- 288 numbers a day, a few hundred bytes -- and that turns the ambiguity into a
// fact: `off` (never running), `idle` (running, nothing saved), or `ok`.
//
// This records only that briffy itself was alive. It says nothing about what was on screen, which app
// was in front, or whether the machine was in use.
const fs = require('fs');
const path = require('path');
const { localDateKey, writeJsonAtomic, readJson } = require('./store');

const SLOT_MS = 5 * 60 * 1000;
const SLOTS_PER_DAY = (24 * 60) / 5;   // 288
const TICK_MS = 60 * 1000;             // a slot is claimed the moment it is entered, not five minutes late

let store = null;
let timer = null;
let day = '';
let slots = null;      // Set<number> for `day`
let dirty = false;

function init(deps) { store = deps.store; }

function file(dateKey) { return path.join(store.paths().uptime, `${dateKey}.json`); }

function slotOf(d = new Date()) {
  return Math.min(SLOTS_PER_DAY - 1, Math.floor((d.getHours() * 60 + d.getMinutes()) / 5));
}

function loadDay(dateKey) {
  const data = readJson(file(dateKey), null);
  return new Set(Array.isArray(data && data.slots) ? data.slots : []);
}

function flush() {
  if (!dirty || !day || !slots || !store) return;
  try {
    fs.mkdirSync(store.paths().uptime, { recursive: true });
    writeJsonAtomic(file(day), { dateKey: day, slots: [...slots].sort((a, b) => a - b) });
    dirty = false;
  } catch (e) {
    console.warn('[uptime] cannot save', e.message);
  }
}

function mark(now = new Date()) {
  if (!store) return;
  const key = localDateKey(now);
  if (key !== day) { flush(); day = key; slots = loadDay(key); dirty = false; }
  const slot = slotOf(now);
  if (!slots.has(slot)) { slots.add(slot); dirty = true; }
}

function start() {
  stop();
  mark();
  flush();
  timer = setInterval(() => { mark(); flush(); }, TICK_MS);
  if (timer.unref) timer.unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } flush(); }

/** @returns {{slots:number[], minutes:number, firstSlot:number, lastSlot:number}} */
function forDate(dateKey) {
  if (!store) return { slots: [], minutes: 0, firstSlot: -1, lastSlot: -1 };
  const set = dateKey === day && slots ? slots : loadDay(dateKey);
  const list = [...set].sort((a, b) => a - b);
  return {
    slots: list,
    minutes: list.length * 5,
    firstSlot: list.length ? list[0] : -1,
    lastSlot: list.length ? list[list.length - 1] : -1,
  };
}

/** Did briffy run at all on this day? False is only trustworthy from the day the app started keeping this. */
function ran(dateKey) { return forDate(dateKey).slots.length > 0; }

function clock(slot) {
  if (slot < 0) return '';
  const m = slot * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

module.exports = { init, start, stop, mark, flush, forDate, ran, clock, SLOT_MS, SLOTS_PER_DAY };
