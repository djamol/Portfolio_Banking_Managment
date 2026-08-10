const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');
const { extractPdfText } = require('./pdf-text');

function detectHdfcCreditCard(text) {
  const t = String(text || '');
  return (
    /HDFC\s*Bank\s*Credit\s*Cards?/i.test(t) ||
    /Millennia\s*Credit\s*Card\s*Statement/i.test(t) ||
    /Regalia\s*(First\s*)?(MasterCard\s*)?Credit\s*Card\s*Statement/i.test(t) ||
    /Statement\s*for\s*HDFC\s*Bank\s*Credit\s*Card/i.test(t) ||
    (/Credit\s*Card\s*No/i.test(t) && /TOTAL\s*AMOUNT\s*DUE/i.test(t)) ||
    (/Year\s*End\s*Statement/i.test(t) && /HDFC/i.test(t) && /DR\/CR/i.test(t))
  );
}

function extractRef(narration) {
  const m = String(narration || '').match(/\(Ref#\s*([^)]+)\)/i);
  return m ? normalizeWhitespace(m[1]) : null;
}

function extractCardMeta(text) {
  const meta = {
    accountNumber: null,
    statementDate: null,
    billingFrom: null,
    billingTo: null,
    customerName: null,
    cardProduct: null
  };

  const card =
    text.match(/Credit\s*Card\s*No\.?\s*([0-9X*\s]{12,24})/i) ||
    text.match(/Card\s*No[:\s]+([0-9X*\s]{12,24})/i) ||
    text.match(/\b(5181\d{2}X{4,}\d{4})\b/i) ||
    text.match(/\b(000?\d{6}X{4,}\d{4})\b/i) ||
    text.match(/\b(\d{6}X{4,}\d{4})\b/i);
  if (card) meta.accountNumber = normalizeWhitespace(card[1]).replace(/\s+/g, '').replace(/^000/, '');

  const stmt =
    text.match(/Statement\s*Date\s*([0-9]{1,2}\s+[A-Za-z]{3,9},?\s+[0-9]{2,4})/i) ||
    text.match(/Statement\s*Date\s*:?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
  if (stmt) meta.statementDate = parseBankDate(stmt[1]);

  const period = text.match(
    /Billing\s*Period\s*([0-9]{1,2}\s+[A-Za-z]{3,9},?\s+[0-9]{2,4})\s*[-–]\s*([0-9]{1,2}\s+[A-Za-z]{3,9},?\s+[0-9]{2,4})/i
  );
  if (period) {
    meta.billingFrom = parseBankDate(period[1]);
    meta.billingTo = parseBankDate(period[2]);
  }

  const name =
    text.match(/Name\s*:\s*([A-Z][A-Z.]+(?:\s+[A-Z][A-Z.]+){0,5})(?:\s+Statement|\s+Email|\n|$)/i) ||
    text.match(/\b(AMOL[A-Z]*\s+PATIL)\b/i);
  if (name) meta.customerName = normalizeWhitespace(name[1]);

  const product = text.match(
    /(Millennia|Regalia(?:\s*First)?|MoneyBack|Freedom|IndianOil|Swiggy|Tata\s*Neu)[^\n]{0,40}Credit\s*Card/i
  );
  if (product) meta.cardProduct = normalizeWhitespace(product[0]);

  return meta;
}

/** Monthly Millennia-style: `19/06/2026| 14:18 DESC C 342.60` or with `+ C` for credits */
const MONTHLY_TXN_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*\|\s*(\d{1,2}:\d{2})\s+(.+?)\s+(\+)?\s*C\s+([\d,]+\.\d{2})\b/i;

/**
 * Older Regalia / classic monthly PDF:
 * `20/07/2020 TATA AIA LIFE INSURANC MUMBAI 24,168.00`
 * `26/07/2020 IMPS PMT … (Ref# …) 1,000.00 Cr`
 */
const CLASSIC_TXN_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s*(Cr|CR|Dr|DR)?\s*$/;

/** Year-end: `12-Aug-2024 CHEQ … 2.00 DR 552365XXXXXX9206` */
const YEAR_END_TXN_RE =
  /^(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+(DR|CR)\s+([0-9X*]{10,19})\b/i;

function parseMonthlyTxnLine(line) {
  const m = String(line).match(MONTHLY_TXN_RE);
  if (!m) return null;
  const txnDate = parseBankDate(m[1]);
  if (!txnDate) return null;
  const narration = normalizeWhitespace(m[3].replace(/\s*\+\s*$/, ''));
  const amount = parseIndianAmount(m[5]);
  if (!(amount > 0)) return null;
  // HDFC marks payments/credits with '+' before C; purchases have no '+'
  const credit = Boolean(m[4]);
  const time = m[2] || '';
  const refFromNarr = extractRef(narration);
  return {
    txnDate,
    valueDate: txnDate,
    narration,
    refNo: refFromNarr || (time ? `T${time.replace(':', '')}` : null),
    withdrawal: credit ? 0 : amount,
    deposit: credit ? amount : 0,
    balance: null,
    rawBank: 'HDFC_CC',
    tags: 'credit_card',
    notes: time ? `time:${time}` : null
  };
}

function parseClassicTxnLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (/^Date\b/i.test(raw) && /Transaction/i.test(raw)) return null;
  if (/^Domestic\s+Transactions/i.test(raw)) return null;
  if (/^International\s+Transactions/i.test(raw)) return null;
  if (/^Reward\s+Points/i.test(raw)) return null;
  if (/^Page\s+\d+/i.test(raw)) return null;
  if (/^Opening\s+Balance/i.test(raw)) return null;

  const m = raw.match(CLASSIC_TXN_RE);
  if (!m) return null;
  const txnDate = parseBankDate(m[1]);
  if (!txnDate) return null;
  const narration = normalizeWhitespace(m[2]);
  if (!narration || narration.length < 2) return null;
  // Reject dues summary lines like `07/09/2020 465.00 200.00` and name-only rows
  if (/^[\d,]+\.\d{2}$/.test(narration)) return null;
  if (!/[A-Za-z]/.test(narration)) return null;
  if (/^[A-Z][A-Z\s\.]{2,40}$/.test(narration) && !/\d/.test(narration) && narration.split(/\s+/).length <= 4) {
    return null;
  }
  const amount = parseIndianAmount(m[3]);
  if (!(amount > 0)) return null;
  const flag = String(m[4] || '').toUpperCase();
  const credit = flag === 'CR';
  const refFromNarr = extractRef(narration);
  return {
    txnDate,
    valueDate: txnDate,
    narration,
    refNo: refFromNarr,
    withdrawal: credit ? 0 : amount,
    deposit: credit ? amount : 0,
    balance: null,
    rawBank: 'HDFC_CC',
    tags: 'credit_card',
    notes: null
  };
}

function parseYearEndTxnLine(line) {
  const m = String(line).match(YEAR_END_TXN_RE);
  if (!m) return null;
  const txnDate = parseBankDate(m[1]);
  if (!txnDate) return null;
  const narration = normalizeWhitespace(m[2]);
  const amount = parseIndianAmount(m[3]);
  if (!(amount > 0)) return null;
  const cr = String(m[4]).toUpperCase() === 'CR';
  return {
    txnDate,
    valueDate: txnDate,
    narration,
    refNo: extractRef(narration),
    withdrawal: cr ? 0 : amount,
    deposit: cr ? amount : 0,
    balance: null,
    rawBank: 'HDFC_CC',
    tags: 'credit_card',
    notes: `card:${m[5]}`
  };
}

function parseHdfcCcFromLines(lines, accountId, customRules = []) {
  const text = lines.join('\n');
  const meta = extractCardMeta(text);
  const isYearEnd = /Year\s*End\s*Statement/i.test(text) && /DR\/CR/i.test(text);
  const hasMillenniaStyle = lines.some((l) => MONTHLY_TXN_RE.test(String(l)));
  const hasClassicSection = lines.some((l) => /^(Domestic|International)\s+Transactions\b/i.test(String(l)));

  const raw = [];
  let inClassicTxnSection = !hasClassicSection; // if no section markers, scan whole doc
  for (const line of lines) {
    if (/^DATE\b/i.test(line) && /TRANSACTION/i.test(line)) continue;
    if (/^Page\s+\d+/i.test(line)) continue;

    if (/^(Domestic|International)\s+Transactions\b/i.test(String(line))) {
      inClassicTxnSection = true;
      continue;
    }
    if (
      inClassicTxnSection &&
      (/^Reward\s+Points/i.test(String(line)) ||
        /^Offers\s+on\s+your\s+Credit\s+Card/i.test(String(line)) ||
        /^\*\s*Note\s*:/i.test(String(line)))
    ) {
      inClassicTxnSection = false;
      continue;
    }

    let parsed = null;
    if (isYearEnd) {
      parsed = parseYearEndTxnLine(line);
    } else if (hasMillenniaStyle) {
      parsed = parseMonthlyTxnLine(line);
    } else if (inClassicTxnSection) {
      parsed = parseClassicTxnLine(line) || parseMonthlyTxnLine(line);
    }
    if (parsed) raw.push(parsed);
  }

  // Deduplicate identical rows (keep time in key — same merchant can bill twice same day)
  const seen = new Set();
  const transactions = [];
  for (const t of raw) {
    const key = `${t.txnDate}|${t.notes || ''}|${t.withdrawal}|${t.deposit}|${t.narration}|${t.refNo || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    transactions.push(finalizeParsedTxn(t, accountId, customRules));
  }

  let format = 'hdfc_cc_monthly';
  if (isYearEnd) format = 'hdfc_cc_year_end';
  else if (!hasMillenniaStyle) format = 'hdfc_cc_classic';

  return {
    bank: 'HDFC_CC',
    meta: {
      ...meta,
      statementFrom: meta.billingFrom,
      statementTo: meta.billingTo,
      format
    },
    transactions
  };
}

async function parseHdfcCreditCardPdf(buffer, accountId, options = {}) {
  const { lines, text } = await extractPdfText(buffer, { password: options.password });
  if (!detectHdfcCreditCard(text)) {
    throw new Error(
      'PDF does not look like an HDFC credit card statement. Supported: Millennia monthly PDF and year-end summary PDF.'
    );
  }
  return parseHdfcCcFromLines(lines, accountId, options.customRules || []);
}

module.exports = {
  detectHdfcCreditCard,
  parseHdfcCreditCardPdf,
  parseHdfcCcFromLines,
  parseMonthlyTxnLine,
  parseClassicTxnLine,
  parseYearEndTxnLine
};
