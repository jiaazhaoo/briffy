'use strict';
// The daily recap, both ways, against a throwaway userData seeded with a copy of one real day.
// No AI service is configured in the copy, so this exercises the counted recap -- the path that has
// to be right whether or not anyone pays for a model -- and then checks that the prompt handed to a
// model would carry the same counts and the same headings.
//
//   npx electron dev/recap-test.js [YYYY-MM-DD]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'briffy-recap-'));
app.setPath('userData', TMP);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

(async () => {
  await app.whenReady();

  const { Store } = require('../src/main/store');
  const summary = require('../src/main/summary');
  const uptime = require('../src/main/uptime');
  const dayStats = require('../src/main/day-stats');
  const llm = require('../src/main/llm');
  const i18n = require('../src/main/i18n');

  const store = new Store();
  store.init();
  // No provider: this is the path that must work on its own.
  store.updateSettings({ languages: ['zh-Hans', 'en'], provider: 'anthropic', apiKey: '' });
  i18n.setLanguage('zh');
  uptime.init({ store });

  // Seed one real day, copied out of the user's workspace and never written back.
  const src = path.join(os.homedir(), 'Library', 'Application Support', 'briffy', 'workspace', 'entries');
  const day = process.argv[2] || (fs.existsSync(src) ? fs.readdirSync(src).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop().slice(0, 10) : '');
  if (!day) { console.log('no workspace to copy from'); process.exit(0); }
  fs.mkdirSync(store.paths().entries, { recursive: true });
  fs.copyFileSync(path.join(src, `${day}.json`), path.join(store.paths().entries, `${day}.json`));
  // and pretend briffy was awake for a stretch of it
  fs.mkdirSync(store.paths().uptime, { recursive: true });
  fs.writeFileSync(path.join(store.paths().uptime, `${day}.json`),
    JSON.stringify({ dateKey: day, slots: Array.from({ length: 96 }, (_, i) => i + 96) }));
  store.days.clear(); store.index.clear();
  for (const k of store.listDates()) store.loadDay(k);

  const windows = { setPetState() {}, broadcastToWorkspace() {}, openWorkspace() {} };
  summary.init({ store, windows, notify: null });

  const entries = store.entriesForDate(day);
  check('the day was copied in', entries.length > 0, `${entries.length} entries from ${day}`);

  // ---------- counted ----------
  const out = await summary.generate(day, { force: true, quiet: true });
  check('a recap was written', !!out && !!out.text, '');
  const text = (out && out.text) || '';
  check('it is headed by the date', text.startsWith(`# ${day}`), text.split('\n')[0]);
  for (const [name, heading] of [['概览', i18n.t('recapOverview')], ['规律', i18n.t('recapPatterns')], ['在做什么', i18n.t('recapThemes')]]) {
    check(`it has the ${name} section`, text.includes(`## ${heading}`), '');
  }
  check('it counts the kinds', /\*\*按类型\*\*/.test(text), (text.match(/\*\*按类型\*\*.*/) || [''])[0].slice(0, 70));
  check('it says no model was involved', text.includes(i18n.t('recapLocal')), '');
  check('it names where records came from, when known',
    !entries.some((e) => e.context && e.context.app) || /·\s\S+/.test(text), '');
  check('the counts in the meta match the entries', out.meta.stats.total === entries.filter((e) => e.status !== 'error').length,
    `${out.meta.stats.total} counted`);

  // ---------- the two kinds of empty ----------
  const emptyDay = '2020-01-01';
  const off = await summary.generate(emptyDay, { force: true, quiet: true });
  check('a day briffy never saw says so', off.text.includes(i18n.t('recapNotRunning')), '');

  fs.writeFileSync(path.join(store.paths().uptime, '2020-01-02.json'), JSON.stringify({ dateKey: '2020-01-02', slots: [10, 11, 12] }));
  const idle = await summary.generate('2020-01-02', { force: true, quiet: true });
  check('a day it watched but nothing happened says that instead',
    idle.text.includes('15') && !idle.text.includes(i18n.t('recapNotRunning')), idle.text.split('\n').pop());

  // ---------- what a model would be handed ----------
  const st = dayStats.stats(entries, { uptime: uptime.forDate(day) });
  const counts = dayStats.asLines(st, { dateKey: day });
  check('the counts given to a model name the day', counts.includes(day), '');
  check('the counts given to a model are the same numbers', counts.includes(`Kept: ${st.total} items`), counts.split('\n')[1]);
  const cfg = llm.config(store, { languageName: '简体中文' });
  check('with no key configured, nothing is sent', !llm.isConfigured(cfg), '');

  console.log('\n--- 前 22 行 ---');
  console.log(text.split('\n').slice(0, 22).join('\n'));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('TEST_ERROR', e && e.stack || e); process.exit(1); });
