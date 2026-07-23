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

const MONTH_MAP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeYear(yyyy) {
  const y = String(yyyy);
  if (y.length === 2) return Number(y) > 50 ? `19${y}` : `20${y}`;
  return y.padStart(4, '0');
}

function ymdFromParts(dd, mm, yyyy) {
  return `${normalizeYear(yyyy)}-${pad2(mm)}-${pad2(dd)}`;
}

function parseBankDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw || raw === '-') return null;

  let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    return ymdFromParts(m[1], m[2], m[3]);
  }

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw.slice(0, 10);

  // 01-May-2022 / 01/May/2022
  m = raw.match(/^(\d{1,2})[\/\-]([A-Za-z]{3,9})[\/\-](\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[2].toLowerCase()];
    if (mi) return ymdFromParts(m[1], mi, m[3]);
  }

  // Kotak CSV: 01 May 2022
  // Axis Excel: 06 Jan '14 / 06 Jan ’14
  m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+['\u2019]?(\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[2].toLowerCase()];
    if (mi) return ymdFromParts(m[1], mi, m[3]);
  }

  // May 1, 2022 / May 01 2022
  m = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[1].toLowerCase()];
    if (mi) return ymdFromParts(m[2], mi, m[3]);
  }

  // Reject bare numbers / codes (e.g. "0", account balances) that Date() misparses
  if (/^\d+(\.\d+)?$/.test(raw)) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    // Prefer local Y-M-D to avoid UTC off-by-one for date-only strings
    return ymdFromParts(parsed.getDate(), parsed.getMonth() + 1, parsed.getFullYear());
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

// Specific merchants / types before generic UPI so brokers are not lumped as "UPI"
const CATEGORY_RULES = [
  {
    category: 'Interest Income',
    patterns: [
      /INTEREST\s*CREDIT/i,
      /CREDIT\s*INTEREST/i,
      /Int\.Pd/i,
      /MONTHLY INTEREST/i,
      /SAVING.*INTEREST/i,
      /\bFD\s*Int\b/i,
      /FD Int/i,
      /Int\s+on\s+FD/i,
      /Int\s+on\s+RD/i
    ]
  },
  { category: 'TDS / Tax', patterns: [/TAX\s*RECOVERED/i, /MONTHLY\s*TAX/i, /\bTDS\b/i, /INCOME\s*TAX/i, /DTAX/i] },
  {
    category: 'Fixed Deposit',
    patterns: [/FD\s*BOOKED/i, /FD\s*PREMATURE/i, /FD\s*CLOSURE/i, /FIXED\s*DEPOSIT/i]
  },
  { category: 'Salary / Income', patterns: [/SALARY/i, /PAYROLL/i, /NEFT\s*CR.*SAL/i, /\bMYSAL\b/i] },
  {
    category: 'Investment / Broker',
    patterns: [
      /ZERODHA/i,
      /GROWW/i,
      /\bDHAN\b/i,
      /\bPAYOUT\b/i,
      /\bACTIVITY\b/i,
      /MUTUAL\s*FUND/i,
      /MUTUALFUND/i,
      /MFPAYMENT/i,
      /CAMS/i,
      /KARVY/i,
      /KFINTECH/i,
      /MONEYLICIO/i,
      /RAISE\s*SECUR/i,
      /RAISESECURITIES/i,
      /BSESTARMF/i,
      /INDIANCLEARING/i,
      /INDIAN\s*CLEA/i,
      /CLEARING\s*CORPORATION/i,
      /SHRIRAM\s*TRANSPORT/i,
      /\bNSE\b|\bBSE\b/i
    ]
  },
  {
    category: 'Bill Payment',
    patterns: [/\bBIL\//i, /BILLPAY/i, /HDFCBILLPAY/i, /BBPS/i, /ELECTRICITY/i, /GAS\s*BILL/i, /WATER\s*BILL/i]
  },
  { category: 'PayPal / International', patterns: [/PAYPAL/i, /OPGSP/i] },
  {
    category: 'ATM / Cash',
    patterns: [/\bATM\b/i, /CASH\s*WDL/i, /CASH\s*DEP/i, /\bNWD-/i, /\bEAW-/i, /\bATW-/i, /\bCCWD\b/i]
  },
  { category: 'Card Payment', patterns: [/\bPOS\b/i, /CREDIT\s*CARD/i, /VISA/i, /MASTERCARD/i, /CRV\s*POS/i] },
  { category: 'Recharge', patterns: [/RECHARGE/i, /OXIGEN/i, /PREPAID/i, /\bRCHG\b/i, /JIORECHARGE/i] },
  {
    category: 'Shopping / Online',
    patterns: [/AMAZON/i, /FLIPKART/i, /EBAY/i, /PAYU/i, /SWIGGY/i, /ZOMATO/i, /\bONL\b/i]
  },
  {
    category: 'Transfer In',
    patterns: [
      /NEFT\s*CR/i,
      /IMPS.*\bCR\b/i,
      /IFT.*CR/i,
      /IB\s*FUNDS\s*TRANSFER\s*CR/i,
      /INTERNAL\s*TRANSFER/i,
      /INF\//i,
      /NACH-CR/i
    ]
  },
  {
    category: 'Transfer Out',
    patterns: [/NEFT\s*DR/i, /IMPS.*\bDR\b/i, /IB\s*FUNDS\s*TRANSFER\s*DR/i, /TPT-/i]
  },
  { category: 'UPI', patterns: [/\bUPI\b/i, /@upi/i, /UPI-/i, /UPI\//i, /UPI:PAY/i, /UPI:COLLECT/i] },
  { category: 'Cheque', patterns: [/CHQ\s*PAID/i, /CHEQUE/i, /\bMICR\b/i] },
  {
    category: 'Bank Charges',
    patterns: [/CHGS/i, /CHARGES/i, /Nchg/i, /SMS\s*ALERT/i, /AMCB/i, /\bFEE\b/i, /SER\s*TAX/i, /ED\s*CESS/i]
  }
];

/** Canonical merchant names for fragmented bank truncations */
const PAYEE_ALIASES = [
  { canonical: 'Raise Securities', patterns: [/raise\s*secu/i, /raisesecurities/i] },
  { canonical: 'Moneylicious Securities', patterns: [/moneylicio/i] },
  {
    canonical: 'Indian Clearing Corporation',
    patterns: [/indian\s*clea/i, /indianclearing/i, /clearing\s*corporation/i, /bsestarmf/i]
  },
  {
    canonical: 'Amol Vishnu Patil',
    patterns: [/\bamol\s*vishnu\s*pati?l?\b/i, /\bamolvishnupatil\b/i, /\bamol\s*vishn\b/i, /^amol$/i]
  },
  {
    canonical: 'Shriram Transport Finance',
    patterns: [/shriram\s*transport/i, /transport\s*fi(nance)?/i, /finance\s*ltd\s*erstwhile\s*shri/i]
  },
  { canonical: 'Suryoday Small Finance Bank', patterns: [/suryoday/i] },
  { canonical: 'PhonePe', patterns: [/phonepe/i] },
  { canonical: 'HDFC BillPay', patterns: [/hdfcbillpay/i] },
  { canonical: 'djamolgroup', patterns: [/djamolgroup/i] },
  { canonical: 'Bank Interest', patterns: [/^bank interest$/i] },
  { canonical: 'Fixed Deposit', patterns: [/^fixed deposit$/i] },
  { canonical: 'Internal Transfer', patterns: [/^internal transfer$/i] },
  { canonical: 'Broker Payout', patterns: [/^broker payout$/i] },
  { canonical: 'ATM Withdrawal', patterns: [/^atm withdrawal$/i] }
];

function cleanPayeeToken(value) {
  return normalizeWhitespace(String(value || '').replace(/\s+/g, ' '))
    .replace(/[-\/]+$/g, '')
    .trim();
}

function normalizePayee(payee, narration = '') {
  const hay = `${payee || ''} ${narration || ''}`;
  for (const alias of PAYEE_ALIASES) {
    if (alias.patterns.some((re) => re.test(hay))) return alias.canonical;
  }
  if (!payee) return null;
  const cleaned = cleanPayeeToken(payee);
  return cleaned ? cleaned.slice(0, 120) : null;
}

/**
 * Extract merchant / UPI counterparty from Indian bank narrations.
 */
function extractPayee(narration) {
  const text = normalizeWhitespace(narration);
  if (!text) return null;

  if (/INTEREST\s*CREDIT|MONTHLY\s*INTEREST|CREDIT\s*INTEREST|Int\s+on\s+FD|Int\s+on\s+RD/i.test(text)) {
    return 'Bank Interest';
  }
  if (/FD\s*BOOKED|FIXED\s*DEPOSIT/i.test(text)) return 'Fixed Deposit';
  if (/^IO\s+For\b/i.test(text) || /IB\s*FUNDS\s*TRANSFER/i.test(text)) return 'Internal Transfer';
  if (/\bPAYOUT\b/i.test(text) && !/HYPTO/i.test(text)) return 'Broker Payout';
  if (/\b(?:ATW|EAW|NWD|CCWD)-/i.test(text)) return 'ATM Withdrawal';
  if (/PHONEPE/i.test(text)) return 'PhonePe';
  if (/HDFCBILLPAY/i.test(text)) return 'HDFC BillPay';

  // UPI/NAME/... (slash style, e.g. Kotak)
  let m = text.match(/\bUPI\/([A-Za-z][^\/]{1,50})\//i);
  if (m) {
    const name = cleanPayeeToken(m[1]);
    if (name && !/^(PAY|COLLECT|IN|DR|CR|UPI)$/i.test(name)) return name.slice(0, 120);
  }

  // UPI-NAME-VPA-... ; if NAME is numeric account, prefer meaningful note / VPA merchant
  m = text.match(/\bUPI[-:]\s*([A-Za-z0-9 .&'_-]{2,60})/i);
  if (m) {
    const first = cleanPayeeToken(m[1].split(/[\/\-]/)[0]);
    if (first && /^\d{6,}$/.test(first)) {
      if (/PHONEPE/i.test(text)) return 'PhonePe';
      const vpa = text.match(/\b([A-Za-z][A-Za-z0-9._-]{2,40}@[A-Za-z0-9.]{2,40})\b/);
      if (vpa) {
        const local = vpa[1].split('@')[0];
        if (!/^\d+$/.test(local)) return cleanPayeeToken(local).slice(0, 120);
      }
    } else if (first && !/^(PAY|COLLECT|IN|DR|CR)$/i.test(first)) {
      return first.slice(0, 120);
    }
  }

  // VPA: name@bank
  m = text.match(/\b([A-Za-z][A-Za-z0-9._-]{2,40}@[A-Za-z0-9.]{2,40})\b/);
  if (m) return m[1].slice(0, 120);

  // NEFT CR/DR-IFSC-NAME-...
  m = text.match(/\bNEFT\s+(?:CR|DR)-[A-Z0-9]+-([^-]+?)-/i);
  if (m) {
    const name = cleanPayeeToken(m[1]);
    if (name && !/^(NETBANK|MUM)/i.test(name)) return name.slice(0, 120);
  }

  // NEFT-REF-NAME-- (Shriram style)
  m = text.match(/\bNEFT-[A-Z0-9]+-([^-]+?)(?:--|-)/i);
  if (m) {
    const name = cleanPayeeToken(m[1]);
    if (name) return name.slice(0, 120);
  }

  // IMPS-ref-NAME-BANK... or IMPS-P2A-ref-BANK-NAME
  m = text.match(/\bIMPS-(?:P2A-)?[0-9]+-([A-Za-z][A-Za-z0-9 .&']{2,55})-/i);
  if (m) {
    const name = cleanPayeeToken(m[1]);
    if (name && !/^(UTI\s*B|HDFC|ICIC|YESB|SBIN|FUNDS)$/i.test(name)) return name.slice(0, 120);
  }

  // legacy spaced NEFT/IMPS … NAME
  m = text.match(/\b(?:NEFT|IMPS|RTGS)[-\/A-Z0-9]*\s+([A-Za-z][A-Za-z0-9 .&']{2,50})/i);
  if (m) return cleanPayeeToken(m[1]).slice(0, 120);

  // POS MERCHANT
  m = text.match(/\bPOS\s+\S+\s+(.+)$/i);
  if (m) return cleanPayeeToken(m[1]).slice(0, 120);

  return null;
}

function resolvePayee(narration, existingPayee = null) {
  const extracted = extractPayee(narration);
  return normalizePayee(extracted || existingPayee, narration);
}

function matchCustomRules(narration, payee, customRules = [], accountId = null) {
  if (!customRules?.length) return null;
  const text = normalizeWhitespace(narration);
  const payeeText = normalizeWhitespace(payee);
  const sorted = [...customRules]
    .filter((r) => r.is_active !== 0 && r.is_active !== false)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));

  for (const rule of sorted) {
    if (rule.account_id && accountId && Number(rule.account_id) !== Number(accountId)) continue;
    const field = String(rule.match_field || 'narration').toLowerCase();
    const haystack = field === 'payee' ? payeeText : text;
    if (!haystack) continue;
    const pattern = String(rule.pattern || '').trim();
    if (!pattern) continue;
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(haystack)) {
        return { category: rule.category, source: 'rule' };
      }
    } catch {
      if (haystack.toLowerCase().includes(pattern.toLowerCase())) {
        return { category: rule.category, source: 'rule' };
      }
    }
  }
  return null;
}

function suggestCategory(narration, withdrawal = 0, deposit = 0, customRules = [], accountId = null, payee = null) {
  const custom = matchCustomRules(narration, payee, customRules, accountId);
  if (custom) return custom;

  const text = normalizeWhitespace(narration);
  const resolvedPayee = normalizePayee(payee, text) || payee;

  // Directional internal transfers
  if (/^IO\s+For\b/i.test(text) || /IB\s*FUNDS\s*TRANSFER/i.test(text)) {
    if (Number(deposit) > 0 && Number(withdrawal) <= 0) {
      return { category: 'Transfer In', source: 'auto' };
    }
    if (Number(withdrawal) > 0) {
      return { category: 'Transfer Out', source: 'auto' };
    }
  }

  // Prefer payee-based investment match when narration is generic UPI
  if (resolvedPayee) {
    const payeeInvestment = [
      /raise securities/i,
      /moneylicious/i,
      /indian clearing/i,
      /shriram transport/i,
      /broker payout/i
    ];
    if (payeeInvestment.some((re) => re.test(resolvedPayee))) {
      return { category: 'Investment / Broker', source: 'auto' };
    }
    if (/bank interest/i.test(resolvedPayee)) {
      return { category: 'Interest Income', source: 'auto' };
    }
    if (/^fixed deposit$/i.test(resolvedPayee)) {
      return { category: 'Fixed Deposit', source: 'auto' };
    }
    if (/hdfc billpay/i.test(resolvedPayee)) {
      return { category: 'Bill Payment', source: 'auto' };
    }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return { category: rule.category, source: 'auto' };
    }
  }
  if (Number(deposit) > 0 && Number(withdrawal) <= 0) {
    return { category: 'Income / Credit', source: 'auto' };
  }
  if (Number(withdrawal) > 0) {
    return { category: 'Expense / Debit', source: 'auto' };
  }
  return { category: 'Uncategorized', source: 'auto' };
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

function finalizeParsedTxn(txn, accountId, customRules = []) {
  const narration = normalizeWhitespace(txn.narration);
  const withdrawal = Number(txn.withdrawal) || 0;
  const deposit = Number(txn.deposit) || 0;
  const txnDate = txn.txnDate;
  const valueDate = txn.valueDate || txnDate;
  const refNo = normalizeWhitespace(txn.refNo);
  const balance = txn.balance === null || txn.balance === undefined ? null : Number(txn.balance);
  const payee = resolvePayee(narration, txn.payee || null);
  let category = txn.category || null;
  let categorySource = txn.categorySource || txn.category_source || null;

  if (!category) {
    const suggested = suggestCategory(narration, withdrawal, deposit, customRules, accountId, payee);
    category = suggested.category;
    categorySource = suggested.source;
  } else if (!categorySource) {
    categorySource = 'auto';
  }

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
    category_source: categorySource,
    payee: payee || null,
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
  extractPayee,
  normalizePayee,
  resolvePayee,
  matchCustomRules,
  suggestCategory,
  detectTxnType,
  finalizeParsedTxn,
  CATEGORY_RULES,
  PAYEE_ALIASES
};
