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

  // Strip trailing time: 24-07-2026 20:14:18 / 24/07/2026T20:14:18
  const dateOnly = raw.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/, '').trim();

  let m = dateOnly.match(/^(\d{1,2})[\/\-,\.](\d{1,2})[\/\-,\.](\d{2,4})$/);
  if (m) {
    return ymdFromParts(m[1], m[2], m[3]);
  }

  m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dateOnly.slice(0, 10);

  // 01-May-2022 / 01/May/2022 / 01,May,2022
  m = dateOnly.match(/^(\d{1,2})[\/\-,\.]([A-Za-z]{3,9})[\/\-,\.](\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[2].toLowerCase()];
    if (mi) return ymdFromParts(m[1], mi, m[3]);
  }

  // Kotak CSV: 01 May 2022
  // Axis Excel: 06 Jan '14 / 06 Jan ’14
  // HDFC CC: 18 Mar, 2026
  m = dateOnly.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+['\u2019]?(\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[2].toLowerCase()];
    if (mi) return ymdFromParts(m[1], mi, m[3]);
  }

  // May 1, 2022 / May 01 2022
  m = dateOnly.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) {
    const mi = MONTH_MAP[m[1].toLowerCase()];
    if (mi) return ymdFromParts(m[2], mi, m[3]);
  }

  // Reject bare numbers / codes (e.g. "0", account balances) that Date() misparses
  if (/^\d+(\.\d+)?$/.test(dateOnly)) return null;

  const parsed = new Date(dateOnly);
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

// Hierarchical Category_SubCategory_Detail — prefer use/purpose over rail (UPI/NEFT).
// Order: specific merchants / purpose first; generic UPI last.
const CATEGORY_RULES = [
  {
    category: 'Income_Interest_Bank',
    patterns: [
      /INTEREST\s*CREDIT/i,
      /CREDIT\s*INTEREST/i,
      /Int\.Pd/i,
      /MONTHLY INTEREST/i,
      /SAVING.*INTEREST/i,
      /\bFD\s*Int\b/i,
      /FD Int/i,
      /Int\s+on\s+FD/i,
      /Int\s+on\s+RD/i,
      /IB\s*FD\s*PREMAT\s*INT\s*PAID/i,
      /NCD\s*INT/i,
      /INTRESET\s*PAYMENT/i
    ]
  },
  {
    category: 'Expense_Tax_TDS',
    patterns: [
      /TAX\s*RECOVERED/i,
      /TAX\s*RECOVERY/i,
      /INT\s*RECOVERY/i,
      /MONTHLY\s*TAX/i,
      /\bTDS\b/i,
      /INCOME\s*TAX/i,
      /DTAX/i,
      /FD\s*PREMAT\s*TAX/i
    ]
  },
  {
    category: 'Expense_Tax_GST',
    patterns: [
      /\bIGST\b/i,
      /\bCGST\b/i,
      /\bSGST\b/i,
      /IGST\s*\/\s*SGST\s*\/\s*CGST/i,
      /GST\s*TAX/i
    ]
  },
  {
    category: 'Investment_FD_Book',
    patterns: [
      /FD\s*BOOKED/i,
      /FD\s*THROUGH/i,
      /TRF\s*TO\s*FD/i,
      /FIXED\s*DEPOSIT/i,
      /DIGITAL\s*FD/i,
      /SELF\s*FOR\s*FD/i
    ]
  },
  {
    category: 'Investment_FD_Close',
    patterns: [
      /FD\s*PREMATURE/i,
      /FD\s*CLOSURE/i,
      /FD\s*PREMAT\s*PRINCIPAL/i,
      /PRINCIPAL\s*AUTO\s*REDEEM/i,
      /IB\s*FD\s*PREMAT\s*PRINCIPAL/i
    ]
  },
  {
    category: 'Income_Salary_Payroll',
    patterns: [/SALARY/i, /PAYROLL/i, /NEFT\s*CR.*SAL/i, /\bMYSAL\b/i, /\bPersistent\b/i]
  },
  {
    category: 'Investment_MutualFund_Purchase',
    patterns: [
      /ZERODHA/i,
      /GROWW/i,
      /\bDHAN\b/i,
      /MUTUAL\s*FUND/i,
      /MUTUALFUND/i,
      /MFPAYMENT/i,
      /\bMFP-/i,
      /EBA\/MFP/i,
      /CAMS/i,
      /KARVY/i,
      /KFINTECH/i,
      /MONEYLICIO/i,
      /RAISE\s*SECUR/i,
      /RAISESECURITIES/i,
      /BSESTARMF/i,
      /bsestarmf/i,
      /INDIANCLEARING/i,
      /INDIAN\s*CLEARING/i,
      /CLEARING\s*CORPORATION/i,
      /SHRIRAM\s*TRANSPORT/i
    ]
  },
  {
    category: 'Investment_Broker_Trading',
    patterns: [/\bPAYOUT\b/i, /\bACTIVITY\b/i, /\bNSE\b|\bBSE\b/i]
  },
  {
    category: 'Income_Insurance_Payout',
    patterns: [/HDFCLIFE/i, /LIC\s*OF\s*INDIA/i, /INSURANCE\s*CLAIM/i]
  },
  {
    category: 'Expense_Insurance_Premium',
    patterns: [
      /INSUR/i,
      /PREMIUM/i,
      /HDFC\s*LIFE/i,
      /\bLIC\b.*PREM/i,
      /TATA\s*AIA/i,
      /TATAAIA/i,
      /WWW\s*TATAAIA/i
    ]
  },
  {
    category: 'Expense_Loan_EMI',
    patterns: [/\bACH\s*D[- ]/i, /\bEMI\b/i, /LOAN\s*EMI/i, /BILLDKHDFC/i]
  },
  {
    category: 'Expense_Land_Purchase',
    patterns: [/PLOT\s*AMOU/i, /LAND\s*PURCHASE/i, /P\s*B\s*DEVELOPERS/i]
  },
  {
    category: 'Bills_Telecom_Mobile',
    patterns: [
      /JIOIN/i,
      /\bMYJIO\b/i,
      /JIORECHARGE/i,
      /gpayrecharge/i,
      /TATA\s*DOCOMO/i,
      /UNINOR/i,
      /\bAIRTEL\b/i,
      /GOOGLE\s*IND.*RECHARGE/i,
      /BHARAT\s*SANCHAR/i,
      /\bBSNL\b/i,
      /CRED\s*TELECOM/i
    ]
  },
  {
    category: 'Bills_Utility_Other',
    patterns: [
      /\bBIL\//i,
      /BILLPAY/i,
      /HDFCBILLPAY/i,
      /BBPS\//i,
      /ELECTRICITY/i,
      /GAS\s*BILL/i,
      /WATER\s*BILL/i,
      /BILLDESK/i,
      /CHEQ\s*DIGITAL/i,
      /\bCHEQ\b/i,
      /CRED\s*Club/i,
      /CRED\s*VISA/i,
      /\bCRED\b/i
    ]
  },
  {
    category: 'Travel_Transit_Metro',
    patterns: [/PUNE\s*METRO/i, /METRO\s*CCA/i]
  },
  {
    category: 'Travel_Transit_Bus',
    patterns: [/\bMSRTC\b/i, /\bPMPML\b/i, /\bREDBUS\b/i]
  },
  {
    category: 'Travel_Transit_Rail',
    patterns: [/\bIRCTC\b/i]
  },
  {
    category: 'Travel_Cab_Ride',
    patterns: [/\bUBER\b/i, /\bOLA\b/i, /RAPIDO/i]
  },
  {
    // Petrol / diesel / CNG pump spends (not Expense_Other_Debit)
    category: 'Travel_Fuel_Petrol',
    patterns: [
      /PETROL/i,
      /PETROLEUM/i,
      /\bBPCL\b/i,
      /\bHPCL\b/i,
      /\bIOCL\b/i,
      /INDIAN\s*OIL\s*CORP/i,
      /INDIAN\s*OIL/i,
      /\bINDIANOIL\b/i,
      /FASTAG/i,
      /H\s*P\s*AUTO\s*CARE/i,
      /HP\s*AUTO\s*CARE/i,
      /HP\s*SERVICE\s*CENT/i,
      /HP\s*AUTO\s*CARE\s*CENTER/i,
      /ADHIRA\s*PETROL/i,
      /\bCNG\b/i,
      /FUEL\s*STATION/i,
      /PETROL\s*PUMP/i
    ]
  },
  {
    category: 'Food_Delivery_Online',
    patterns: [/SWIGGY/i, /ZOMATO/i]
  },
  {
    category: 'Food_Cafe_Snacks',
    patterns: [/MEET\s*EAT/i, /JUICE\s*CENTER/i, /SNACKS/i]
  },
  {
    category: 'Food_Dairy_Store',
    patterns: [/DIARY/i, /DAIRY/i]
  },
  {
    // DMart legal entity often appears as AVENUE SUPERMARTS / AVENUE E COMMERCE (no "DMART" token)
    category: 'Food_Grocery_Store',
    patterns: [
      /DMART/i,
      /D[\s\-]?MART/i,
      /AVENUE\s*SUPER\s*MARTS?/i,
      /AVENUE\s*SUPERMARTS?/i,
      /AVENUE\s*E[\s\-]?COMMERCE/i,
      /BIGBASKET/i,
      /BLINKIT/i,
      /ZEPTO/i,
      /GENRAL\s*STORE/i,
      /GENERAL\s*STORE/i
    ]
  },
  {
    category: 'Shopping_Online_Amazon',
    patterns: [/AMAZON/i, /PAYUAMAZON/i]
  },
  {
    category: 'Shopping_Online_Flipkart',
    patterns: [/FLIPKART/i]
  },
  {
    category: 'Shopping_Online_Other',
    patterns: [
      /EBAY/i,
      /PAYU/i,
      /\bONL\b/i,
      /NUCLEARTRIP/i,
      /LENSKART/i,
      /BOATLIFESTYLE/i,
      /GOOGLE\s*\*?\s*PLAY/i,
      /DREAMSCAPE\s*NETWORKS/i,
      /RACKNERD/i
    ]
  },
  {
    category: 'Shopping_Ads_Marketing',
    patterns: [/FACEBOOK\s*COM\s*ADS/i, /WWW\s*FACEBOOK\s*COM\s*ADS/i, /META\s*ADS/i]
  },
  {
    category: 'Payment_International_PayPal',
    patterns: [/PAYPAL/i, /OPGSP/i]
  },
  {
    category: 'Expense_ATM_Cash',
    patterns: [/\bATM\b/i, /CASH\s*WDL/i, /CASH\s*DEP/i, /\bNWD-/i, /\bEAW-/i, /\bATW-/i, /\bCCWD\b/i]
  },
  {
    // Do NOT match bare "CREDIT CARD" — CC payment credits falsely hit that
    category: 'Expense_Card_POS',
    patterns: [/\bPOS\b/i, /CRV\s*POS/i, /VISA\s*POS/i, /MASTERCARD\s*POS/i]
  },
  {
    category: 'Recharge_Mobile_Prepaid',
    patterns: [/RECHARGE/i, /OXIGEN/i, /PREPAID/i, /\bRCHG\b/i]
  },
  {
    category: 'Transfer_Card_Payment',
    patterns: [
      /NETBANKING\s*TRANSFER/i,
      /AUTOPAY\s*THANK\s*YOU/i,
      /INFINITY\s*PAYMENT\s*RECEIVED/i,
      /AUTODEBIT\s*PAYMENT\s*RECD/i,
      /CLICK\s*TO\s*PAY\s*PAYMENT\s*RECEIVED/i,
      /NEFT\s*PAYMENT\s*RECEIVED/i,
      /NEFT\s*CREDIT\s*CARD\s*PAYMENT/i,
      /CREDIT\s*CARD\s*PAYMENT/i,
      /ONLINE\s*TRF\s*[-–]?\s*PYMT\s*RECD/i,
      /BPPY\s*CC\s*PAYMENT/i,
      /BBPS\s*PAYMENT\s*RECEIVED/i,
      /TELE\s*TRANSFER\s*CREDIT/i,
      /IMPS\s*PMT\b/i,
      /PAYMENT\s*RECEIVED,?\s*THANK\s*YOU/i
    ]
  },
  {
    category: 'Transfer_Internal_Bank',
    patterns: [/IB\s*FUNDS\s*TRANSFER/i, /INTERNAL\s*TRANSFER/i, /^IO\s+For\b/i]
  },
  {
    category: 'Transfer_Other_In',
    patterns: [
      /NEFT\s*CR/i,
      /IMPS.*\bCR\b/i,
      /IFT.*CR/i,
      /INF\//i,
      /NACH-CR/i,
      /NACH-ECS-CR/i
    ]
  },
  {
    category: 'Transfer_Other_Out',
    patterns: [/NEFT\s*DR/i, /IMPS.*\bDR\b/i, /IB\s*FUNDS\s*TRANSFER\s*DR/i, /TPT-/i, /\bRTGS\b.*DR/i]
  },
  {
    category: 'Income_Cashback_Card',
    patterns: [
      /PETRO\s*SURCHARGE\s*WAIVER/i,
      /REV\s*OF\s*HPCL\s*SURCHARGE/i,
      /HPCL\s*SURCHARGE\s*REV/i,
      /EXGRATIA\s*INTEREST\s*REFUND/i,
      /SURCHARGE\s*WAIVER/i
    ]
  },
  {
    category: 'Expense_Bank_Charges',
    patterns: [
      /CHGS/i,
      /CHARGES/i,
      /Nchg/i,
      /SMS\s*ALERT/i,
      /AMCB/i,
      /\bFEE\b/i,
      /LATE\s*FEE/i,
      /FINANCE\s*CHARGES?/i,
      /REDEMPTION\s*PROC\s*FEE/i,
      /REWARD\s*REDEMPTION\s*HANDLING/i,
      /AUTO\s*DEBIT\s*RETURN\s*FEE/i,
      /\bDCC\b/i,
      /%\s*ON\s*ALL\s*DCC/i,
      /SER\s*TAX/i,
      /ED\s*CESS/i,
      /\bDPCHG\b/i,
      /ATMDEC\s*CHG/i,
      /NWD\s*DECCHG/i
    ]
  },
  {
    category: 'Expense_Cheque_Paid',
    patterns: [/CHQ\s*PAID/i, /CHEQUE/i, /\bMICR\b/i]
  },
  // Rail only — last resort when purpose unknown
  {
    category: 'Expense_Peer_UPI',
    patterns: [/\bUPI\b/i, /@upi/i, /UPI-/i, /UPI\//i, /UPI:PAY/i, /UPI:COLLECT/i]
  }
];

/** Canonical merchant names for fragmented bank truncations */
const PAYEE_ALIASES = [
  { canonical: 'Raise Securities', patterns: [/raise\s*secu/i, /raisesecurities/i] },
  { canonical: 'Moneylicious Securities', patterns: [/moneylicio/i] },
  {
    canonical: 'Indian Clearing Corporation',
    patterns: [/indian\s*clearing/i, /indianclearing/i, /clearing\s*corporation/i, /bsestarmf/i]
  },
  {
    canonical: 'Amol Vishnu Patil',
    patterns: [
      /\bamol\s*vishnu\s*pati?l?\b/i,
      /\bamol\s*vishnu\s*pa\b/i,
      /\bamolvishnupatil\b/i,
      /\bamol\s*vishn\b/i,
      /^amol$/i,
      /^amol\s*patil$/i
    ]
  },
  {
    canonical: 'Vishnu Karbhari Patil',
    patterns: [/vishnu\s*kar/i, /vishnu\s*karbhari/i]
  },
  {
    canonical: 'Prajakta Vishnu Patil',
    patterns: [/prajakta/i]
  },
  {
    canonical: 'Pratibha Vishnu Patil',
    patterns: [/pratibha/i]
  },
  {
    canonical: 'Shriram Transport Finance',
    patterns: [/shriram\s*transport/i, /transport\s*fi(nance)?/i, /finance\s*ltd\s*erstwhile\s*shri/i]
  },
  { canonical: 'Suryoday Small Finance Bank', patterns: [/suryoday/i] },
  { canonical: 'Utkarsh Small Finance Bank', patterns: [/utkarsh/i] },
  { canonical: 'Shivalik Small Finance Bank', patterns: [/shivalik/i] },
  { canonical: 'PhonePe', patterns: [/phonepe/i] },
  { canonical: 'Paytm', patterns: [/\bpaytm\b/i] },
  { canonical: 'HDFC BillPay', patterns: [/hdfcbillpay/i] },
  { canonical: 'djamolgroup', patterns: [/djamolgroup/i] },
  { canonical: 'Bank Interest', patterns: [/^bank interest$/i] },
  { canonical: 'Fixed Deposit', patterns: [/^fixed deposit$/i] },
  { canonical: 'Internal Transfer', patterns: [/^internal transfer$/i] },
  { canonical: 'Broker Payout', patterns: [/^broker payout$/i] },
  { canonical: 'ATM Withdrawal', patterns: [/^atm withdrawal$/i] },
  { canonical: 'Pune Metro', patterns: [/pune\s*metro/i] },
  { canonical: 'MSRTC', patterns: [/\bmsrtc\b/i] },
  { canonical: 'PMPML', patterns: [/\bpmpml\b/i] },
  { canonical: 'CRED', patterns: [/\bcred\s*club\b/i, /^cred$/i] },
  { canonical: 'CHEQ', patterns: [/\bcheq\b/i] },
  { canonical: 'Jio', patterns: [/\bjioin\b/i, /\bmyjio\b/i, /jio\.easebuzz/i] },
  { canonical: 'DMart', patterns: [/dmart/i, /avenue\s*supermarts?/i, /avenue\s*e[\s\-]?commerce/i] },
  { canonical: 'Indian Oil', patterns: [/indian\s*oil/i, /\biocl\b/i] },
  { canonical: 'HP Petrol', patterns: [/h\s*p\s*auto\s*care/i, /hp\s*auto\s*care/i, /hp\s*service\s*cent/i, /\bhpcl\b/i] },
  { canonical: 'BSNL', patterns: [/bharat\s*sanchar/i, /\bbsnl\b/i] },
  { canonical: 'RedBus', patterns: [/\bredbus\b/i] },
  { canonical: 'Tata AIA', patterns: [/tata\s*aia/i, /tataaia/i] },
  { canonical: 'Dhan', patterns: [/\bdhan\b/i] }
];

const SELF_OWN_PAYEES = new Set([
  'Amol Vishnu Patil',
  'djamolgroup',
  'Internal Transfer'
]);

const FAMILY_PAYEES = new Set([
  'Vishnu Karbhari Patil',
  'Prajakta Vishnu Patil',
  'Pratibha Vishnu Patil'
]);

const INVESTMENT_PAYEES = [
  /raise securities/i,
  /moneylicious/i,
  /indian clearing/i,
  /shriram transport/i,
  /broker payout/i,
  /^dhan$/i
];

const SMALL_FINANCE_FD_PAYEES = [
  /suryoday/i,
  /utkarsh/i,
  /shivalik/i
];

function isTransferCategory(category) {
  const c = String(category || '');
  return (
    c === 'Transfer In' ||
    c === 'Transfer Out' ||
    c.startsWith('Transfer_')
  );
}

function isInterestCategory(category) {
  const c = String(category || '');
  return c === 'Interest Income' || c.startsWith('Income_Interest');
}

function isTaxCategory(category) {
  const c = String(category || '');
  return c === 'TDS / Tax' || c.startsWith('Expense_Tax');
}

function isFdBookCategory(category) {
  const c = String(category || '');
  return c === 'Fixed Deposit' || c === 'Investment_FD_Book';
}

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

  if (/INTEREST\s*CREDIT|MONTHLY\s*INTEREST|CREDIT\s*INTEREST|Int\.Pd|Int\s+on\s+FD|Int\s+on\s+RD/i.test(text)) {
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

/** Petrol / diesel / CNG pump merchants (Indian Oil, HP, BPCL, etc.) */
function isFuelPumpNarration(text) {
  return (
    /INDIAN\s*OIL/i.test(text) ||
    /\bINDIANOIL\b/i.test(text) ||
    /\bIOCL\b/i.test(text) ||
    /H\s*P\s*AUTO\s*CARE/i.test(text) ||
    /HP\s*AUTO\s*CARE/i.test(text) ||
    /HP\s*SERVICE\s*CENT/i.test(text) ||
    /\bHPCL\b/i.test(text) ||
    /\bBPCL\b/i.test(text) ||
    /ADHIRA\s*PETROL/i.test(text) ||
    /PETROL\s*PUMP/i.test(text) ||
    /FUEL\s*STATION/i.test(text) ||
    (/\bPETROL/i.test(text) && !/SURCHARGE\s*WAIVER/i.test(text)) ||
    /\bPETROLEUM\b/i.test(text)
  );
}

function suggestCategory(narration, withdrawal = 0, deposit = 0, customRules = [], accountId = null, payee = null) {
  const custom = matchCustomRules(narration, payee, customRules, accountId);
  if (custom) return custom;

  const text = normalizeWhitespace(narration);
  const resolvedPayee = normalizePayee(payee, text) || payee;
  const isCredit = Number(deposit) > 0 && Number(withdrawal) <= 0;
  const isDebit = Number(withdrawal) > 0;

  // Fuel / petrol-pump debits first (never Expense_Other_Debit)
  // e.g. INDIAN OIL CORPORATION…, HP AUTO CARE CENTER…
  if (isDebit && isFuelPumpNarration(text)) {
    return { category: 'Travel_Fuel_Petrol', source: 'auto' };
  }
  if (
    isCredit &&
    (/PETRO\s*SURCHARGE\s*WAIVER/i.test(text) ||
      /REV\s*OF\s*HPCL\s*SURCHARGE/i.test(text) ||
      /HPCL\s*SURCHARGE\s*REV/i.test(text) ||
      /SURCHARGE\s*WAIVER/i.test(text))
  ) {
    return { category: 'Income_Cashback_Card', source: 'auto' };
  }

  // Credit-card statement payments / autopay (credits) — not income
  if (
    isCredit &&
    (/NETBANKING\s*TRANSFER/i.test(text) ||
      /AUTOPAY\s*THANK\s*YOU/i.test(text) ||
      /INFINITY\s*PAYMENT\s*RECEIVED/i.test(text) ||
      /AUTODEBIT\s*PAYMENT\s*RECD/i.test(text) ||
      /CLICK\s*TO\s*PAY\s*PAYMENT\s*RECEIVED/i.test(text) ||
      /NEFT\s*PAYMENT\s*RECEIVED/i.test(text) ||
      /NEFT\s*CREDIT\s*CARD\s*PAYMENT/i.test(text) ||
      /CREDIT\s*CARD\s*PAYMENT/i.test(text) ||
      /ONLINE\s*TRF\s*[-–]?\s*PYMT\s*RECD/i.test(text) ||
      /BPPY\s*CC\s*PAYMENT/i.test(text) ||
      /BBPS\s*PAYMENT\s*RECEIVED/i.test(text) ||
      /TELE\s*TRANSFER\s*CREDIT/i.test(text) ||
      /IMPS\s*PMT\b/i.test(text) ||
      /PAYMENT\s*RECEIVED,?\s*THANK\s*YOU/i.test(text) ||
      (/CHEQ\s*DIGITAL/i.test(text) && /RECEIVED|GURGAON/i.test(text)) ||
      /CRED\s*VISA\s*DIRECT/i.test(text))
  ) {
    return { category: 'Transfer_Card_Payment', source: 'auto' };
  }

  // Directional internal bank transfers
  if (/^IO\s+For\b/i.test(text) || /IB\s*FUNDS\s*TRANSFER/i.test(text)) {
    if (isCredit) return { category: 'Transfer_Internal_Bank', source: 'auto' };
    if (isDebit) return { category: 'Transfer_Internal_Bank', source: 'auto' };
  }

  // Rent between own/family accounts
  if (/\brent\b/i.test(text) && resolvedPayee && (SELF_OWN_PAYEES.has(resolvedPayee) || FAMILY_PAYEES.has(resolvedPayee))) {
    return { category: 'Transfer_Family_Rent', source: 'auto' };
  }

  // MF / broker narrations even when counterparty name is self (e.g. Axis InvestNow NEFT)
  // Use INDIAN CLEARING (not INDIAN CLEA) so INDIAN OIL CORPORATION never matches
  if (
    /MUTUAL\s*FUND|MUTUALFUND|INVESTNOW|MONEYLICIO|RAISE\s*SECU|INDIAN\s*CLEARING|INDIANCLEARING|CLEARING\s*CORPORATION|BSESTARMF|EBA\/MFP|\bMFP-/i.test(
      text
    )
  ) {
    return {
      category: isCredit ? 'Investment_MutualFund_Redemption' : 'Investment_MutualFund_Purchase',
      source: 'auto'
    };
  }

  // Self / family UPI & transfers (purpose > rail)
  if (resolvedPayee && SELF_OWN_PAYEES.has(resolvedPayee)) {
    if (/FD\s*THROUGH|TRF\s*TO\s*FD|FD\s*BOOKED|DIGITAL\s*FD|SELF\s*FOR\s*FD|FOR\s*FD/i.test(text)) {
      return { category: 'Investment_FD_Book', source: 'auto' };
    }
    return { category: 'Transfer_Self_Own', source: 'auto' };
  }
  if (resolvedPayee && FAMILY_PAYEES.has(resolvedPayee)) {
    return { category: isCredit ? 'Transfer_Family_In' : 'Transfer_Family_Out', source: 'auto' };
  }

  if (resolvedPayee) {
    if (INVESTMENT_PAYEES.some((re) => re.test(resolvedPayee))) {
      if (isCredit) return { category: 'Investment_MutualFund_Redemption', source: 'auto' };
      return { category: 'Investment_MutualFund_Purchase', source: 'auto' };
    }
    if (SMALL_FINANCE_FD_PAYEES.some((re) => re.test(resolvedPayee))) {
      return { category: isCredit ? 'Investment_FD_Close' : 'Investment_FD_Book', source: 'auto' };
    }
    if (/bank interest/i.test(resolvedPayee)) {
      return { category: 'Income_Interest_Bank', source: 'auto' };
    }
    if (/^fixed deposit$/i.test(resolvedPayee)) {
      return { category: 'Investment_FD_Book', source: 'auto' };
    }
    if (/hdfc billpay/i.test(resolvedPayee)) {
      return { category: 'Bills_Utility_Other', source: 'auto' };
    }
    if (/^cred$/i.test(resolvedPayee) || /^cheq$/i.test(resolvedPayee)) {
      return { category: isCredit ? 'Transfer_Card_Payment' : 'Bills_Utility_Other', source: 'auto' };
    }
    if (/^jio$/i.test(resolvedPayee) || /^bsnl$/i.test(resolvedPayee)) {
      return { category: 'Bills_Telecom_Mobile', source: 'auto' };
    }
    if (/^dmart$/i.test(resolvedPayee)) {
      return { category: 'Food_Grocery_Store', source: 'auto' };
    }
    if (/indian oil|^hp petrol$/i.test(resolvedPayee)) {
      if (isDebit) return { category: 'Travel_Fuel_Petrol', source: 'auto' };
      // credits at pump merchants are rare; leave for waiver / generic credit rules
    }
    if (/pune metro|msrtc|pmpml|redbus/i.test(resolvedPayee)) {
      if (/metro/i.test(resolvedPayee)) return { category: 'Travel_Transit_Metro', source: 'auto' };
      return { category: 'Travel_Transit_Bus', source: 'auto' };
    }
  }

  // MF redemption credits often say Mutual Fund / Clearing without debit patterns
  if (isCredit && /MUTUAL\s*FUND|INDIAN\s*CLEARING|INDIANCLEARING|CLEARING\s*CORPORATION|KMMF\s*REDEMPTION/i.test(text)) {
    return { category: 'Investment_MutualFund_Redemption', source: 'auto' };
  }

  // Bond / NCD interest style credits
  if (isCredit && (/\bREC\b/i.test(text) || /NCD\s*INT|INTRESET\s*PAYMENT|MMFSLINT/i.test(text))) {
    return { category: 'Income_Interest_Bond', source: 'auto' };
  }

  for (const rule of CATEGORY_RULES) {
    if (!rule.patterns.some((re) => re.test(text))) continue;
    let category = rule.category;
    // Refine MF direction and peer UPI
    if (category === 'Investment_MutualFund_Purchase' && isCredit) {
      category = 'Investment_MutualFund_Redemption';
    }
    if (category === 'Expense_Peer_UPI') {
      category = isCredit ? 'Income_Peer_UPI' : 'Expense_Peer_UPI';
    }
    if (category === 'Travel_Fuel_Petrol' && isCredit) {
      continue; // e.g. HPCL cashback / CRV — not fuel spend
    }
    if (category === 'Transfer_Card_Payment' && isDebit) {
      continue; // payment patterns are credit-side on CC statements
    }
    if (category === 'Bills_Utility_Other' && isCredit) {
      // CRED/CHEQ/BBPS credits on CC = card repayment, not utility spend
      if (/BBPS|CHEQ|CRED|PAYMENT\s*RECEIVED/i.test(text)) {
        return { category: 'Transfer_Card_Payment', source: 'auto' };
      }
    }
    if (category === 'Expense_Tax_GST' && isCredit) {
      category = 'Income_Cashback_Card'; // GST / tax reversal on card
    }
    if (category === 'Expense_Bank_Charges' && isCredit) {
      // Fee reversal stays under bank charges for netting, unless explicit waiver
      if (/WAIVER|SURCHARGE\s*REV|EXGRATIA/i.test(text)) {
        category = 'Income_Cashback_Card';
      }
    }
    if (category === 'Transfer_Other_In' && isDebit) category = 'Transfer_Other_Out';
    if (category === 'Transfer_Other_Out' && isCredit) category = 'Transfer_Other_In';
    return { category, source: 'auto' };
  }

  if (isCredit) return { category: 'Income_Other_Credit', source: 'auto' };
  if (isDebit) return { category: 'Expense_Other_Debit', source: 'auto' };
  return { category: 'Uncategorized', source: 'auto' };
}

function detectTxnType(withdrawal, deposit, narration = '') {
  const w = Number(withdrawal) || 0;
  const d = Number(deposit) || 0;
  const text = narration || '';
  if (/INTEREST/i.test(text) && d > 0) return 'interest';
  if (/TAX\s*RECOVERED|TAX\s*RECOVERY|TDS/i.test(text) && w > 0) return 'tax';
  if (/FD\s*BOOKED|FD\s*THROUGH|TRF\s*TO\s*FD/i.test(text)) return 'fd_book';
  if (/FD\s*(CLOSURE|PREMATURE|MATUR)|PRINCIPAL\s*AUTO\s*REDEEM/i.test(text)) return 'fd_maturity';
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
  isTransferCategory,
  isInterestCategory,
  isTaxCategory,
  isFdBookCategory,
  CATEGORY_RULES,
  PAYEE_ALIASES
};
