'use strict';
// briffy:// — a way to point at one record from outside the app.
//
// A recap that says "at 14:20 you saved the Postgres error" is worth more when those words are a link
// back to the record itself. Everything briffy writes for the user (the daily recap, an exported note,
// an answer in Ask) can carry one, and so can anything the user pastes elsewhere -- a task list, a
// commit message, their own notes in another app.
//
//   briffy://entry/<id>          one record, opened in its detail view
//   briffy://day/<YYYY-MM-DD>    the entries page, that day selected
//   briffy://summary/<YYYY-MM-DD>  that day's recap
//   briffy://open                just bring the workspace up
//
// Links are read, never obeyed: each one resolves to "show the user this", never to an action that
// changes or sends anything. A link naming a record that does not exist opens the workspace and
// nothing else.
const path = require('path');
const { app } = require('electron');

const SCHEME = 'briffy';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

let windows = null;
let pending = null;     // a link that arrived before the app was ready

function init(deps) {
  windows = deps.windows;
  if (pending) { const url = pending; pending = null; handle(url); }
}

/** Registers the scheme with the OS. In development the launcher is Electron itself plus our folder. */
function register() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(SCHEME);
    }
  } catch (e) {
    console.warn('[deeplink] cannot register briffy://', e.message);
  }
}

/** @returns {{tab:string, arg:string}|null} */
function parse(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (u.protocol !== `${SCHEME}:`) return null;
  // briffy://entry/<id> parses as host="entry", pathname="/<id>"
  const kind = (u.hostname || '').toLowerCase();
  const arg = decodeURIComponent((u.pathname || '').replace(/^\/+/, '').split('/')[0] || '');
  if (kind === 'entry' && ID.test(arg)) return { tab: 'entries', arg };
  if (kind === 'day' && DATE.test(arg)) return { tab: 'entries', arg: '', dateKey: arg };
  if (kind === 'summary' && DATE.test(arg)) return { tab: 'summaries', arg };
  if (kind === 'open' || kind === '') return { tab: 'entries', arg: '' };
  return null;
}

function handle(url) {
  if (!windows) { pending = url; return false; }
  const route = parse(url);
  if (!route) { console.warn('[deeplink] ignoring', url); return false; }
  windows.openWorkspace(route.tab, route.dateKey || route.arg || '');
  return true;
}

/** Pulls a briffy:// link out of a command line (Windows and Linux hand it over that way). */
function fromArgv(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${SCHEME}://`)) || '';
}

const linkTo = {
  entry: (id) => `${SCHEME}://entry/${id}`,
  day: (dateKey) => `${SCHEME}://day/${dateKey}`,
  summary: (dateKey) => `${SCHEME}://summary/${dateKey}`,
};

module.exports = { init, register, handle, parse, fromArgv, linkTo, SCHEME };
