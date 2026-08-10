const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');
const { extractPdfText } = require('./pdf-text');

function detectIciciCreditCardPdf(text) {
  const t = String(text || '');
  if (!/CREDIT\s*CARD\s*STATEMENT/i.test(t) && !/ICICI\s*Bank\s*Credit\s*Card/i.test(t)) {
    return false;
  }
  return (
    /ICICI/i.test(t) ||
    /SerNo\.?\s*Transaction\s*Details/i.test(t) ||
    /customer\.care@icicibank\.com/i.test(t)
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
    format: 'icici_cc_pdf'
  };

  const card =
    text.match(/\b(\d{4}X{4,}\d{4})\b/i) ||
    text.match(/\b(\d{4}\s*X{4}\s*X{4}\s*\d{4})\b/i);
  if (card) meta.accountNumber = normalizeWhitespace(card[1]).replace(/\s+/g, '');

  const stmt = text.match(
    /STATEMENT\s*DATE[\s\S]{0,250}?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );
  if (stmt) meta.statementDate = parseBankDate(stmt[1]);

  const period = text.match(
    /Statement\s*period\s*:?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*to\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );
  if (period) {
    meta.billingFrom = parseBankDate(period[1]);
    meta.billingTo = parseBankDate(period[2]);
  }

  const name = text.match(/\bMr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (name) meta.customerName = normalizeWhitespace(name[1]);

  return meta;
}

/**
 * ICICI CC PDF txn line examples:
 * `14/08/2019 3721570448 GOOGLE*PLAY G.CO HELPPAY# US* 36 25 USD 1,858.02`
 * `01/09/2019 1234567890 NET BANKING PAYMENT 1,858.02 CR`
 */
const TXN_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{5,})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR|Cr|DR|Dr)?\s*$/;

function cleanNarration(raw) {
  let n = normalizeWhitespace(raw);
  // Drop trailing reward points + optional intl amount (e.g. "36 25 USD")
  n = n.replace(/\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+[A-Z]{3}$/i, '');
  n = n.replace(/\s+\d+(?:\.\d+)?\s+[A-Z]{3}$/i, '');
  n = n.replace(/\s+\d+$/, '');
  return normalizeWhitespace(n);
}

function parseIciciCcTxnLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (/^Date\b/i.test(raw) && /Transaction/i.test(raw)) return null;
  if (/^Page\s+\d+/i.test(raw)) return null;
  if (/^International\s+Spends/i.test(raw)) return null;
  if (/^SPENDS\s+OVERVIEW/i.test(raw)) return null;

  const m = raw.match(TXN_RE);
  if (!m) return null;
  const txnDate = parseBankDate(m[1]);
  if (!txnDate) return null;
  const serNo = m[2];
  const narration = cleanNarration(m[3]);
  if (!narration) return null;
  const amount = parseIndianAmount(m[4]);
  if (!(amount > 0)) return null;
  const flag = String(m[5] || '').toUpperCase();
  const credit =
    flag === 'CR' ||
    /PAYMENT|CREDITED|THANK\s*YOU|NEFT|IMPS|UPI.*PAY/i.test(narration);

  return {
    txnDate,
    valueDate: txnDate,
    narration,
    refNo: serNo || null,
    withdrawal: credit ? 0 : amount,
    deposit: credit ? amount : 0,
    balance: null,
    rawBank: 'ICICI_CC',
    tags: 'credit_card',
    notes: null
  };
}

function parseIciciCcFromLines(lines, accountId, customRules = []) {
  const text = lines.join('\n');
  const meta = extractCardMeta(text);
  let currentCard = meta.accountNumber;

  const raw = [];
  for (const line of lines) {
    const cardOnly = String(line).match(/^\s*(\d{4}X{4,}\d{4})\s*$/i);
    if (cardOnly) {
      currentCard = cardOnly[1];
      if (!meta.accountNumber) meta.accountNumber = currentCard;
      continue;
    }
    const parsed = parseIciciCcTxnLine(line);
    if (!parsed) continue;
    if (currentCard) parsed.notes = `card:${currentCard}`;
    raw.push(parsed);
  }

  const seen = new Set();
  const transactions = [];
  for (const t of raw) {
    const key = `${t.txnDate}|${t.refNo || ''}|${t.withdrawal}|${t.deposit}|${t.narration}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transactions.push(finalizeParsedTxn(t, accountId, customRules));
  }

  return {
    bank: 'ICICI_CC',
    meta: {
      ...meta,
      statementFrom: meta.billingFrom,
      statementTo: meta.billingTo
    },
    transactions
  };
}

async function parseIciciCreditCardPdf(buffer, accountId, options = {}) {
  const { lines, text } = await extractPdfText(buffer, { password: options.password });
  if (!detectIciciCreditCardPdf(text)) {
    throw new Error(
      'PDF does not look like an ICICI credit card statement. Supported: ICICI Retail Coral / credit card PDF, or CreditCardStatement CSV.'
    );
  }
  return parseIciciCcFromLines(lines, accountId, options.customRules || []);
}

module.exports = {
  detectIciciCreditCardPdf,
  parseIciciCreditCardPdf,
  parseIciciCcFromLines,
  parseIciciCcTxnLine
};
