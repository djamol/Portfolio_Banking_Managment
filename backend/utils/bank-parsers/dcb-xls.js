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

function rowText(row) {
  return (row || []).map((c) => normalizeWhitespace(c)).filter(Boolean).join(' ');
}

function isDcbHeader(row) {
  const joined = rowText(row).toLowerCase();
  return (
    joined.includes('date') &&
    joined.includes('transaction details') &&
    (joined.includes('withdrawal') || joined.includes('deposit')) &&
    joined.includes('balance')
  );
}

function mapHeaderIndexes(headerRow) {
  const idx = {
    txnDate: -1,
    narration: -1,
    cheque: -1,
    withdrawal: -1,
    deposit: -1,
    balance: -1
  };
  headerRow.forEach((cell, i) => {
    const c = normalizeWhitespace(cell).toLowerCase();
    if (!c) return;
    if (c.startsWith('date')) idx.txnDate = i;
    else if (c.includes('transaction detail') || c.includes('particular') || c.includes('narration')) {
      idx.narration = i;
    } else if (c.includes('cheque')) idx.cheque = i;
    else if (c.includes('withdrawal')) idx.withdrawal = i;
    else if (c.includes('deposit')) idx.deposit = i;
    else if (c.includes('balance')) idx.balance = i;
  });
  return idx;
}

function extractDcbMeta(rows) {
  const meta = {
    accountNumber: null,
    accountNumbers: [],
    ifsc: null,
    customerName: null,
    customerId: null,
    statementFrom: null,
    statementTo: null,
    bank: 'DCB'
  };

  const nextValue = (cells, i) => cells.slice(i + 1).find((c) => c) || '';

  for (const row of rows.slice(0, 80)) {
    const cells = (row || []).map((c) => normalizeWhitespace(c));
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const next = nextValue(cells, i);
      if (/^ifsc$/i.test(cell) && next) meta.ifsc = next;
      if (/^customer id$/i.test(cell) && /^\d{6,}$/.test(next)) meta.customerId = next;
      if (/statement period/i.test(cell) && next) {
        const m = next.match(
          /(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\s*(?:to|–|-)\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})/i
        );
        if (m) {
          meta.statementFrom = parseBankDate(m[1].replace(/\./g, '-'));
          meta.statementTo = parseBankDate(m[2].replace(/\./g, '-'));
        }
      }
    }

    const joined = cells.filter(Boolean).join(' ');
    const acct = joined.match(/Account Number\s+(\d{10,18})\s*-\s*(.+)$/i);
    if (acct) {
      meta.accountNumbers.push(acct[1]);
      if (!meta.accountNumber) meta.accountNumber = acct[1];
      if (!meta.customerName) meta.customerName = acct[2].trim();
    }
  }

  return meta;
}

function accountMatches(sectionAccount, preferredAccount) {
  if (!preferredAccount) return true;
  const pref = String(preferredAccount).replace(/\D/g, '');
  const sect = String(sectionAccount || '').replace(/\D/g, '');
  if (!pref || !sect) return true;
  if (pref === sect) return true;
  // Masked forms like 032XXXXXX8714 vs 03211100028714 — compare last 4
  if (pref.length >= 4 && sect.length >= 4 && pref.slice(-4) === sect.slice(-4)) return true;
  return false;
}

function parseAccountSections(rows) {
  const sections = [];
  let current = null;

  for (let i = 0; i < rows.length; i++) {
    const joined = rowText(rows[i]);
    if (/^\*\*END OF STATEMENT\*\*$/i.test(joined) || /^TDS DETAILS$/i.test(joined)) {
      if (current) sections.push(current);
      current = null;
      break;
    }

    const acctMatch = joined.match(/Account Number\s+(\d{10,18})\s*-\s*(.+)$/i);
    if (acctMatch) {
      if (current) sections.push(current);
      current = {
        accountNumber: acctMatch[1],
        customerName: acctMatch[2].trim(),
        headerIdx: -1,
        idx: null,
        startRow: i
      };
      continue;
    }

    if (current && isDcbHeader(rows[i])) {
      current.headerIdx = i;
      current.idx = mapHeaderIndexes(rows[i]);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseSectionTransactions(rows, section, accountId) {
  if (!section?.idx || section.headerIdx < 0) return [];
  const idx = section.idx;
  const transactions = [];

  for (let r = section.headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const joined = rowText(row);
    if (!joined) continue;
    if (/Account Number\s+\d{10,18}/i.test(joined)) break;
    if (/^\*\*END OF STATEMENT\*\*$/i.test(joined)) break;
    if (/^TDS DETAILS$/i.test(joined)) break;
    if (/opening balance/i.test(joined)) continue;
    if (/closing balance/i.test(joined)) break;
    if (/total number of transactions/i.test(joined)) break;
    if (/^turnover$/i.test(joined)) break;

    const dateRaw = idx.txnDate >= 0 ? row[idx.txnDate] : '';
    const txnDate = parseBankDate(String(dateRaw || '').replace(/\./g, '-'));
    if (!txnDate) continue;

    const narration = normalizeWhitespace(idx.narration >= 0 ? row[idx.narration] : '');
    const refNo = normalizeWhitespace(idx.cheque >= 0 ? row[idx.cheque] : '');
    const withdrawal = parseIndianAmount(idx.withdrawal >= 0 ? row[idx.withdrawal] : 0);
    const deposit = parseIndianAmount(idx.deposit >= 0 ? row[idx.deposit] : 0);
    const balance = idx.balance >= 0 ? parseIndianAmount(row[idx.balance]) : null;

    if (!narration && withdrawal === 0 && deposit === 0) continue;

    transactions.push(
      finalizeParsedTxn(
        {
          txnDate,
          valueDate: txnDate,
          narration,
          refNo: refNo && refNo !== '-' ? refNo : '',
          withdrawal,
          deposit,
          balance,
          rawBank: 'DCB',
          notes: section.accountNumber ? `DCB A/c ${section.accountNumber}` : null
        },
        accountId
      )
    );
  }

  return transactions;
}

function parseDcbXls(buffer, accountId, options = {}) {
  const workbook = XLSX.read(buffer, { type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary' });
  const { rows } = sheetToRows(workbook);
  const meta = extractDcbMeta(rows);
  const sections = parseAccountSections(rows);

  if (!sections.length) {
    throw new Error('Could not find DCB account transaction sections');
  }

  const preferred = options.accountNumber || null;
  let selected = sections.filter((s) => accountMatches(s.accountNumber, preferred));
  if (!selected.length) selected = sections;

  // If preferred matched exactly one, use only that; if preferred missing, import all sections
  if (preferred && selected.length === 1) {
    // keep selected
  } else if (preferred && selected.length > 1) {
    selected = [selected[0]];
  } else if (!preferred) {
    selected = sections;
  }

  const transactions = [];
  for (const section of selected) {
    transactions.push(...parseSectionTransactions(rows, section, accountId));
  }

  meta.accountNumbers = sections.map((s) => s.accountNumber);
  meta.importedAccounts = selected.map((s) => s.accountNumber);
  if (selected[0]?.accountNumber) meta.accountNumber = selected[0].accountNumber;
  if (selected[0]?.customerName) meta.customerName = selected[0].customerName;

  if (!transactions.length) {
    throw new Error('No DCB transactions found in statement');
  }

  return { bank: 'DCB', meta, transactions };
}

function detectDcb(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary' });
    const { rows } = sheetToRows(workbook);
    const sample = rows
      .slice(0, 70)
      .map((r) => rowText(r))
      .join(' ')
      .toLowerCase();
    return (
      sample.includes('dcb bank') ||
      (sample.includes('consolidated statement of account') && sample.includes('transaction details')) ||
      (sample.includes('dcbl') && sample.includes('withdrawals') && sample.includes('deposits'))
    );
  } catch {
    return false;
  }
}

module.exports = {
  parseDcbXls,
  detectDcb
};
