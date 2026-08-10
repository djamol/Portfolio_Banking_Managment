const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');
const { extractPdfText } = require('./pdf-text');

function detectSbiCreditCardPdf(text) {
  const t = String(text || '');
  if (/GSTIN\s*of\s*SBI\s*Card/i.test(t)) return true;
  if (/SBI\s*Cards?\s+and\s+Payment/i.test(t) && /Transaction\s*Details/i.test(t)) return true;
  if (/sbicard\.com/i.test(t) && /C\s*=\s*Credit\s*;\s*D\s*=\s*Debit/i.test(t)) return true;
  return (
    /SBI\s*Credit\s*Card/i.test(t) &&
    /Transaction\s*Details/i.test(t) &&
    /\bC\s*=\s*Credit/i.test(t)
  );
}

function extractCardMeta(text) {
  const meta = {
    accountNumber: null,
    statementDate: null,
    billingFrom: null,
    billingTo: null,
    customerName: null,
    cardProduct: null,
    format: 'sbi_cc_pdf'
  };

  const card =
    text.match(/Credit\s*Card\s*Number[\s:\n]*([X0-9][X0-9 ]{8,20}\d{2,4})\b/i) ||
    text.match(/\b(XXXX\s+XXXX\s+XXXX\s+X{0,2}\d{2,4})\b/i) ||
    text.match(/\b(\d{4}\s*X{4}\s*X{4}\s*\d{4})\b/i);
  if (card) meta.accountNumber = normalizeWhitespace(card[1]).replace(/\s+/g, '');

  const stmt =
    text.match(/for\s*Statement\s*dated\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i) ||
    text.match(/Statement\s*Date\s*[\s\S]{0,40}?(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  if (stmt) meta.statementDate = parseBankDate(stmt[1]);

  const due = text.match(/Payment\s*Due\s*Date\s*[\s\S]{0,40}?(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  if (due) meta.paymentDueDate = parseBankDate(due[1]);

  // Name is usually the first prominent line after header — take "AMOL PATIL" style
  const name =
    text.match(/\n([A-Z]{2,}(?:\s+[A-Z]{2,}){0,3})\nCredit\s*Card\s*Number/i) ||
    text.match(/^([A-Z]{2,}(?:\s+[A-Z]{2,}){0,3})\nCredit\s*Card\s*Number/im);
  if (name) meta.customerName = normalizeWhitespace(name[1]);

  const product = text.match(/\b(AURUM|ELITE(?:\s*Advantage)?|PRIME(?:\s*Advantage)?|SimplySAVE|Pulse|Cashback)\b/i);
  if (product) meta.cardProduct = normalizeWhitespace(product[1]);

  return meta;
}

/**
 * Dated: `03 Oct 24 ONLINE BANK VERIFICATION CR 1.00 C`
 * Undated GST/fee follow-on: `IGST DB @ 18.00% 89.82 D`
 */
const DATED_TXN_RE =
  /^(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([CD]|CR|DR|EN|FP|BT|T)\s*$/i;
const UNDATED_TXN_RE = /^(.+?)\s+([\d,]+\.\d{2})\s+([CD]|CR|DR|EN|FP|BT|T)\s*$/i;

function flagIsCredit(flag) {
  const f = String(flag || '').toUpperCase();
  return f === 'C' || f === 'CR' || f === 'T';
}

function parseSbiCcTxnParts(narrationRaw, amountRaw, flag, txnDate) {
  const narration = normalizeWhitespace(narrationRaw);
  if (!narration || narration.length < 2) return null;
  if (!/[A-Za-z]/.test(narration)) return null;
  if (/^Transactions\s+highlighted/i.test(narration)) return null;
  if (/^C\s*=\s*Credit/i.test(narration)) return null;
  if (/^Date\b/i.test(narration) && /Amount/i.test(narration)) return null;

  const amount = parseIndianAmount(amountRaw);
  if (!(amount > 0)) return null;
  const credit = flagIsCredit(flag);

  return {
    txnDate,
    valueDate: txnDate,
    narration,
    refNo: null,
    withdrawal: credit ? 0 : amount,
    deposit: credit ? amount : 0,
    balance: null,
    rawBank: 'SBI_CC',
    tags: 'credit_card',
    notes: `flag:${String(flag).toUpperCase()}`
  };
}

function parseSbiCcTxnLine(line, lastDate) {
  const raw = String(line || '').trim();
  if (!raw) return { txn: null, lastDate };

  const dated = raw.match(DATED_TXN_RE);
  if (dated) {
    const txnDate = parseBankDate(dated[1]);
    if (!txnDate) return { txn: null, lastDate };
    const txn = parseSbiCcTxnParts(dated[2], dated[3], dated[4], txnDate);
    return { txn, lastDate: txnDate };
  }

  // Carry forward date for GST / fee continuation lines
  if (lastDate) {
    const undated = raw.match(UNDATED_TXN_RE);
    if (undated) {
      const txn = parseSbiCcTxnParts(undated[1], undated[2], undated[3], lastDate);
      return { txn, lastDate };
    }
  }

  return { txn: null, lastDate };
}

function parseSbiCcFromLines(lines, accountId, customRules = []) {
  const text = lines.join('\n');
  const meta = extractCardMeta(text);

  let inTxn = false;
  let lastDate = meta.statementDate || null;
  const raw = [];

  for (const line of lines) {
    const s = String(line || '').trim();
    if (/^Transaction\s*Details\b/i.test(s)) {
      inTxn = true;
      continue;
    }
    if (
      inTxn &&
      (/^Important\s+Messages/i.test(s) ||
        /^SAVINGS\s+AND\s+BENEFITS/i.test(s) ||
        /^Transactions\s+highlighted/i.test(s) ||
        /^C\s*=\s*Credit/i.test(s) ||
        /^IMPORTANT\s+INFORMATION/i.test(s) ||
        /^Schedule\s+of\s+Charges/i.test(s))
    ) {
      inTxn = false;
      continue;
    }
    if (!inTxn) continue;
    if (/^Date\b/i.test(s) && /Amount/i.test(s)) continue;
    if (/^for\s*Statement\s*dated/i.test(s)) continue;
    if (/^\(`?\)$/i.test(s) || s === '( ` )' || s === '(` )') continue;

    const { txn, lastDate: nextDate } = parseSbiCcTxnLine(s, lastDate);
    lastDate = nextDate;
    if (txn) raw.push(txn);
  }

  const seen = new Set();
  const transactions = [];
  for (const t of raw) {
    const key = `${t.txnDate}|${t.withdrawal}|${t.deposit}|${t.narration}|${t.notes || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transactions.push(finalizeParsedTxn(t, accountId, customRules));
  }

  return {
    bank: 'SBI_CC',
    meta: {
      ...meta,
      statementFrom: meta.billingFrom,
      statementTo: meta.billingTo || meta.statementDate
    },
    transactions
  };
}

async function parseSbiCreditCardPdf(buffer, accountId, options = {}) {
  const { lines, text } = await extractPdfText(buffer, { password: options.password });
  if (!detectSbiCreditCardPdf(text)) {
    throw new Error(
      'PDF does not look like an SBI credit card statement. Supported: SBI Card monthly PDF (password OK).'
    );
  }
  return parseSbiCcFromLines(lines, accountId, options.customRules || []);
}

module.exports = {
  detectSbiCreditCardPdf,
  parseSbiCreditCardPdf,
  parseSbiCcFromLines,
  parseSbiCcTxnLine
};
