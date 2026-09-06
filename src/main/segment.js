'use strict';
// Splitting a line into words, for a script that does not put spaces between them.
//
// All that is left of what used to be a keyword extractor. The three words it produced for every
// record were measured against this workspace and earned nothing -- 209 of 220 already appeared
// verbatim in the text that search covers anyway -- so the extractor went. Asking a question still
// has to break a Chinese sentence into terms, and that is what these two do (see recall.js).
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;

/**
 * @param {string} text
 * @param {string} [lang] BCP-47 tag; Chinese is assumed when it is not given
 * @returns {{w:string, wordLike:boolean}[]}
 */
function segment(text, lang) {
  const words = [];
  try {
    const seg = new Intl.Segmenter(lang || 'zh', { granularity: 'word' });
    for (const s of seg.segment(text)) words.push({ w: s.segment, wordLike: !!s.isWordLike });
  } catch (_) {
    // Intl.Segmenter is missing or the tag is not one it knows: fall back to splitting on punctuation.
    for (const w of text.split(/([^\p{L}\p{N}_-]+)/u)) if (w) words.push({ w, wordLike: /[\p{L}\p{N}]/u.test(w) });
  }
  return words;
}

module.exports = { segment, CJK };
