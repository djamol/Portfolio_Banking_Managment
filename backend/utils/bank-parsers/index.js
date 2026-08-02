const path = require('path');
const { parseHdfcCsv, parseHdfcXls, parseHdfcStatement, detectHdfc } = require('./hdfc-csv');
const { parseIciciXls, detectIcici } = require('./icici-xls');
const { parseDcbXls, detectDcb } = require('./dcb-xls');
const { detectSbi, parseSbiStatement } = require('./sbi');
const { detectAxis, parseAxisStatement } = require('./axis');
const { detectKotak, parseKotakStatement } = require('./kotak');
const { parseGenericCsv, parseGenericXls } = require('./generic');
const { extractPdfText } = require('./pdf-text');
const { detectHdfcCreditCard, parseHdfcCcFromLines, parseHdfcCreditCardPdf } = require('./hdfc-cc-pdf');

function extensionOf(filename = '') {
  return path.extname(filename).toLowerCase();
}

function normalizeBankHint(bankHint) {
  const h = String(bankHint || '').toUpperCase().replace(/\s+/g, '');
  if (!h || h === 'OTHER' || h === 'AUTO') return '';
  if (h.includes('HDFC') && (h.includes('CC') || h.includes('CREDIT'))) return 'HDFC_CC';
  if (h.includes('HDFC')) return 'HDFC';
  if (h.includes('ICICI')) return 'ICICI';
  if (h.includes('DCB')) return 'DCB';
  if (h.includes('SBI') || h.includes('STATEBANK')) return 'SBI';
  if (h.includes('AXIS')) return 'AXIS';
  if (h.includes('KOTAK')) return 'KOTAK';
  return h;
}

function parseByHint(hint, buffer, accountId, ext, options) {
  switch (hint) {
    case 'HDFC':
      return parseHdfcStatement(buffer, accountId, ext);
    case 'DCB':
      return parseDcbXls(buffer, accountId, options);
    case 'ICICI':
      return parseIciciXls(buffer, accountId);
    case 'SBI':
      return parseSbiStatement(buffer, accountId, ext);
    case 'AXIS':
      return parseAxisStatement(buffer, accountId, ext);
    case 'KOTAK':
      return parseKotakStatement(buffer, accountId, ext);
    default:
      return null;
  }
}

function applyCustomRules(result, accountId, customRules) {
  if (customRules?.length && result?.transactions?.length) {
    const { finalizeParsedTxn } = require('./common');
    result.transactions = result.transactions.map((t) =>
      finalizeParsedTxn(
        {
          txnDate: t.txn_date,
          valueDate: t.value_date,
          narration: t.narration,
          refNo: t.ref_no,
          withdrawal: t.withdrawal,
          deposit: t.deposit,
          balance: t.balance,
          rawBank: t.raw_bank,
          tags: t.tags,
          notes: t.notes,
          payee: t.payee
        },
        accountId,
        customRules
      )
    );
  }
  return result;
}

async function parsePdfStatement(buffer, accountId, { password, bankHint, customRules } = {}) {
  const hint = normalizeBankHint(bankHint);
  if (hint === 'HDFC_CC') {
    return parseHdfcCreditCardPdf(buffer, accountId, { password, customRules });
  }

  const extracted = await extractPdfText(buffer, { password });
  if (detectHdfcCreditCard(extracted.text) || /credit\s*card/i.test(hint)) {
    return parseHdfcCcFromLines(extracted.lines, accountId, customRules || []);
  }

  throw new Error(
    'PDF bank savings/current statements are not supported yet. For credit cards, upload an HDFC Millennia / year-end CC PDF (enter password if locked). Otherwise export CSV/Excel.'
  );
}

async function parseBankStatement({
  buffer,
  filename,
  accountId,
  bankHint,
  accountNumber,
  customRules,
  password
}) {
  if (!buffer || !buffer.length) {
    throw new Error('Empty file uploaded');
  }
  if (!accountId) {
    throw new Error('accountId is required for import');
  }

  const ext = extensionOf(filename);
  const hint = normalizeBankHint(bankHint);
  const textPreview = buffer.toString('utf8', 0, Math.min(buffer.length, 8000));
  const options = { accountNumber };
  const isExcel = ext === '.xls' || ext === '.xlsx';

  if (ext === '.pdf') {
    const result = await parsePdfStatement(buffer, accountId, {
      password,
      bankHint,
      customRules
    });
    return applyCustomRules(result, accountId, customRules);
  }

  let result = hint === 'HDFC_CC' ? null : parseByHint(hint, buffer, accountId, ext, options);

  if (!result) {
    if (ext === '.csv' && detectHdfc(textPreview)) {
      result = parseHdfcCsv(buffer, accountId);
    } else if (isExcel && detectHdfc(buffer)) {
      result = parseHdfcXls(buffer, accountId);
    } else if (isExcel && detectDcb(buffer)) {
      result = parseDcbXls(buffer, accountId, options);
    } else if (isExcel && detectAxis(buffer)) {
      result = parseAxisStatement(buffer, accountId, ext);
    } else if (isExcel && detectIcici(buffer)) {
      result = parseIciciXls(buffer, accountId);
    } else if (detectSbi(ext === '.csv' ? textPreview : buffer)) {
      result = parseSbiStatement(buffer, accountId, ext);
    } else if (detectAxis(ext === '.csv' ? textPreview : buffer)) {
      result = parseAxisStatement(buffer, accountId, ext);
    } else if (detectKotak(ext === '.csv' ? textPreview : buffer)) {
      result = parseKotakStatement(buffer, accountId, ext);
    } else if (ext === '.csv') {
      if (detectHdfc(textPreview)) result = parseHdfcCsv(buffer, accountId);
      else result = parseGenericCsv(buffer, accountId);
    } else if (isExcel) {
      result = parseGenericXls(buffer, accountId);
    } else {
      try {
        if (detectHdfc(textPreview)) result = parseHdfcCsv(buffer, accountId);
        else result = parseGenericCsv(buffer, accountId);
      } catch (csvErr) {
        try {
          if (detectHdfc(buffer)) result = parseHdfcXls(buffer, accountId);
          else if (detectAxis(buffer)) result = parseAxisStatement(buffer, accountId, '.xls');
          else if (detectDcb(buffer)) result = parseDcbXls(buffer, accountId, options);
          else result = parseIciciXls(buffer, accountId);
        } catch {
          throw new Error(`Unsupported bank statement format: ${csvErr.message}`);
        }
      }
    }
  }

  return applyCustomRules(result, accountId, customRules);
}

module.exports = {
  parseBankStatement,
  parseHdfcCsv,
  parseHdfcXls,
  parseIciciXls,
  parseDcbXls,
  parseGenericCsv,
  parseGenericXls,
  parseHdfcCreditCardPdf
};
