const XLSX = require('xlsx');
const {
  normalizeWhitespace,
  parseIndianAmount,
  parseBankDate,
  finalizeParsedTxn
} = require('./common');

function sheetToRows(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  };
}

function rowJoined(row) {
  return row.map((c) => normalizeWhitespace(c).toLowerCase()).join('|');
}

function isOnlineHeader(joined) {
  return (
    (joined.includes('transaction date') || joined.includes('value date')) &&
    (joined.includes('withdrawal') || joined.includes('deposit')) &&
    (joined.includes('remarks') || joined.includes('narration') || joined.includes('description'))
  );
}

function isStatementHeader(joined) {
  // Monthly PDF/Excel statement: DATE | MODE | PARTICULARS | DEPOSITS | WITHDRAWALS | BALANCE
  return (
    (/(^|\|)date(\||$)/.test(joined) || joined.includes('|date|')) &&
    joined.includes('particulars') &&
    (joined.includes('deposit') || joined.includes('withdrawal')) &&
    joined.includes('balance')
  );
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 120); i++) {
    const joined = rowJoined(rows[i]);
    if (isOnlineHeader(joined) || isStatementHeader(joined)) return i;
  }
  return -1;
}

function mapHeaderIndexes(headerRow) {
  const idx = {
    sNo: -1,
    valueDate: -1,
    txnDate: -1,
    cheque: -1,
    mode: -1,
    remarks: -1,
    withdrawal: -1,
    deposit: -1,
    balance: -1
  };

  headerRow.forEach((cell, i) => {
    const c = normalizeWhitespace(cell).toLowerCase();
    if (!c) return;
    if (c.includes('s no') || c === 's.no.' || c === 'sno') idx.sNo = i;
    else if (c.includes('value date')) idx.valueDate = i;
    else if (c.includes('transaction date') || c === 'date') idx.txnDate = i;
    else if (c.includes('cheque')) idx.cheque = i;
    else if (c === 'mode') idx.mode = i;
    else if (
      c.includes('remark') ||
      c.includes('narration') ||
      c.includes('description') ||
      c.includes('particular')
    ) {
      idx.remarks = i;
    } else if (c.includes('withdrawal')) idx.withdrawal = i;
    else if (c.includes('deposit')) idx.deposit = i;
    else if (c.includes('balance')) idx.balance = i;
  });
  return idx;
}

function extractIciciMeta(rows) {
  const meta = { accountNumber: null, customerName: null, statementFrom: null, statementTo: null };

  for (const row of rows.slice(0, 80)) {
    const cells = row.map((c) => normalizeWhitespace(c));
    const joined = cells.filter(Boolean).join(' ');

    for (let i = 0; i < cells.length; i++) {
      if (/account number/i.test(cells[i])) {
        const value = cells.slice(i + 1).find((c) => c) || '';
        const m = value.match(/(\d{9,18})/);
        if (m) meta.accountNumber = m[1];
        const nameMatch = value.match(/-\s*(.+)$/);
        if (nameMatch) meta.customerName = nameMatch[1].trim();
      }
      if (/transaction date from/i.test(cells[i])) {
        const dates = cells.slice(i + 1).filter((c) => parseBankDate(c));
        if (dates[0]) meta.statementFrom = parseBankDate(dates[0]);
        if (dates[1]) meta.statementTo = parseBankDate(dates[1]);
      }
    }

    // Monthly statement: "Statement of Transactions in Savings Account Number: 350401500159 ... period Nov ... - Nov ..."
    const acct = joined.match(/Account Number\s*:?\s*(\d{9,18})/i);
    if (acct) meta.accountNumber = acct[1];

    const period = joined.match(
      /period\s+(\d{1,2}[\/\-]\w+[\/\-]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-–]\s*(\d{1,2}[\/\-]\w+[\/\-]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    );
    if (period) {
      meta.statementFrom = parseBankDate(period[1]) || meta.statementFrom;
      meta.statementTo = parseBankDate(period[2]) || meta.statementTo;
    }

    if (/^MR\.|^MRS\.|^MS\./i.test(joined) && !meta.customerName) {
      meta.customerName = joined.replace(/^MR\.|^MRS\.|^MS\./i, '').trim();
    }
  }

  return meta;
}

function isNoiseOrSummary(text) {
  const t = normalizeWhitespace(text);
  if (!t) return true;
  if (/^balance brought forward$/i.test(t)) return true;
  if (/^total:?$/i.test(t)) return true;
  if (/^page\s+\d+\s+of\s+\d+/i.test(t)) return true;
  if (/statement of transactions/i.test(t)) return true;
  if (/summary of accounts/i.test(t)) return true;
  if (/never share your card/i.test(t)) return true;
  if (/legends used/i.test(t)) return true;
  return false;
}

function cellAt(row, idx) {
  if (idx < 0 || !row) return '';
  return row[idx];
}

function parseIciciXls(buffer, accountId) {
  const workbook = XLSX.read(buffer, { type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary' });
  const { rows } = sheetToRows(workbook);
  const meta = extractIciciMeta(rows);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error('Could not find ICICI transaction header row');
  }

  const idx = mapHeaderIndexes(rows[headerIdx]);
  if (idx.txnDate < 0 && idx.valueDate < 0) {
    throw new Error('ICICI header found but date column missing');
  }
  if (idx.remarks < 0 && idx.withdrawal < 0 && idx.deposit < 0) {
    throw new Error('ICICI header found but amount/narration columns missing');
  }

  const transactions = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (
      !isNoiseOrSummary(current.narration) &&
      (current.narration || current.withdrawal > 0 || current.deposit > 0)
    ) {
      // Skip pure opening balance rows (no movement)
      if (
        !/balance brought forward/i.test(current.narration) &&
        (current.withdrawal > 0 || current.deposit > 0 || !/^balance/i.test(current.narration))
      ) {
        if (current.withdrawal > 0 || current.deposit > 0) {
          transactions.push(current);
        }
      }
    }
    current = null;
  };

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const joined = rowJoined(row);

    // Repeated page header in monthly statements
    if (isOnlineHeader(joined) || isStatementHeader(joined)) continue;

    const firstMeaningful = normalizeWhitespace(row.find((c) => normalizeWhitespace(c)) || '');
    if (!firstMeaningful) continue;
    if (/legends used/i.test(firstMeaningful)) break;
    if (/^\d+\.\s/.test(firstMeaningful) && /inft|bpay|neft|imps/i.test(firstMeaningful)) break;

    const dateRaw = cellAt(row, idx.txnDate >= 0 ? idx.txnDate : idx.valueDate);
    const txnDate = parseBankDate(dateRaw);
    const valueDate = parseBankDate(cellAt(row, idx.valueDate)) || txnDate;
    const narrationPart = normalizeWhitespace(cellAt(row, idx.remarks));
    const mode = normalizeWhitespace(cellAt(row, idx.mode));
    const refNo = normalizeWhitespace(cellAt(row, idx.cheque));
    const withdrawal = parseIndianAmount(cellAt(row, idx.withdrawal));
    const deposit = parseIndianAmount(cellAt(row, idx.deposit));
    const balanceRaw = cellAt(row, idx.balance);
    const hasBalance = normalizeWhitespace(balanceRaw) !== '';
    const balance = hasBalance ? parseIndianAmount(balanceRaw) : null;

    // Continuation line (no date) — append to previous narration
    if (!txnDate) {
      if (narrationPart && current && !isNoiseOrSummary(narrationPart) && !/^total/i.test(narrationPart)) {
        current.narration = normalizeWhitespace(`${current.narration} ${narrationPart}`);
      }
      continue;
    }

    // Dated TOTAL / page markers
    if (/^total$/i.test(normalizeWhitespace(dateRaw)) || /^total/i.test(firstMeaningful)) {
      flush();
      continue;
    }

    flush();

    let narration = narrationPart;
    if (mode && narration && !narration.toUpperCase().includes(mode.toUpperCase())) {
      // keep mode available in narration context lightly via notes-style prefix only if useful
      narration = narration;
    }
    if (mode && !narration) narration = mode;

    if (isNoiseOrSummary(narration) && withdrawal === 0 && deposit === 0) {
      current = null;
      continue;
    }

    current = {
      txnDate: txnDate || valueDate,
      valueDate: valueDate || txnDate,
      narration,
      refNo: refNo === '-' ? '' : refNo,
      withdrawal,
      deposit,
      balance,
      rawBank: 'ICICI'
    };
  }

  flush();

  return {
    bank: 'ICICI',
    meta,
    transactions: transactions.map((t) => finalizeParsedTxn(t, accountId))
  };
}

function detectIcici(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary' });
    const sheetName = (workbook.SheetNames[0] || '').toLowerCase();
    const { rows } = sheetToRows(workbook);
    const sample = rows
      .slice(0, 80)
      .map((r) => r.join(' '))
      .join(' ')
      .toLowerCase();

    if (sheetName.includes('optransactionhistory')) return true;
    if (sample.includes('icici')) return true;
    if (sample.includes('transaction remarks') && sample.includes('withdrawal amount')) return true;
    if (sample.includes('particulars') && sample.includes('withdrawals') && sample.includes('deposits')) {
      return true;
    }
    if (sample.includes('statement of transactions in savings account')) return true;
    return false;
  } catch {
    return false;
  }
}

module.exports = {
  parseIciciXls,
  detectIcici
};
