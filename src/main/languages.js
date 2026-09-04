'use strict';
// Language table shared by OCR (PP-OCR model choice), speech-to-text (whisper) and the UI.
const LANGUAGES = [
  { code: 'zh-Hans', name: '中文（简体）', english: 'Chinese (Simplified)', whisper: 'zh', ui: 'zh' },
  { code: 'zh-Hant', name: '中文（繁體）', english: 'Chinese (Traditional)', whisper: 'zh', ui: 'zh' },
  { code: 'en', name: 'English', english: 'English', whisper: 'en', ui: 'en' },
  { code: 'ja', name: '日本語', english: 'Japanese', whisper: 'ja', ui: 'en' },
  { code: 'ko', name: '한국어', english: 'Korean', whisper: 'ko', ui: 'en' },
  { code: 'fr', name: 'Français', english: 'French', whisper: 'fr', ui: 'en' },
  { code: 'de', name: 'Deutsch', english: 'German', whisper: 'de', ui: 'en' },
  { code: 'es', name: 'Español', english: 'Spanish', whisper: 'es', ui: 'en' },
  { code: 'pt', name: 'Português', english: 'Portuguese', whisper: 'pt', ui: 'en' },
  { code: 'it', name: 'Italiano', english: 'Italian', whisper: 'it', ui: 'en' },
  { code: 'ru', name: 'Русский', english: 'Russian', whisper: 'ru', ui: 'en' },
  { code: 'ar', name: 'العربية', english: 'Arabic', whisper: 'ar', ui: 'en' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', whisper: 'vi', ui: 'en' },
  { code: 'th', name: 'ไทย', english: 'Thai', whisper: 'th', ui: 'en' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', whisper: 'id', ui: 'en' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', whisper: 'hi', ui: 'en' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish', whisper: 'tr', ui: 'en' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch', whisper: 'nl', ui: 'en' },
  { code: 'pl', name: 'Polski', english: 'Polish', whisper: 'pl', ui: 'en' },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

function getLanguage(code) {
  return byCode.get(code) || null;
}

function whisperLang(code) {
  const l = byCode.get(code);
  return l ? l.whisper : null;
}

// UI language: Chinese when the first configured language is Chinese, otherwise English.
function uiLanguage(codes) {
  const first = byCode.get((codes || [])[0]);
  return first && first.ui === 'zh' ? 'zh' : 'en';
}

// Name of the language to write AI output in (used inside prompts).
function promptLanguageName(codes) {
  const first = byCode.get((codes || [])[0]);
  return first ? first.english : 'English';
}

module.exports = { LANGUAGES, getLanguage, whisperLang, uiLanguage, promptLanguageName };
