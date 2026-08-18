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
    const out = {};
    for (const col of EXPORT_COLUMNS) {
      out[col] = cell(r, col);
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

function buildStatementAoA(account, rows, meta = {}, pageNo = 1) {
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

  aoa.push([bank, '', `Page No. : ${pageNo}`, '', 'Statement of account']);
  aoa.push([]);
  aoa.push([name, '', '', 'Account Branch', branch]);
  aoa.push([notes[0] || '', '', '', 'Address', notes[0] || '']);
  aoa.push([notes[1] || '', '', '', '', notes[1] || '']);
  aoa.push(['Joint Holders', '', '', 'Currency', currency]);
  aoa.push([`Nomination :`, '', '', 'Email', '']);
  aoa.push([]);
  aoa.push([
    `Statement From : ${fmtDateDmy(s.from)} To : ${fmtDateDmy(s.to)}`,
    '',
    '',
    'Account No',
    acctNo
  ]);
  aoa.push(['', '', '', 'Account Type', acctType]);
  aoa.push(['', '', '', 'RTGS/NEFT IFSC', ifsc]);
  aoa.push(['', '', '', 'Opening Balance', fmtAmt(s.opening)]);
  aoa.push([]);
  aoa.push([STARS]);
  aoa.push([
    'Date',
    'Narration',
    'Chq./Ref.No.',
    'Value Dt',
    'Withdrawal Amt.',
    'Deposit Amt.',
    'Closing Balance'
  ]);
  aoa.push([DASH]);

  for (const r of s.rows) {
    aoa.push([
      fmtDateDmy(r.txn_date, true),
      String(r.narration || '').replace(/\s+/g, ' ').trim(),
      r.ref_no || '',
      fmtDateDmy(r.value_date || r.txn_date, true),
      num(r.withdrawal) > 0 ? fmtAmt(r.withdrawal) : '',
      num(r.deposit) > 0 ? fmtAmt(r.deposit) : '',
      r.balance != null && r.balance !== '' ? fmtAmt(r.balance) : ''
    ]);
  }

  aoa.push([STARS]);
  aoa.push([]);
  aoa.push(['STATEMENT SUMMARY :-']);
  aoa.push([
    'Opening Balance',
    fmtAmt(s.opening),
    'Debits',
    fmtAmt(s.totalDebit),
    'Credits',
    fmtAmt(s.totalCredit),
    'Closing Bal',
    fmtAmt(s.closing)
  ]);
  aoa.push(['Dr Count', s.drCount, 'Cr Count', s.crCount]);
  aoa.push([]);
  aoa.push([
    `Generated On : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    '',
    '',
    'This is a computer generated statement and does not require signature.'
  ]);

  return { aoa, summary: s };
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

function buildStatementWorkbook(rows, accountsById, meta = {}) {
  const wb = XLSX.utils.book_new();
  const groups = groupRowsByAccount(rows, accountsById);
  if (!groups.length) {
    const empty = buildStatementAoA(
      { bank_name: 'BANK', account_name: 'No transactions', account_number: '' },
      [],
      meta,
      1
    );
    const ws = XLSX.utils.aoa_to_sheet(empty.aoa);
    ws['!cols'] = [
      { wch: 12 },
      { wch: 48 },
      { wch: 22 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 }
    ];
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
      const { aoa } = buildStatementAoA(g.account, g.rows, meta, i + 1);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 12 },
        { wch: 48 },
        { wch: 22 },
        { wch: 12 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
  }

  // Raw backup sheet for re-import
  const data = rowsToSheetData(rows);
  const backupWs = XLSX.utils.json_to_sheet(data, { header: EXPORT_COLUMNS });
  backupWs['!cols'] = EXPORT_COLUMNS.map((c) => ({
    wch: Math.min(40, Math.max(12, c.length + 2))
  }));
  XLSX.utils.book_append_sheet(wb, backupWs, 'BackupData');

  const metaRows = [
    { key: 'exported_at', value: meta.exported_at || new Date().toISOString() },
    { key: 'account_id', value: meta.account_id ?? '' },
    { key: 'from', value: meta.from ?? '' },
    { key: 'to', value: meta.to ?? '' },
    { key: 'row_count', value: rows.length },
    { key: 'format', value: 'portfolio_bank_transactions_v1' },
    { key: 'layout', value: 'statement' }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), 'ExportMeta');
  return wb;
}

function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function drawStatementPage(doc, account, rows, meta, pageNo, isFirst) {
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

  doc.font('Helvetica-Bold').fontSize(12).text(bank, left, 40, { width: 220 });
  doc.font('Helvetica').fontSize(9).text(`Page No. : ${pageNo}`, mid, 40, {
    width: right - mid,
    align: 'right'
  });
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
 // doc.text('Joint Holders :', left + 6, y + 70, { width: mid - left - 24 });
 // doc.text('Nomination :', left + 6, y + 82, { width: mid - left - 24 });

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
    { key: 'date', label: 'Date', w: 48 },
    { key: 'narration', label: 'Narration', w: 170 },
    { key: 'ref', label: 'Chq./Ref.No.', w: 78 },
    { key: 'value', label: 'Value Dt', w: 48 },
    { key: 'wd', label: 'Withdrawal', w: 62 },
    { key: 'dep', label: 'Deposit', w: 58 },
    { key: 'bal', label: 'Closing Balance', w: 70 }
  ];
  const tableWidth = cols.reduce((a, c) => a + c.w, 0);
  const minRowH = 12;
  const cellPadY = 2;
  const fontSize = 7;
  const narrColW = cols[1].w - 4;

  /** Soft-break long UPI/ref tokens so PDFKit can wrap without spaces. */
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
        align: c.key === 'narration' ? 'left' : 'center'
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
      const align = i === 1 ? 'left' : i >= 4 ? 'right' : 'center';
      const raw = i === 1 ? narr : String(text || '');
      const opts = {
        width: cols[i].w - 4,
        align,
        lineGap: 1
      };
      if (i === 1) {
        doc.text(raw, cx + 2, y + cellPadY, opts);
      } else {
        doc.text(raw, cx + 2, y + cellPadY, { ...opts, lineBreak: false });
      }
      cx += cols[i].w;
    });
    doc
      .moveTo(left, y + rowH)
      .lineTo(left + tableWidth, y + rowH)
      .stroke('#ccc');
    y += rowH;
  };

  for (const r of s.rows) {
    drawRow([
      fmtDateDmy(r.txn_date, true),
      String(r.narration || '').replace(/\s+/g, ' ').trim(),
      String(r.ref_no || '').slice(0, 28),
      fmtDateDmy(r.value_date || r.txn_date, true),
      num(r.withdrawal) > 0 ? fmtAmt(r.withdrawal) : '',
      num(r.deposit) > 0 ? fmtAmt(r.deposit) : '',
      r.balance != null && r.balance !== '' ? fmtAmt(r.balance) : ''
    ]);
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
  doc.text(`Dr Count : ${s.drCount}     Cr Count : ${s.crCount}`, left, y);
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

function buildStatementPdf(rows, accountsById, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
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
        true
      );
    } else {
      groups.forEach((g, i) => {
        drawStatementPage(doc, g.account, g.rows, meta, i + 1, i === 0);
      });
    }
    doc.end();
  });
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
  workbookToBuffer,
  parseTransactionsUpload,
  buildFingerprint,
  normalizeImportRow
};
