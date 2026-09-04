'use strict';
// Local PDF text extraction (pdf-parse / pdfjs). Used for search and for providers without native PDF input.
const fs = require('fs');

/**
 * @param {Buffer|string} source PDF bytes or a file path
 * @returns {Promise<{text:string, pages:number}>}
 */
async function extractPdfText(source, { maxChars = 200000 } = {}) {
  const { PDFParse } = require('pdf-parse');
  const data = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  const parser = new PDFParse({ data });
  try {
    const r = await parser.getText();
    const text = String(r.text || '')
      .replace(/^-- \d+ of \d+ --$/gm, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text: text.length > maxChars ? text.slice(0, maxChars) : text, pages: r.total || 0 };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

module.exports = { extractPdfText };
