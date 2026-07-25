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
  if (
    sample.includes('withdrawal (dr.)') &&
    sample.includes('deposit (cr.)') &&
    (sample.includes('savings account transactions') ||
      sample.includes('chq/ref') ||
      sample.includes('account statement'))
  ) {
    return true;
  }
  // Online/netbanking CSV: Sl. No. + Amount + Dr / Cr + Balance
  if (
    sample.includes('account statement') &&
    sample.includes('transaction date') &&
    sample.includes('dr / cr') &&
    (sample.includes('chq /ref') || sample.includes('description'))
  ) {
    return true;
  }
  return /transaction date.*debit.*credit/i.test(text);
}

function looksLikeKotakHeader(row) {
  const cells = (row || []).map((c) => normalizeWhitespace(c).toLowerCase());
  const joined = cells.join('|');
  if (
    (joined.includes('transaction date') || cells.includes('date')) &&
    (cells.includes('description') || joined.includes('narration')) &&
    joined.includes('balance')
  ) {
    // Classic: separate withdrawal + deposit columns
    if (
      (joined.includes('withdrawal') || joined.includes('debit')) &&
      (joined.includes('deposit') || joined.includes('credit'))
    ) {
      return true;
    }
    // Netbanking CSV: Amount + Dr / Cr
    if (joined.includes('amount') && joined.includes('dr / cr')) return true;
    if (joined.includes('sl. no') && joined.includes('amount') && joined.includes('dr')) return true;
  }
  return false;
}

function isEmptyRow(row) {
  return !(row || []).some((c) => normalizeWhitespace(c));
}

function rowJoined(row) {
  return (row || [])
    .map((c) => normalizeWhitespace(c))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isFooterRow(row) {
  const joined = rowJoined(row);
  if (!joined) return false;
  if (joined.startsWith('please note')) return true;
  if (joined.includes('commonly used narrations')) return true;
  if (joined.includes('should not be construed as a tax invoice')) return true;
  if (joined.includes('goods and services tax')) return true;
  if (joined.startsWith('dear customer')) return true;
  if (joined.includes('account summary')) return true;
  if (joined.includes('end of statement')) return true;
  return false;
}

function isEndOfStatementFooter(row) {
  const joined = rowJoined(row);
  return (
    joined.includes('commonly used narrations') ||
    joined.startsWith('please note') ||
    joined.includes('should not be construed as a tax invoice') ||
    joined.includes('account summary') ||
    joined.includes('end of statement')
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
  if (joined.includes('account summary')) return true;
  if (joined.includes('end of statement')) return true;
  if (joined.startsWith('particulars') && joined.includes('opening balance')) return true;
  if (joined.startsWith('contact us')) return true;
  if (joined.startsWith('important information')) return true;
  if (joined.startsWith('any discrepancy')) return true;
  if (joined.startsWith('remember!')) return true;
  if (joined.includes('system generated report')) return true;
  // Page-break name lines are full person names (2+ words), not short narration wraps like "Fund"
  if (
    cells.length === 1 &&
    /^[A-Za-z][A-Za-z .'-]{2,}$/.test(cells[0]) &&
    /\s/.test(cells[0]) &&
    cells[0].split(/\s+/).length >= 2 &&
    !/[\/:]/.test(cells[0]) &&
    !/\d{1,2}\s+[A-Za-z]{3}/.test(cells[0])
  ) {
    return true;
  }
  return false;
}

function isOpeningBalanceRow(row) {
  return rowJoined(row).includes('opening balance');
}

function extractValueDate(narration) {
  const cleaned = String(narration || '').replace(/\s+/g, ' ');
  let m = cleaned.match(/Value Date:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (!m) {
    m = cleaned.match(/Value Date:\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{2,4})/i);
    if (m) return parseBankDate(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return m ? parseBankDate(m[1]) : null;
}

function looksLikeContinuationNoise(text) {
  const t = normalizeWhitespace(text).toLowerCase();
  if (!t) return true;
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  if (t.includes('branch phone')) return true;
  if (t.includes('more safe')) return true;
  if (t.includes('banking tips')) return true;
  if (t.includes('toll-free')) return true;
  if (t.includes('kotak mahindra bank')) return true;
  if (t.startsWith('savings account (sa)')) return true;
  return false;
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

    // "Period","From 24/04/2026 To 25/07/2026"
    const periodFromTo = joined.match(
      /From\s+(\d{1,2}[\/\-,\.]\d{1,2}[\/\-,\.]\d{2,4})\s+To\s+(\d{1,2}[\/\-,\.]\d{1,2}[\/\-,\.]\d{2,4})/i
    );
    if (periodFromTo) {
      meta.statementFrom = parseBankDate(periodFromTo[1]);
      meta.statementTo = parseBankDate(periodFromTo[2]);
    }

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const next = cells[i + 1] || '';

      const ac = cell.match(/Account No\.?\s*([0-9Xx]+)/i);
      if (ac) meta.accountNumber = ac[1];
      if (/^Account No\.?$/i.test(cell) && /^\d{6,18}$/.test(next)) {
        meta.accountNumber = next;
      }

      const ifsc =
        cell.match(/IFSC Code\s*(KKBK[0-9A-Z]+)/i) || cell.match(/\b(KKBK[0-9]{4,})\b/i);
      if (ifsc) meta.ifsc = ifsc[1].toUpperCase();
      if (/^IFSC$/i.test(cell) && /^KKBK/i.test(next)) {
        meta.ifsc = next.toUpperCase();
      }
    }
  }

  return meta;
}

function mapHeaderIndexes(headerRow) {
  const headers = (headerRow || []).map((c) => normalizeWhitespace(c).toLowerCase());
  const find = (...needles) =>
    headers.findIndex((h) => needles.some((n) => h === n || h.includes(n)));

  const dateIdx = find('transaction date', 'txn date', 'date');
  const valueDateIdx = find('value date');
  const narrationIdx = find('description', 'narration', 'particulars');
  const refIdx = find('chq /ref', 'chq/ref', 'chq', 'ref no', 'ref');
  const withdrawalIdx = find('withdrawal');
  const depositIdx = find('deposit');
  // Prefer a true debit/credit amount column over generic "amount" when both exist
  let amountIdx = -1;
  let amountDrCrIdx = -1;
  let balanceIdx = find('balance');
  let balanceDrCrIdx = -1;

  headers.forEach((h, i) => {
    if (h === 'amount' || h === 'txn amount' || h === 'transaction amount') {
      if (amountIdx < 0) amountIdx = i;
    }
    if (h === 'dr / cr' || h === 'dr/cr' || h === 'type') {
      if (amountIdx >= 0 && i > amountIdx && amountDrCrIdx < 0 && (balanceIdx < 0 || i < balanceIdx)) {
        amountDrCrIdx = i;
      } else if (balanceIdx >= 0 && i > balanceIdx && balanceDrCrIdx < 0) {
        balanceDrCrIdx = i;
      } else if (amountDrCrIdx < 0) {
        amountDrCrIdx = i;
      }
    }
  });

  // Debit/Credit as separate columns (some exports)
  const debitIdx = find('debit');
  const creditIdx = find('credit');

  return {
    dateIdx,
    valueDateIdx,
    narrationIdx,
    refIdx,
    withdrawalIdx: withdrawalIdx >= 0 ? withdrawalIdx : debitIdx,
    depositIdx: depositIdx >= 0 ? depositIdx : creditIdx,
    amountIdx,
    amountDrCrIdx,
    balanceIdx,
    balanceDrCrIdx
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
    const valueDateRaw =
      indexes.valueDateIdx >= 0 ? normalizeWhitespace(row[indexes.valueDateIdx]) : '';
    const valueDate = parseBankDate(valueDateRaw) || txnDate;
    const narrationPart =
      indexes.narrationIdx >= 0 ? normalizeWhitespace(row[indexes.narrationIdx]) : '';
    const refNo = indexes.refIdx >= 0 ? normalizeWhitespace(row[indexes.refIdx]) : '';

    let withdrawal = 0;
    let deposit = 0;
    if (indexes.withdrawalIdx >= 0 || indexes.depositIdx >= 0) {
      withdrawal = indexes.withdrawalIdx >= 0 ? parseIndianAmount(row[indexes.withdrawalIdx]) : 0;
      deposit = indexes.depositIdx >= 0 ? parseIndianAmount(row[indexes.depositIdx]) : 0;
    } else if (indexes.amountIdx >= 0) {
      const amount = parseIndianAmount(row[indexes.amountIdx]);
      const drCr = normalizeWhitespace(
        indexes.amountDrCrIdx >= 0 ? row[indexes.amountDrCrIdx] : ''
      ).toUpperCase();
      if (drCr === 'DR' || drCr === 'DEBIT' || drCr.startsWith('D')) {
        withdrawal = amount;
      } else if (drCr === 'CR' || drCr === 'CREDIT' || drCr.startsWith('C')) {
        deposit = amount;
      } else if (amount > 0) {
        // Unknown flag — leave as deposit only if CR-like narration, else skip mis-assign
        deposit = amount;
      }
    }

    const balanceRaw =
      indexes.balanceIdx >= 0 ? normalizeWhitespace(row[indexes.balanceIdx]) : '';
    const balance = balanceRaw && balanceRaw !== '-' ? parseIndianAmount(balanceRaw) : null;

    if (!txnDate) {
      if (current && narrationPart && !looksLikeContinuationNoise(narrationPart)) {
        current.narration = normalizeWhitespace(`${current.narration} ${narrationPart}`);
      }
      continue;
    }

    flushCurrent();
    current = {
      txnDate,
      valueDate,
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
