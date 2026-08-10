/**
 * Extract text lines from PDF (supports password-protected statements).
 * Uses pdfjs-dist legacy build; polyfills browser globals for Node hosts
 * (shared hosting often lacks @napi-rs/canvas → "DOMMatrix is not defined").
 */

let pdfJsLoadPromise = null;

function installMinimalDomMatrix() {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;

  class DOMMatrixPolyfill {
    constructor(init) {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
      this.m11 = 1;
      this.m12 = 0;
      this.m13 = 0;
      this.m14 = 0;
      this.m21 = 0;
      this.m22 = 1;
      this.m23 = 0;
      this.m24 = 0;
      this.m31 = 0;
      this.m32 = 0;
      this.m33 = 1;
      this.m34 = 0;
      this.m41 = 0;
      this.m42 = 0;
      this.m43 = 0;
      this.m44 = 1;
      this.is2D = true;
      this.isIdentity = true;
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        this.m11 = this.a;
        this.m12 = this.b;
        this.m21 = this.c;
        this.m22 = this.d;
        this.m41 = this.e;
        this.m42 = this.f;
        this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
      }
    }

    multiplySelf() {
      return this;
    }
    preMultiplySelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    rotateSelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
    multiply() {
      return new DOMMatrixPolyfill();
    }
    inverse() {
      return new DOMMatrixPolyfill();
    }
    transformPoint(p) {
      return p || { x: 0, y: 0, z: 0, w: 1 };
    }
    toFloat32Array() {
      return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
    }
    toFloat64Array() {
      return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]);
    }
    toString() {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
  }

  globalThis.DOMMatrix = DOMMatrixPolyfill;
}

function ensurePdfJsGlobals() {
  // Prefer real canvas polyfills when the native module loads (Docker / full Node).
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const canvas = require('@napi-rs/canvas');
    if (canvas.DOMMatrix && typeof globalThis.DOMMatrix === 'undefined') {
      globalThis.DOMMatrix = canvas.DOMMatrix;
    }
    if (canvas.ImageData && typeof globalThis.ImageData === 'undefined') {
      globalThis.ImageData = canvas.ImageData;
    }
    if (canvas.Path2D && typeof globalThis.Path2D === 'undefined') {
      globalThis.Path2D = canvas.Path2D;
    }
  } catch {
    // Shared hosts often cannot load the native canvas binary — fall through.
  }

  installMinimalDomMatrix();

  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        if (typeof data === 'number') {
          this.width = data;
          this.height = width;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else {
          this.data = data;
          this.width = width;
          this.height = height;
        }
        this.colorSpace = 'srgb';
      }
    };
  }

  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {
      constructor() {}
      addPath() {}
      closePath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      arc() {}
      arcTo() {}
      ellipse() {}
      rect() {}
    };
  }
}

async function loadPdfJs() {
  if (!pdfJsLoadPromise) {
    ensurePdfJsGlobals();
    // Legacy build is required in Node; still needs DOMMatrix on many hosts.
    pdfJsLoadPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfJsLoadPromise;
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
  isPasswordError,
  ensurePdfJsGlobals
};
