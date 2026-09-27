const XLSX = require('xlsx');
const { parseGenericCsv, parseGenericXls } = require('./generic');

function sampleRowsFromWorkbook(buffer) {
  try {
    const workbook = XLSX.read(buffer, {
      type: Buffer.isBuffer(buffer) ? 'buffer' : 'binary'
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return rows
      .slice(0, 80)
      .map((row) => (row || []).map((cell) => String(cell ?? '')).join(' '))
      .join(' ')
      .toLowerCase();
  } catch {
    return '';
  }
}

function detectSbi(textOrBuffer) {
  const rawText = Buffer.isBuffer(textOrBuffer)
    ? textOrBuffer.toString('utf8', 0, Math.min(textOrBuffer.length, 12000))
    : String(textOrBuffer || '');
  const text = rawText.toLowerCase();

  if (Buffer.isBuffer(textOrBuffer) || ArrayBuffer.isView(textOrBuffer) || textOrBuffer instanceof ArrayBuffer) {
    const sample = sampleRowsFromWorkbook(textOrBuffer) || text;

    const hasSbiHeaderText = /state bank of india|\bsbi\b|txn date|transaction date.*withdrawal amt/i.test(rawText);
    const hasSbiWorkbookLayout =
      sample.includes('date') &&
      (sample.includes('particulars') || sample.includes('narration') || sample.includes('description')) &&
      (sample.includes('debit') || sample.includes('withdrawal')) &&
      (sample.includes('credit') || sample.includes('deposit')) &&
      (sample.includes('balance') || sample.includes('closing balance')) &&
      (sample.includes('chq./ref.no.') || sample.includes('chq / ref') || sample.includes('cheque') || sample.includes('ref no'));

    return hasSbiHeaderText || hasSbiWorkbookLayout;
  }

  const hasSbiText = /state bank of india|\bsbi\b|txn date|transaction date.*withdrawal amt/i.test(rawText);
  const hasSbiTextLayout =
    text.includes('date') &&
    (text.includes('particulars') || text.includes('narration') || text.includes('description')) &&
    (text.includes('debit') || text.includes('withdrawal')) &&
    (text.includes('credit') || text.includes('deposit')) &&
    (text.includes('balance') || text.includes('closing balance')) &&
    (text.includes('chq./ref.no.') || text.includes('chq / ref') || text.includes('cheque') || text.includes('ref no'));

  return hasSbiText || hasSbiTextLayout;
}

function parseSbiStatement(buffer, accountId, ext = '.csv') {
  const result =
    ext === '.csv' || ext === '.txt'
      ? parseGenericCsv(buffer, accountId)
      : parseGenericXls(buffer, accountId);
  return {
    ...result,
    bank: 'SBI',
    transactions: result.transactions.map((t) => ({ ...t, raw_bank: 'SBI' })),
    meta: { ...(result.meta || {}), bank: 'SBI' }
  };
}

module.exports = { detectSbi, parseSbiStatement };
