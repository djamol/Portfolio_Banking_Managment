const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');
const { parseGenericXls } = require('./generic');

function detectKotak(textOrBuffer) {
  const text = Buffer.isBuffer(textOrBuffer)
    ? textOrBuffer.toString('utf8', 0, Math.min(textOrBuffer.length, 16000))
    : String(textOrBuffer || '');
  const sample = text.toLowerCase();
  if (/kotak mahindra|\bkotak\b|kkbk\d{4}/i.test(text)) return true;
  // Official Kotak netbanking CSV export
  if (
    sample.includes('withdrawal (dr.)') &&
    sample.includes('deposit (cr.)') &&
    (sample.includes('savings account transactions') ||
      sample.includes('chq/ref') ||
      sample.includes('account statement'))
  ) {
    return true;
  }
  return /transaction date.*debit.*credit/i.test(text);
}

function looksLikeKotakHeader(row) {
  const cells = (row || []).map((c) => normalizeWhitespace(c).toLowerCase());
  const joined = cells.join('|');
  return (
    cells.includes('date') &&
    (cells.includes('description') || joined.includes('narration')) &&
    (joined.includes('withdrawal') || joined.includes('debit')) &&
    (joined.includes('deposit') || joined.includes('credit')) &&
    joined.includes('balance')
  );
}

function isEmptyRow(row) {
  return !(row || []).some((c) => normalizeWhitespace(c));
}

function isFooterRow(row) {
  const joined = (row || [])
    .map((c) => normalizeWhitespace(c))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!joined) return false;
  if (joined.startsWith('please note')) return true;
  if (joined.includes('commonly used narrations')) return true;
  if (joined.includes('should not be construed as a tax invoice')) return true;
  if (joined.includes('goods and services tax')) return true;
  if (joined.startsWith('dear customer')) return true;
  return false;
}

function isEndOfStatementFooter(row) {
  const joined = (row || [])
    .map((c) => normalizeWhitespace(c))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    joined.includes('commonly used narrations') ||
    joined.startsWith('please note') ||
    joined.includes('should not be construed as a tax invoice')
  );
}

function isPageBannerRow(row) {
  const cells = (row || []).map((c) => normalizeWhitespace(c)).filter(Boolean);
  const joined = cells.join(' ').toLowerCase();
  if (!joined) return false;
  if (joined.includes('statement generated on')) return true;
  if (/^page\s+\d+\s+of\s+\d+/i.test(joined)) return true;
  if (joined.includes('savings account transactions')) return true;
  if (/^account no\.?\s*[0-9x]+$/i.test(joined)) return true;
  if (/^account statement\b/i.test(joined)) return true;
  // Lone account-holder name on a page break
  if (
    cells.length === 1 &&
    /^[A-Za-z][A-Za-z .'-]{2,}$/.test(cells[0]) &&
    !/[\/:]/.test(cells[0]) &&
    !/\d{1,2}\s+[A-Za-z]{3}/.test(cells[0])
  ) {
    return true;
  }
  return false;
}

function isOpeningBalanceRow(row) {
  const joined = (row || []).map((c) => normalizeWhitespace(c)).join(' ').toLowerCase();
  return joined.includes('opening balance');
}

function extractValueDate(narration) {
  const m = String(narration || '').match(
    /Value Date:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  return m ? parseBankDate(m[1]) : null;
}

function extractAccountMeta(rows) {
  const meta = {
    accountNumber: null,
    ifsc: null,
    customerName: null,
    statementFrom: null,
    statementTo: null,
    openingBalance: null
  };

  for (const row of rows.slice(0, 40)) {
    const cells = (row || []).map((c) => normalizeWhitespace(c));
    const joined = cells.join(' ');

    if (
      !meta.customerName &&
      cells[0] &&
      !/account statement|crn |micr |maharashtra|aurangabad|^n-11/i.test(cells[0])
    ) {
      if (
        /^[A-Za-z][A-Za-z .'-]{2,}$/.test(cells[0]) &&
        !/account|branch|nominee|currency/i.test(cells[0])
      ) {
        meta.customerName = cells[0];
      }
    }

    const period = joined.match(
      /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s*[-–]\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/
    );
    if (period) {
      meta.statementFrom = parseBankDate(period[1]);
      meta.statementTo = parseBankDate(period[2]);
    }

    for (const cell of cells) {
      const ac = cell.match(/Account No\.?\s*([0-9Xx]+)/i);
      if (ac) meta.accountNumber = ac[1];

      const ifsc =
        cell.match(/IFSC Code\s*(KKBK[0-9A-Z]+)/i) || cell.match(/\b(KKBK[0-9]{4,})\b/i);
      if (ifsc) meta.ifsc = ifsc[1].toUpperCase();
    }
  }

  return meta;
}

function mapHeaderIndexes(headerRow) {
  const headers = (headerRow || []).map((c) => normalizeWhitespace(c).toLowerCase());
  const find = (...needles) =>
    headers.findIndex((h) => needles.some((n) => h === n || h.includes(n)));

  return {
    dateIdx: find('date'),
    narrationIdx: find('description', 'narration', 'particulars'),
    refIdx: find('chq/ref', 'chq', 'ref'),
    withdrawalIdx: find('withdrawal'),
    depositIdx: find('deposit'),
    balanceIdx: find('balance')
  };
}

function parseKotakRows(rows, accountId) {
  const meta = extractAccountMeta(rows);
  const transactions = [];
  let indexes = null;
  let current = null;
  let inTransactions = false;
  let sawFooter = false;

  const flushCurrent = () => {
    if (!current) return;
    if (current.narration || current.withdrawal > 0 || current.deposit > 0) {
      const valueFromNarration = extractValueDate(current.narration);
      if (valueFromNarration) current.valueDate = valueFromNarration;
      transactions.push(current);
    }
    current = null;
  };

  for (const row of rows) {
    if (!row || !row.length || isEmptyRow(row)) continue;
    if (sawFooter) continue;

    if (isFooterRow(row)) {
      if (inTransactions && isEndOfStatementFooter(row)) {
        sawFooter = true;
        flushCurrent();
      }
      continue;
    }

    if (looksLikeKotakHeader(row)) {
      indexes = mapHeaderIndexes(row);
      inTransactions = true;
      continue;
    }

    if (!inTransactions || !indexes) continue;
    if (isOpeningBalanceRow(row)) {
      const balIdx = indexes.balanceIdx >= 0 ? indexes.balanceIdx : 6;
      const balRaw = normalizeWhitespace(row[balIdx]);
      if (balRaw && balRaw !== '-') {
        meta.openingBalance = parseIndianAmount(balRaw);
      }
      continue;
    }

    if (isPageBannerRow(row)) continue;

    const dateRaw = indexes.dateIdx >= 0 ? normalizeWhitespace(row[indexes.dateIdx]) : '';
    const txnDate = parseBankDate(dateRaw);
    const narrationPart =
      indexes.narrationIdx >= 0 ? normalizeWhitespace(row[indexes.narrationIdx]) : '';
    const refNo = indexes.refIdx >= 0 ? normalizeWhitespace(row[indexes.refIdx]) : '';
    const withdrawal =
      indexes.withdrawalIdx >= 0 ? parseIndianAmount(row[indexes.withdrawalIdx]) : 0;
    const deposit = indexes.depositIdx >= 0 ? parseIndianAmount(row[indexes.depositIdx]) : 0;
    const balanceRaw =
      indexes.balanceIdx >= 0 ? normalizeWhitespace(row[indexes.balanceIdx]) : '';
    const balance = balanceRaw && balanceRaw !== '-' ? parseIndianAmount(balanceRaw) : null;

    if (!txnDate) {
      if (current && narrationPart) {
        current.narration = normalizeWhitespace(`${current.narration} ${narrationPart}`);
      }
      continue;
    }

    flushCurrent();
    current = {
      txnDate,
      valueDate: txnDate,
      narration: narrationPart,
      refNo: refNo && refNo !== '-' ? refNo : '',
      withdrawal,
      deposit,
      balance,
      rawBank: 'KOTAK'
    };
  }

  flushCurrent();

  return {
    bank: 'KOTAK',
    meta: { ...meta, bank: 'KOTAK' },
    transactions: transactions.map((t) => finalizeParsedTxn(t, accountId))
  };
}

function parseKotakCsv(bufferOrString, accountId) {
  const text = Buffer.isBuffer(bufferOrString)
    ? bufferOrString.toString('utf8')
    : String(bufferOrString);

  const rows = parse(text, {
    relax_column_count: true,
    skip_empty_lines: false,
    trim: true
  });
  return parseKotakRows(rows, accountId);
}

function parseKotakStatement(buffer, accountId, ext = '.csv') {
  if (ext === '.csv' || ext === '.txt') {
    return parseKotakCsv(buffer, accountId);
  }

  try {
    const workbook = XLSX.read(buffer, { type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    const preview = rows
      .slice(0, 40)
      .map((r) => (r || []).join(','))
      .join('\n');
    if (detectKotak(preview) || rows.some((r) => looksLikeKotakHeader(r))) {
      return parseKotakRows(rows, accountId);
    }
  } catch {
    // fall through to generic
  }

  const result = parseGenericXls(buffer, accountId);
  return {
    ...result,
    bank: 'KOTAK',
    transactions: result.transactions.map((t) => ({ ...t, raw_bank: 'KOTAK' })),
    meta: { ...(result.meta || {}), bank: 'KOTAK' }
  };
}

module.exports = { detectKotak, parseKotakStatement, parseKotakCsv };
