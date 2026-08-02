/**
 * Extract text lines from PDF (supports password-protected statements).
 * Uses pdfjs-dist; lines are rebuilt by Y position for table-like statements.
 */

async function loadPdfJs() {
  // Prefer legacy build for Node (no DOMMatrix / worker issues)
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function isPasswordError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    name === 'PasswordException' ||
    name === 'NeedPasswordException' ||
    /password/i.test(name) ||
    msg.includes('password') ||
    msg.includes('encrypted')
  );
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {{ password?: string }} [options]
 * @returns {Promise<{ pages: number, lines: string[], text: string, pageLines: string[][] }>}
 */
async function extractPdfText(buffer, options = {}) {
  const password = options.password != null ? String(options.password) : '';
  const pdfjs = await loadPdfJs();
  // pdfjs rejects Node Buffer; copy into a plain Uint8Array
  const data =
    buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)
      ? buffer
      : Uint8Array.from(buffer);

  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data,
      password,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true
    }).promise;
  } catch (err) {
    if (isPasswordError(err)) {
      const needs = !password;
      const e = new Error(
        needs
          ? 'This PDF is password-protected. Enter the statement password and try again.'
          : 'Incorrect PDF password. Check the password and try again.'
      );
      e.code = needs ? 'PDF_PASSWORD_REQUIRED' : 'PDF_PASSWORD_INCORRECT';
      throw e;
    }
    throw err;
  }

  const pageLines = [];
  const lines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(Number(it.transform[5]) * 10) / 10;
      const x = Number(it.transform[4]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x, str: it.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    const pageOut = [];
    for (const y of ys) {
      const parts = byY.get(y).sort((a, b) => a.x - b.x);
      const line = parts
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) {
        pageOut.push(line);
        lines.push(line);
      }
    }
    pageLines.push(pageOut);
  }

  return {
    pages: pdf.numPages,
    lines,
    pageLines,
    text: lines.join('\n')
  };
}

module.exports = {
  extractPdfText,
  isPasswordError
};
