const { parse } = require('csv-parse/sync');
const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');

/**
 * ICICI Bank credit card CSV export (CreditCardStatement*.CSV).
 *
 * Layout:
 *   Accountno:, ...
 *   Customer Name:, ...
 *   Transaction Details:
 *   Date,Sr.No.,Transaction Details,Reward Point Header,Intl.Amount,Amount(in Rs),BillingAmountSign
 *   4748 XXXX XXXX 5000          ← card mask section header
 *   09-APR-25,7,INDIAN OIL...,8,0.00,867.96,867.96
 *
 * Sign: positive = purchase/charge (withdrawal), negative = payment/credit (deposit).
 */

function detectIciciCreditCard(textOrBuffer) {
  const text =
    typeof textOrBuffer === 'string'
      ? textOrBuffer
      : Buffer.isBuffer(textOrBuffer)
        ? textOrBuffer.toString('utf8', 0, Math.min(textOrBuffer.length, 6000))
        : String(textOrBuffer || '');
  const t = text.replace(/^\uFEFF/, '');
  if (!/BillingAmountSign/i.test(t)) return false;
  if (!/Transaction Details/i.test(t) && !/Amount\(in Rs\)/i.test(t)) return false;
  // Accountno + reward details is distinctive vs savings CSV
  if (/Account\s*no\s*:/i.test(t) && /Reward\s*Point/i.test(t)) return true;
  if (/CreditCardStatement/i.test(t)) return true;
  return /BillingAmountSign/i.test(t) && /Intl\.?\s*Amount/i.test(t);
}

function isCardMaskRow(cells) {
  const first = normalizeWhitespace(cells[0] || '');
  return /^\d{4}\s+X{4}\s+X{4}\s+\d{4}$/i.test(first) && cells.slice(1).every((c) => !normalizeWhitespace(c));
}

function isHeaderRow(cells) {
  const joined = cells.map((c) => normalizeWhitespace(c).toLowerCase()).join('|');
  return joined.includes('date') && joined.includes('transaction details') && joined.includes('amount');
}

function parseSignedAmount(rawAmount, rawSign) {
  // Prefer BillingAmountSign when present (already signed)
  const signSrc = rawSign != null && String(rawSign).trim() !== '' ? rawSign : rawAmount;
  const s = String(signSrc || '').trim();
  if (!s || s === '-') return 0;
  const negative = /^-/.test(s) || /\($/.test(s) || /^\(/.test(s);
  const abs = Math.abs(parseIndianAmount(s));
  if (!(abs > 0)) return 0;
  return negative ? -abs : abs;
}

function extractMeta(rows) {
  const meta = {
    accountNumber: null,
    customerName: null,
    format: 'icici_cc_csv'
  };
  for (const row of rows.slice(0, 20)) {
    const key = normalizeWhitespace(row[0] || '').toLowerCase();
    const val = normalizeWhitespace(row[1] || '');
    if (/^account\s*no/.test(key) && val) {
      meta.accountNumber = val.replace(/^0+/, '') || val;
    }
    if (/customer\s*name/.test(key) && val) {
      meta.customerName = val;
    }
  }
  return meta;
}

function parseIciciCcRows(rows, accountId, customRules = []) {
  const meta = extractMeta(rows);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (isHeaderRow(rows[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('ICICI credit card CSV: could not find transaction header row');
  }

  let currentCard = null;
  const raw = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i].map((c) => (c == null ? '' : String(c)));
    if (!cells.some((c) => normalizeWhitespace(c))) continue;
    if (isCardMaskRow(cells)) {
      currentCard = normalizeWhitespace(cells[0]);
      continue;
    }

    const dateStr = normalizeWhitespace(cells[0]);
    const txnDate = parseBankDate(dateStr);
    if (!txnDate) continue;

    const srNo = normalizeWhitespace(cells[1] || '');
    const narration = normalizeWhitespace(cells[2] || '');
    if (!narration) continue;

    const signed = parseSignedAmount(cells[5], cells[6]);
    if (signed === 0) continue;

    const withdrawal = signed > 0 ? signed : 0;
    const deposit = signed < 0 ? Math.abs(signed) : 0;

    raw.push(
      finalizeParsedTxn(
        {
          txnDate,
          valueDate: txnDate,
          narration,
          refNo: srNo || null,
          withdrawal,
          deposit,
          balance: null,
          rawBank: 'ICICI_CC',
          tags: 'credit_card',
          notes: currentCard ? `card:${currentCard}` : null
        },
        accountId,
        customRules
      )
    );
  }

  return {
    bank: 'ICICI_CC',
    meta,
    transactions: raw
  };
}

function bufferToRows(bufferOrString) {
  const text =
    typeof bufferOrString === 'string'
      ? bufferOrString
      : bufferOrString.toString('utf8').replace(/^\uFEFF/, '');
  return parse(text, {
    relax_column_count: true,
    skip_empty_lines: false,
    relax_quotes: true
  });
}

function parseIciciCreditCardCsv(bufferOrString, accountId, options = {}) {
  const rows = bufferToRows(bufferOrString);
  return parseIciciCcRows(rows, accountId, options.customRules || []);
}

module.exports = {
  detectIciciCreditCard,
  parseIciciCreditCardCsv,
  parseIciciCcRows
};
