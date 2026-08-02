const XLSX = require('xlsx');
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
    // Excel serial date
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
    { key: 'format', value: 'portfolio_bank_transactions_v1' }
  ];
  const metaWs = XLSX.utils.json_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, metaWs, 'ExportMeta');
  return wb;
}

function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
      wb.SheetNames.find((n) => /transaction/i.test(n)) || wb.SheetNames[0];
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
  workbookToBuffer,
  parseTransactionsUpload,
  buildFingerprint,
  normalizeImportRow
};
