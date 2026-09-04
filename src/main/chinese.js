'use strict';
// Whisper picks Simplified or Traditional characters arbitrarily for Chinese speech; normalise the
// transcript to the script the user selected as a language pack (zh-Hans → simplified, zh-Hant → traditional).
let OpenCC = null;
const converters = {};

function converter(from, to) {
  if (!OpenCC) OpenCC = require('opencc-js');
  const key = `${from}>${to}`;
  if (!converters[key]) converters[key] = OpenCC.Converter({ from, to });
  return converters[key];
}

/**
 * @param {string} text
 * @param {string[]} languageCodes configured language packs, e.g. ['zh-Hans', 'en']
 */
function normalizeChineseScript(text, languageCodes) {
  if (!text) return text;
  const zh = (languageCodes || []).find((c) => c.startsWith('zh'));
  try {
    if (zh === 'zh-Hans') return converter('t', 'cn')(text);
    if (zh === 'zh-Hant') return converter('cn', 't')(text);
  } catch (e) {
    console.warn('[chinese] conversion failed:', e.message);
  }
  return text;
}

module.exports = { normalizeChineseScript };
