const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const EXPORT_COLUMNS = [
  'id',
  'account_id',
  'bank_name',
  'account_name',
  'account_number',
  'txn_date',
  'value_date',
  'narration',
  'ref_no',
  'withdrawal',
  'deposit',
  'balance',
  'category',
  'Main category',
  'Sub category',
  'Sub category 2',
  'Sub category 3',
  'category_source',
  'payee',
  'txn_type',
  'tags',
  'notes',
  'raw_bank',
  'import_batch_id',
  'fingerprint',
  'linked_transfer_id'
];

const MAX_CATEGORY_DEPTH = 4;
const CATEGORY_LEVEL_LABELS = ['Category', 'Sub category', 'Sub category 2', 'Sub category 3'];
const CATEGORY_SPLIT_KEYS = ['Main category', 'Sub category', 'Sub category 2', 'Sub category 3'];

const STARS = '*'.repeat(96);
const DASH = '-'.repeat(96);

function cell(row, key) {
  const v = row[key];
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return s.slice(0, 10);
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v, blankZero = false) {
  const n = num(v);
  if (blankZero && n === 0) return '';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDateDmy(iso, shortYear = false) {
  const s = normalizeDate(iso);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  if (shortYear) return `${d}/${m}/${y.slice(2)}`;
  return `${d}/${m}/${y}`;
}

function bankTitle(bankName) {
  const b = String(bankName || 'BANK').trim();
  if (/bank/i.test(b)) return b.toUpperCase().includes('LTD') ? b.toUpperCase() : `${b.toUpperCase()} Ltd.`;
  return `${b.toUpperCase()} BANK Ltd.`;
}

function noteLines(notes) {
  if (!notes) return [];
  return String(notes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
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
    String(refNo || '').trim().toUpperCase(),
    String(narration || '').replace(/\s+/g, ' ').trim().toUpperCase()
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function rowsToSheetData(rows) {
  return rows.map((r) => {
    const split = categorySplitFields(r.category);
    const out = {};
    for (const col of EXPORT_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(split, col)) out[col] = split[col];
      else out[col] = cell(r, col);
    }
    return out;
  });
}

function computeStatementSummary(account, rows, meta = {}) {
  const sorted = [...rows].sort((a, b) => {
    const da = String(a.txn_date || '');
    const db = String(b.txn_date || '');
    if (da !== db) return da.localeCompare(db);
    return Number(a.id || 0) - Number(b.id || 0);
  });

  let totalDebit = 0;
  let totalCredit = 0;
  let drCount = 0;
  let crCount = 0;
  for (const r of sorted) {
    const w = num(r.withdrawal);
    const d = num(r.deposit);
    totalDebit += w;
    totalCredit += d;
    if (w > 0) drCount += 1;
    if (d > 0) crCount += 1;
  }

  let opening = num(account?.opening_balance);
  if (sorted.length) {
    const first = sorted[0];
    if (first.balance != null && first.balance !== '') {
      opening = num(first.balance) - num(first.deposit) + num(first.withdrawal);
    }
  }

  let closing = opening + totalCredit - totalDebit;
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    if (last.balance != null && last.balance !== '') closing = num(last.balance);
  }

  const dates = sorted.map((r) => normalizeDate(r.txn_date)).filter(Boolean);
  const from =
    normalizeDate(meta.from) ||
    dates[0] ||
    null;
  const to =
    normalizeDate(meta.to) ||
    dates[dates.length - 1] ||
    null;

  return {
    rows: sorted,
    opening,
    closing,
    totalDebit,
    totalCredit,
    drCount,
    crCount,
    from,
    to
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function slugFilenamePart(s, fallback = 'Bank') {
  const t = String(s || '')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
  return t || fallback;
}

function periodStamp(meta = {}, rows = []) {
  const dates = (rows || []).map((r) => normalizeDate(r.txn_date)).filter(Boolean).sort();
  const from = normalizeDate(meta.from) || dates[0] || '';
  const to = normalizeDate(meta.to) || dates[dates.length - 1] || '';
  const compact = (s) => String(s || '').replace(/-/g, '');
  if (from && to) return from === to ? compact(from) : `${compact(from)}_${compact(to)}`;
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function statementDownloadName({ rows = [], accountsById, meta = {}, format = 'xlsx', layout = 'statement' }) {
  const ext = format === 'pdf' ? 'pdf' : format === 'csv' ? 'csv' : 'xlsx';
  const period = periodStamp(meta, rows);
  if (layout === 'raw') return `bank_transactions_backup_${period}.${ext}`;
  const groups = accountsById ? groupRowsByAccount(rows, accountsById) : [];
  if (groups.length === 1) {
    const a = groups[0].account;
    return `${slugFilenamePart(a.bank_name)}_${slugFilenamePart(a.account_name, 'Account')}_${period}.${ext}`;
  }
  return `Bank_Statements_${period}.${ext}`;
}

function contentDisposition(filename) {
  const ascii = String(filename || 'download')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function statementColumnWidths(extraCols) {
  const cols = [
    { wch: 12 },
    { wch: 48 },
    { wch: 22 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 }
  ];
  for (let i = 0; i < extraCols; i++) {
    cols.push({ wch: i === extraCols - 1 && extraCols === MAX_CATEGORY_DEPTH + 1 ? 18 : 16 });
  }
  return cols;
}

function applyAmountFormats(ws, startRow, endRow, amountCols) {
  for (let r = startRow; r <= endRow; r++) {
    for (const c of amountCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.t === 'n') cell.z = '#,##,##0.00';
    }
  }
}

function splitCategoryParts(category) {
  const raw = String(category || '').trim();
  if (!raw) return [];
  if (raw.includes('_')) {
    return raw.split('_').map((p) => p.trim()).filter(Boolean);
  }
  if (raw.includes(' / ')) {
    return raw.split(' / ').map((p) => p.trim()).filter(Boolean);
  }
  return [raw];
}

function categoryLevelCells(category) {
  const parts = splitCategoryParts(category).slice(0, MAX_CATEGORY_DEPTH);
  const cells = [];
  for (let i = 0; i < MAX_CATEGORY_DEPTH; i++) cells.push(parts[i] || '');
  return cells;
}

function categorySplitFields(category) {
  const cells = categoryLevelCells(category);
  const out = {};
  CATEGORY_SPLIT_KEYS.forEach((key, i) => {
    out[key] = cells[i] || '';
  });
  return out;
}

function extraStatementCells(opts, category, payee) {
  const includeLevels = opts.includeCategoryLevels !== false;
  const includePayee = !!opts.includePayee;
  const cells = [];
  if (includeLevels) cells.push(...categoryLevelCells(category));
  if (includePayee) cells.push(payee || '');
  return cells;
}

function extraStatementColCount(opts) {
  return (opts.includeCategoryLevels !== false ? MAX_CATEGORY_DEPTH : 0) + (opts.includePayee ? 1 : 0);
}

function buildStatementAoA(account, rows, meta = {}, pageNo = 1, opts = {}) {
  const includeCategoryLevels = opts.includeCategoryLevels !== false;
  const includePayee = !!opts.includePayee;
  const extraOpts = { includeCategoryLevels, includePayee };
  const extraCols = extraStatementColCount(extraOpts);
  const accountCount = Number(opts.accountCount) || 1;
  const s = computeStatementSummary(account, rows, meta);
  const bank = bankTitle(account.bank_name || rows[0]?.bank_name);
  const name = account.account_name || rows[0]?.account_name || '';
  const acctNo = account.account_number || rows[0]?.account_number || '';
  const branch = account.branch || rows[0]?.branch || '';
  const ifsc = account.ifsc || rows[0]?.ifsc || '';
  const currency = account.currency || 'INR';
  const acctType = account.account_type || rows[0]?.account_type || 'Savings';
  const notes = noteLines(account.notes);
  const aoa = [];

  aoa.push([
    bank,
    '',
    accountCount > 1 ? `Account ${pageNo} of ${accountCount}` : '',
    '',
    'Statement of account'
  ]);
  aoa.push([]);
  aoa.push([name, '', '', 'Account Branch', branch]);
  aoa.push([notes[0] || '', '', '', 'Address', notes[0] || '']);
  aoa.push([notes[1] || '', '', '', '', notes[1] || '']);
  aoa.push(['Joint Holders', '', '', 'Currency', currency]);
  aoa.push(['Nomination :', '', '', 'IFSC', ifsc]);
  aoa.push([]);
  aoa.push([
    `Statement From : ${fmtDateDmy(s.from)} To : ${fmtDateDmy(s.to)}`,
    '',
    '',
    'Account No',
    acctNo
  ]);
  aoa.push(['', '', '', 'Account Type', acctType]);
  aoa.push(['', '', '', 'Currency', currency]);
  aoa.push(['', '', '', 'Opening Balance', s.opening]);
  aoa.push([]);
  aoa.push([STARS]);
  const headerRowIndex = aoa.length;
  const headers = [
    'Date',
    'Narration',
    'Chq./Ref.No.',
    'Value Dt',
    'Withdrawal Amt.',
    'Deposit Amt.',
    'Closing Balance'
  ];
  if (includeCategoryLevels) headers.push(...CATEGORY_LEVEL_LABELS);
  if (includePayee) headers.push('Payee');
  aoa.push(headers);
  aoa.push([DASH]);
  const dataStart = aoa.length;

  aoa.push([
    fmtDateDmy(s.from, true),
    'OPENING BALANCE',
    '',
    '',
    '',
    '',
    s.opening,
    ...extraStatementCells(extraOpts)
  ]);

  for (const r of s.rows) {
    aoa.push([
      fmtDateDmy(r.txn_date, true),
      String(r.narration || '').replace(/\s+/g, ' ').trim(),
      r.ref_no || '',
      fmtDateDmy(r.value_date || r.txn_date, true),
      num(r.withdrawal) > 0 ? num(r.withdrawal) : '',
      num(r.deposit) > 0 ? num(r.deposit) : '',
      r.balance != null && r.balance !== '' ? num(r.balance) : '',
      ...extraStatementCells(extraOpts, r.category, r.payee)
    ]);
  }

  aoa.push([
    '',
    'TOTAL',
    '',
    '',
    s.totalDebit,
    s.totalCredit,
    s.closing,
    ...extraStatementCells(extraOpts)
  ]);
  const dataEnd = aoa.length - 1;

  aoa.push([STARS]);
  aoa.push([]);
  aoa.push(['STATEMENT SUMMARY :-']);
  aoa.push([
    'Opening Balance',
    s.opening,
    'Debits',
    s.totalDebit,
    'Credits',
    s.totalCredit,
    'Closing Bal',
    s.closing
  ]);
  aoa.push(['Dr Count', s.drCount, 'Cr Count', s.crCount, 'Txn Count', s.rows.length]);
  aoa.push([]);
  aoa.push([
    `Generated On : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    '',
    '',
    'This is a computer generated statement and does not require signature.'
  ]);

  return { aoa, summary: s, headerRowIndex, dataStart, dataEnd, extraCols };
}

function sheetNameForAccount(account, index) {
  const raw = `${account.bank_name || 'Bank'} ${account.account_name || account.id || index}`
    .replace(/[\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 28);
  return raw || `Account ${index + 1}`;
}

function buildTransactionsWorkbook(rows, meta = {}) {
  const wb = XLSX.utils.book_new();
  const data = rowsToSheetData(rows);
  const ws = XLSX.utils.json_to_sheet(data, { header: EXPORT_COLUMNS });
  ws['!cols'] = EXPORT_COLUMNS.map((c) => ({
    wch: Math.min(40, Math.max(12, c.length + 2))
  }));
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

  const metaRows = [
    { key: 'exported_at', value: meta.exported_at || new Date().toISOString() },
    { key: 'account_id', value: meta.account_id ?? '' },
    { key: 'from', value: meta.from ?? '' },
    { key: 'to', value: meta.to ?? '' },
    { key: 'row_count', value: rows.length },
    { key: 'format', value: 'portfolio_bank_transactions_v1' },
    { key: 'layout', value: 'raw' }
  ];
  const metaWs = XLSX.utils.json_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, metaWs, 'ExportMeta');
  return wb;
}

function groupRowsByAccount(rows, accountsById) {
  const groups = new Map();
  for (const r of rows) {
    const id = Number(r.account_id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  const out = [];
  for (const [id, txns] of groups) {
    const fromRow = txns[0] || {};
    const account = accountsById.get(id) || {
      id,
      bank_name: fromRow.bank_name,
      account_name: fromRow.account_name,
      account_number: fromRow.account_number,
      branch: fromRow.branch || null,
      ifsc: fromRow.ifsc || null,
      account_type: fromRow.account_type || 'Savings',
      currency: fromRow.currency || 'INR',
      opening_balance: fromRow.opening_balance || 0,
      notes: fromRow.account_notes || null
    };
    out.push({ account, rows: txns });
  }
  out.sort((a, b) =>
    String(a.account.bank_name || '').localeCompare(String(b.account.bank_name || '')) ||
    String(a.account.account_name || '').localeCompare(String(b.account.account_name || ''))
  );
  return out;
}

function appendSummarySheet(wb, groups, meta = {}) {
  const rows = groups.map((g) => {
    const s = computeStatementSummary(g.account, g.rows, meta);
    return {
      Bank: g.account.bank_name || '',
      Account: g.account.account_name || '',
      Account_No: g.account.account_number || '',
      From: s.from || '',
      To: s.to || '',
      Opening: s.opening,
      Debits: s.totalDebit,
      Credits: s.totalCredit,
      Closing: s.closing,
      Dr_Count: s.drCount,
      Cr_Count: s.crCount,
      Txns: s.rows.length
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 8 }
  ];
  applyAmountFormats(ws, 1, rows.length, [5, 6, 7, 8]);
  XLSX.utils.book_append_sheet(wb, ws, 'Summary');
}

function applyStatementSheetView(ws, built) {
  const extraCols = Number(built.extraCols) || 0;
  const ySplit = (built.headerRowIndex || 0) + 1;
  ws['!cols'] = statementColumnWidths(extraCols);
  ws['!views'] = [
    {
      state: 'frozen',
      xSplit: 0,
      ySplit,
      topLeftCell: `A${ySplit + 1}`,
      activeCell: `A${ySplit + 1}`
    }
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 6 + extraCols } }
  ];
  applyAmountFormats(ws, built.dataStart, built.dataEnd, [4, 5, 6]);
  applyAmountFormats(ws, 11, 11, [4]);
}

function buildStatementWorkbook(rows, accountsById, meta = {}, opts = {}) {
  const includePayee = !!opts.includeCategory;
  const sheetOpts = { includeCategoryLevels: true, includePayee };
  const wb = XLSX.utils.book_new();
  const groups = groupRowsByAccount(rows, accountsById);
  if (!groups.length) {
    const built = buildStatementAoA(
      { bank_name: 'BANK', account_name: 'No transactions', account_number: '' },
      [],
      meta,
      1,
      { ...sheetOpts, accountCount: 1 }
    );
    const ws = XLSX.utils.aoa_to_sheet(built.aoa);
    applyStatementSheetView(ws, built);
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  } else {
    const used = new Set();
    groups.forEach((g, i) => {
      let name = sheetNameForAccount(g.account, i);
      let n = 1;
      while (used.has(name)) {
        name = `${sheetNameForAccount(g.account, i).slice(0, 25)}_${n++}`;
      }
      used.add(name);
      const built = buildStatementAoA(g.account, g.rows, meta, i + 1, {
        ...sheetOpts,
        accountCount: groups.length
      });
      const ws = XLSX.utils.aoa_to_sheet(built.aoa);
      applyStatementSheetView(ws, built);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    appendSummarySheet(wb, groups, meta);
  }

  // Raw backup sheet for re-import
  const data = rowsToSheetData(rows);
  const backupWs = XLSX.utils.json_to_sheet(data, { header: EXPORT_COLUMNS });
  backupWs['!cols'] = EXPORT_COLUMNS.map((c) => ({
    wch: Math.min(40, Math.max(12, c.length + 2))
  }));
  backupWs['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2' }];
  XLSX.utils.book_append_sheet(wb, backupWs, 'BackupData');

  const metaRows = [
    { key: 'exported_at', value: meta.exported_at || new Date().toISOString() },
    { key: 'account_id', value: meta.account_id ?? '' },
    { key: 'from', value: meta.from ?? '' },
    { key: 'to', value: meta.to ?? '' },
    { key: 'row_count', value: rows.length },
    { key: 'truncated', value: meta.truncated ? '1' : '0' },
    { key: 'apply_filters', value: meta.apply_filters ? '1' : '0' },
    { key: 'include_category', value: includePayee ? '1' : '0' },
    { key: 'format', value: 'portfolio_bank_transactions_v1' },
    { key: 'layout', value: 'statement' }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), 'ExportMeta');
  return wb;
}

function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function drawStatementPage(doc, account, rows, meta, pageNo, isFirst, opts = {}) {
  const includeCategory = !!opts.includeCategory;
  const accountCount = Number(opts.accountCount) || 1;
  const s = computeStatementSummary(account, rows, meta);
  const bank = bankTitle(account.bank_name || rows[0]?.bank_name);
  const name = account.account_name || rows[0]?.account_name || '';
  const acctNo = account.account_number || rows[0]?.account_number || '';
  const branch = account.branch || rows[0]?.branch || '';
  const ifsc = account.ifsc || rows[0]?.ifsc || '';
  const currency = account.currency || 'INR';
  const acctType = account.account_type || rows[0]?.account_type || 'Savings';
  const notes = noteLines(account.notes);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const mid = left + (right - left) * 0.52;

  if (!isFirst) doc.addPage();

  doc.font('Helvetica-Bold').fontSize(12).text(bank, left, 40, { width: 260 });
  if (accountCount > 1) {
    doc.font('Helvetica').fontSize(9).text(`Account ${pageNo} of ${accountCount}`, mid, 40, {
      width: right - mid,
      align: 'right'
    });
  }
  doc.font('Helvetica-Bold').fontSize(11).text('Statement of account', left, 58, {
    width: right - left,
    align: 'center'
  });

  let y = 85;
  doc.rect(left, y, mid - left - 12, 88).stroke('#333');
  doc.font('Helvetica-Bold').fontSize(9).text(name, left + 6, y + 6, { width: mid - left - 24 });
  doc.font('Helvetica').fontSize(8);
  let ly = y + 22;
  for (const line of notes.slice(0, 4)) {
    doc.text(line, left + 6, ly, { width: mid - left - 24 });
    ly += 11;
  }
  doc.text('Joint Holders :', left + 6, y + 70, { width: mid - left - 24 });
  doc.text('Nomination :', left + 6, y + 82, { width: mid - left - 24 });

  const rightLines = [
    ['Account Branch', branch],
    ['Currency', currency],
    ['Account No', acctNo],
    ['Account Type', acctType],
    ['RTGS/NEFT IFSC', ifsc],
    ['Opening Balance', fmtAmt(s.opening)]
  ];
  let ry = y;
  doc.fontSize(8);
  for (const [k, v] of rightLines) {
    doc.font('Helvetica-Bold').text(`${k} :`, mid, ry, { width: 95, continued: false });
    doc.font('Helvetica').text(String(v || ''), mid + 98, ry, { width: right - mid - 98 });
    ry += 14;
  }

  y = 188;
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(`From : ${fmtDateDmy(s.from)}   To : ${fmtDateDmy(s.to)}`, left, y);

  y = 210;
  const cols = [
    { key: 'date', label: 'Date', w: includeCategory ? 42 : 48 },
    { key: 'narration', label: 'Narration', w: includeCategory ? 110 : 170 },
    { key: 'ref', label: 'Chq./Ref.No.', w: includeCategory ? 62 : 78 },
    { key: 'value', label: 'Value Dt', w: includeCategory ? 42 : 48 },
    { key: 'wd', label: 'Withdrawal', w: includeCategory ? 52 : 62 },
    { key: 'dep', label: 'Deposit', w: includeCategory ? 48 : 58 },
    { key: 'bal', label: 'Closing Balance', w: includeCategory ? 56 : 70 }
  ];
  if (includeCategory) {
    cols.push(
      { key: 'cat', label: 'Category', w: 52 },
      { key: 'sub', label: 'Sub category', w: 56 },
      { key: 'sub2', label: 'Sub cat. 2', w: 52 },
      { key: 'sub3', label: 'Sub cat. 3', w: 52 },
      { key: 'payee', label: 'Payee', w: 58 }
    );
  }
  const tableWidth = cols.reduce((a, c) => a + c.w, 0);
  const minRowH = 12;
  const cellPadY = 2;
  const fontSize = includeCategory ? 6.5 : 7;
  const narrColW = cols[1].w - 4;

  function wrapFriendly(text, chunk = 26) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(\S{26})(?=\S)/g, `$1\u200b`);
  }

  function drawTableHeader() {
    doc.rect(left, y, tableWidth, 18).fillAndStroke('#d9e8f5', '#333');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(fontSize);
    let hx = left;
    for (const c of cols) {
      doc.text(c.label, hx + 2, y + 5, {
        width: c.w - 4,
        align: c.key === 'narration' || c.key === 'cat' || c.key === 'sub' || c.key === 'sub2' || c.key === 'sub3' || c.key === 'payee' ? 'left' : 'center'
      });
      hx += c.w;
    }
    y += 18;
  }

  drawTableHeader();

  const bottomLimit = doc.page.height - 120;

  const ensureSpace = (needed) => {
    if (y + needed <= bottomLimit) return;
    doc.addPage();
    y = 40;
    doc.font('Helvetica-Bold').fontSize(8).text(`${bank} — continued`, left, y);
    y += 20;
    drawTableHeader();
  };

  const drawRow = (cells) => {
    doc.font('Helvetica').fontSize(fontSize).fillColor('#000');
    const narr = wrapFriendly(cells[1]);
    const narrH = Math.max(
      minRowH - cellPadY * 2,
      doc.heightOfString(narr, { width: narrColW, lineGap: 1 })
    );
    const rowH = Math.max(minRowH, Math.ceil(narrH + cellPadY * 2));

    ensureSpace(rowH + 2);

    doc.font('Helvetica').fontSize(fontSize).fillColor('#000');
    let cx = left;
    cells.forEach((text, i) => {
      const align = i === 1 || i >= 7 ? 'left' : i >= 4 && i <= 6 ? 'right' : 'center';
      const raw = i === 1 ? narr : String(text || '');
      const optsRow = {
        width: cols[i].w - 4,
        align,
        lineGap: 1
      };
      if (i === 1) {
        doc.text(raw, cx + 2, y + cellPadY, optsRow);
      } else {
        doc.text(raw, cx + 2, y + cellPadY, { ...optsRow, lineBreak: false });
      }
      cx += cols[i].w;
    });
    doc
      .moveTo(left, y + rowH)
      .lineTo(left + tableWidth, y + rowH)
      .stroke('#ccc');
    y += rowH;
  };

  drawRow([
    fmtDateDmy(s.from, true),
    'OPENING BALANCE',
    '',
    '',
    '',
    '',
    fmtAmt(s.opening),
    ...(includeCategory ? extraStatementCells({ includeCategoryLevels: true, includePayee: true }) : [])
  ]);

  for (const r of s.rows) {
    const cells = [
      fmtDateDmy(r.txn_date, true),
      String(r.narration || '').replace(/\s+/g, ' ').trim(),
      String(r.ref_no || '').slice(0, 28),
      fmtDateDmy(r.value_date || r.txn_date, true),
      num(r.withdrawal) > 0 ? fmtAmt(r.withdrawal) : '',
      num(r.deposit) > 0 ? fmtAmt(r.deposit) : '',
      r.balance != null && r.balance !== '' ? fmtAmt(r.balance) : ''
    ];
    if (includeCategory) {
      cells.push(
        ...extraStatementCells({ includeCategoryLevels: true, includePayee: true }, r.category, r.payee).map((v) =>
          String(v || '').slice(0, 28)
        )
      );
    }
    drawRow(cells);
  }

  y += 16;
  if (y > bottomLimit) {
    doc.addPage();
    y = 40;
  }
  doc.font('Helvetica-Bold').fontSize(9).text('STATEMENT SUMMARY :-', left, y);
  y += 16;
  doc.font('Helvetica').fontSize(8);
  doc.text(
    `Opening Balance : ${fmtAmt(s.opening)}     Debits : ${fmtAmt(s.totalDebit)}     Credits : ${fmtAmt(s.totalCredit)}     Closing Bal : ${fmtAmt(s.closing)}`,
    left,
    y,
    { width: right - left }
  );
  y += 14;
  doc.text(`Dr Count : ${s.drCount}     Cr Count : ${s.crCount}     Txn Count : ${s.rows.length}`, left, y);
  y += 24;
  doc.fontSize(7).fillColor('#444');
  doc.text(
    `Generated On : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    left,
    y
  );
  doc.text(
    'This is a computer generated statement and does not require signature.',
    left,
    y + 12,
    { width: right - left, align: 'right' }
  );
  doc.fillColor('#000');
}

function buildStatementPdf(rows, accountsById, meta = {}, opts = {}) {
  const includeCategory = !!opts.includeCategory;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: includeCategory ? 'landscape' : 'portrait',
      bufferPages: true,
      margins: { top: 36, bottom: 40, left: 36, right: 36 },
      info: {
        Title: 'Statement of account',
        Author: 'Portfolio Bank Tracker'
      }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const groups = groupRowsByAccount(rows, accountsById);
    if (!groups.length) {
      drawStatementPage(
        doc,
        { bank_name: 'BANK', account_name: 'No transactions', account_number: '' },
        [],
        meta,
        1,
        true,
        { includeCategory, accountCount: 1 }
      );
    } else {
      groups.forEach((g, i) => {
        drawStatementPage(doc, g.account, g.rows, meta, i + 1, i === 0, {
          includeCategory,
          accountCount: groups.length
        });
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 28, {
        width: right - left,
        align: 'center'
      });
      doc.fillColor('#000');
    }

    doc.end();
  });
}

function buildStatementCsv(rows, accountsById, meta = {}, opts = {}) {
  const includeCategory = !!opts.includeCategory;
  const groups = groupRowsByAccount(rows, accountsById);
  const headers = [
    'Date',
    'Narration',
    'Chq./Ref.No.',
    'Value Dt',
    'Withdrawal Amt.',
    'Deposit Amt.',
    'Closing Balance'
  ];
  if (includeCategory) headers.push(...CATEGORY_LEVEL_LABELS, 'Payee');
  const lines = [];
  const list = groups.length
    ? groups
    : [{ account: { bank_name: 'BANK', account_name: 'No transactions', account_number: '' }, rows: [] }];

  list.forEach((g, i) => {
    const s = computeStatementSummary(g.account, g.rows, meta);
    if (i > 0) lines.push('');
    lines.push(
      `# ${bankTitle(g.account.bank_name)} | ${g.account.account_name || ''} | ${g.account.account_number || ''}`
    );
    lines.push(
      `# From ${s.from || ''} To ${s.to || ''} | Opening ${s.opening} | Closing ${s.closing} | Dr ${s.drCount} | Cr ${s.crCount}`
    );
    lines.push(headers.map(csvCell).join(','));
    const extraOpts = { includeCategoryLevels: includeCategory, includePayee: includeCategory };
    const opening = [
      s.from || '',
      'OPENING BALANCE',
      '',
      '',
      '',
      '',
      s.opening,
      ...extraStatementCells(extraOpts)
    ];
    lines.push(opening.map(csvCell).join(','));
    for (const r of s.rows) {
      const row = [
        normalizeDate(r.txn_date) || '',
        String(r.narration || '').replace(/\s+/g, ' ').trim(),
        r.ref_no || '',
        normalizeDate(r.value_date || r.txn_date) || '',
        num(r.withdrawal) > 0 ? num(r.withdrawal) : '',
        num(r.deposit) > 0 ? num(r.deposit) : '',
        r.balance != null && r.balance !== '' ? num(r.balance) : '',
        ...extraStatementCells(extraOpts, r.category, r.payee)
      ];
      lines.push(row.map(csvCell).join(','));
    }
    const total = ['', 'TOTAL', '', '', s.totalDebit, s.totalCredit, s.closing, ...extraStatementCells(extraOpts)];
    lines.push(total.map(csvCell).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

function parseTransactionsUpload(buffer, filename = '') {
  const name = String(filename || '').toLowerCase();
  let rows = [];

  if (name.endsWith('.csv')) {
    const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } else {
    const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true });
    const preferred =
      wb.SheetNames.find((n) => /^backupdata$/i.test(n)) ||
      wb.SheetNames.find((n) => /transaction/i.test(n)) ||
      wb.SheetNames[0];
    const sheet = wb.Sheets[preferred];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  return rows.map(normalizeImportRow).filter((r) => r.txn_date && r.account_id);
}

function normalizeImportRow(raw) {
  const get = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
      const found = Object.keys(raw).find((x) => x.toLowerCase() === String(k).toLowerCase());
      if (found != null && raw[found] !== '' && raw[found] != null) return raw[found];
    }
    return null;
  };

  const accountId = Number(get('account_id', 'Account Id', 'AccountID'));
  const txnDate = normalizeDate(get('txn_date', 'Date', 'Txn Date'));
  const valueDate = normalizeDate(get('value_date', 'Value Date')) || txnDate;
  const withdrawal = num(get('withdrawal', 'Withdrawal', 'Debit'));
  const deposit = num(get('deposit', 'Deposit', 'Credit'));
  const narration = String(get('narration', 'Narration', 'Description') || '').trim();
  const refNo = get('ref_no', 'Ref', 'Reference') != null ? String(get('ref_no', 'Ref', 'Reference')).trim() : null;
  const balanceRaw = get('balance', 'Balance');
  const balance = balanceRaw === null || balanceRaw === '' ? null : num(balanceRaw);
  const fingerprint =
    String(get('fingerprint') || '').trim() ||
    (Number.isFinite(accountId) && txnDate
      ? buildFingerprint({
          accountId,
          txnDate,
          valueDate,
          withdrawal,
          deposit,
          refNo,
          narration
        })
      : null);

  return {
    account_id: Number.isFinite(accountId) && accountId > 0 ? accountId : null,
    bank_name: get('bank_name', 'Bank') != null ? String(get('bank_name', 'Bank')).trim() : null,
    account_name: get('account_name', 'Account') != null ? String(get('account_name', 'Account')).trim() : null,
    account_number: get('account_number') != null ? String(get('account_number')).trim() : null,
    txn_date: txnDate,
    value_date: valueDate,
    narration,
    ref_no: refNo || null,
    withdrawal,
    deposit,
    balance,
    category: get('category', 'Category') != null ? String(get('category', 'Category')).trim() || null : null,
    category_source: get('category_source') != null ? String(get('category_source')).trim() || null : null,
    payee: get('payee', 'Payee') != null ? String(get('payee', 'Payee')).trim() || null : null,
    txn_type: get('txn_type', 'Type') != null ? String(get('txn_type', 'Type')).trim() || null : null,
    tags: get('tags', 'Tags') != null ? String(get('tags', 'Tags')).trim() || null : null,
    notes: get('notes', 'Notes') != null ? String(get('notes', 'Notes')).trim() || null : null,
    raw_bank: get('raw_bank') != null ? String(get('raw_bank')).trim() || null : null,
    import_batch_id: get('import_batch_id') != null ? String(get('import_batch_id')).trim() || null : null,
    fingerprint,
    linked_transfer_id: (() => {
      const v = Number(get('linked_transfer_id'));
      return Number.isFinite(v) && v > 0 ? v : null;
    })()
  };
}

module.exports = {
  EXPORT_COLUMNS,
  buildTransactionsWorkbook,
  buildStatementWorkbook,
  buildStatementPdf,
  buildStatementCsv,
  statementDownloadName,
  contentDisposition,
  workbookToBuffer,
  parseTransactionsUpload,
  buildFingerprint,
  normalizeImportRow
};
