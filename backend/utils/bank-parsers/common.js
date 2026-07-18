const crypto = require('crypto');

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIndianAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value)
    .replace(/,/g, '')
    .replace(/₹/g, '')
    .replace(/INR/gi, '')
    .replace(/[()]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'na') return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseBankDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw || raw === '-') return null;

  // DD/MM/YYYY or DD-MM-YYYY (also 2-digit year)
  let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = Number(yyyy) > 50 ? `19${yyyy}` : `20${yyyy}`;
    return `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw.slice(0, 10);

  // DD-MMM-YYYY or DD/MMM/YYYY
  m = raw.match(/^(\d{1,2})[\/\-]([A-Za-z]{3,9})[\/\-](\d{2,4})$/);
  if (m) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
      sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
      dec: 12, december: 12
    };
    let [, dd, mon, yyyy] = m;
    const mi = months[mon.toLowerCase()];
    if (mi) {
      if (yyyy.length === 2) yyyy = Number(yyyy) > 50 ? `19${yyyy}` : `20${yyyy}`;
      return `${yyyy.padStart(4, '0')}-${String(mi).padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }

  // Month DD, YYYY
  m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const parsed = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function buildFingerprint({
  accountId,
  txnDate,
  valueDate,
  withdrawal,
  deposit,
  refNo,
  narration
}) {
  const payload = [
    accountId || '',
    txnDate || '',
    valueDate || '',
    Number(withdrawal || 0).toFixed(2),
    Number(deposit || 0).toFixed(2),
    normalizeWhitespace(refNo).toUpperCase(),
    normalizeWhitespace(narration).toUpperCase()
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

const CATEGORY_RULES = [
  { category: 'Interest Income', patterns: [/INTEREST\s*CREDIT/i, /Int\.Pd/i, /MONTHLY INTEREST/i, /SAVING.*INTEREST/i] },
  { category: 'TDS / Tax', patterns: [/TAX\s*RECOVERED/i, /TDS/i, /INCOME\s*TAX/i, /DTAX/i] },
  { category: 'Fixed Deposit', patterns: [/FD\s*BOOKED/i, /FD\s*PREMATURE/i, /FD\s*CLOSURE/i, /FIXED\s*DEPOSIT/i] },
  { category: 'Salary / Income', patterns: [/SALARY/i, /PAYROLL/i, /NEFT\s*CR.*SAL/i] },
  { category: 'UPI', patterns: [/\bUPI\b/i, /@upi/i, /UPI-/i] },
  { category: 'ATM / Cash', patterns: [/\bATM\b/i, /CASH\s*WDL/i, /CASH\s*DEP/i, /NWD-/i, /EAW-/i, /CCWD/i] },
  { category: 'Card Payment', patterns: [/\bPOS\b/i, /CREDIT\s*CARD/i, /VISA/i, /MASTERCARD/i, /CRV\s*POS/i] },
  { category: 'Bill Payment', patterns: [/\bBIL\//i, /BILLPAY/i, /BBPS/i, /ELECTRICITY/i, /GAS\s*BILL/i, /WATER\s*BILL/i] },
  { category: 'Recharge', patterns: [/RECHARGE/i, /OXIGEN/i, /PREPAID/i, /RCHG/i, /MOBILE/i] },
  { category: 'Shopping / Online', patterns: [/AMAZON/i, /FLIPKART/i, /EBAY/i, /PAYU/i, /SWIGGY/i, /ZOMATO/i, /ONL\b/i] },
  { category: 'Investment / Broker', patterns: [/ZERODHA/i, /GROWW/i, /DHAN/i, /PAYOUT/i, /NSE|BSE/i, /MUTUAL\s*FUND/i, /CAMS/i, /KARVY/i] },
  { category: 'Transfer In', patterns: [/NEFT\s*CR/i, /IMPS.*CR/i, /IFT.*CR/i, /INTERNAL\s*TRANSFER/i, /INF\//i] },
  { category: 'Transfer Out', patterns: [/NEFT\s*DR/i, /IMPS.*DR/i, /IB\s*FUNDS\s*TRANSFER\s*DR/i, /TPT-/i] },
  { category: 'Cheque', patterns: [/CHQ\s*PAID/i, /CHEQUE/i, /MICR/i] },
  { category: 'Bank Charges', patterns: [/CHGS/i, /CHARGES/i, /Nchg/i, /SMS\s*ALERT/i, /AMCB/i, /FEE/i] },
  { category: 'PayPal / International', patterns: [/PAYPAL/i, /OPGSP/i] }
];

function suggestCategory(narration, withdrawal = 0, deposit = 0) {
  const text = normalizeWhitespace(narration);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.category;
  }
  if (Number(deposit) > 0 && Number(withdrawal) <= 0) return 'Income / Credit';
  if (Number(withdrawal) > 0) return 'Expense / Debit';
  return 'Uncategorized';
}

function detectTxnType(withdrawal, deposit, narration = '') {
  const w = Number(withdrawal) || 0;
  const d = Number(deposit) || 0;
  const text = narration || '';
  if (/INTEREST/i.test(text) && d > 0) return 'interest';
  if (/TAX\s*RECOVERED|TDS/i.test(text) && w > 0) return 'tax';
  if (/FD\s*BOOKED/i.test(text)) return 'fd_book';
  if (/FD\s*(CLOSURE|PREMATURE|MATUR)/i.test(text)) return 'fd_maturity';
  if (d > 0 && w <= 0) return 'credit';
  if (w > 0 && d <= 0) return 'debit';
  return 'other';
}

function finalizeParsedTxn(txn, accountId) {
  const narration = normalizeWhitespace(txn.narration);
  const withdrawal = Number(txn.withdrawal) || 0;
  const deposit = Number(txn.deposit) || 0;
  const txnDate = txn.txnDate;
  const valueDate = txn.valueDate || txnDate;
  const refNo = normalizeWhitespace(txn.refNo);
  const balance = txn.balance === null || txn.balance === undefined ? null : Number(txn.balance);
  const category = txn.category || suggestCategory(narration, withdrawal, deposit);
  const txnType = txn.txnType || detectTxnType(withdrawal, deposit, narration);
  const fingerprint = buildFingerprint({
    accountId,
    txnDate,
    valueDate,
    withdrawal,
    deposit,
    refNo,
    narration
  });

  return {
    account_id: accountId,
    txn_date: txnDate,
    value_date: valueDate,
    narration,
    ref_no: refNo || null,
    withdrawal,
    deposit,
    balance,
    category,
    txn_type: txnType,
    fingerprint,
    raw_bank: txn.rawBank || null,
    tags: txn.tags || null,
    notes: txn.notes || null
  };
}

module.exports = {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  buildFingerprint,
  suggestCategory,
  detectTxnType,
  finalizeParsedTxn,
  CATEGORY_RULES
};
