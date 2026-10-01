/**
 * Parses bank "FD Summary" statements (xls/xlsx/csv) into deposit rows.
 * Header names vary by bank, so columns are matched by keyword scoring rather
 * than fixed positions.
 */

const path = require('path');
const XLSX = require('xlsx');
const { decryptOfficeFile } = require('./office-file');

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

/** Ordered so that more specific columns claim their header first. */
const COLUMN_RULES = [
  { field: 'account_no', match: (h) => /(account|deposit|fd|receipt|certificate)\s*(no|number|id)/.test(h) || /^a\/?c\s*no/.test(h) },
  { field: 'branch', match: (h) => /branch/.test(h) },
  { field: 'holder', match: (h) => /^name$/.test(h) || /holder|customer name/.test(h) },
  { field: 'currency', match: (h) => /^ccy/.test(h) || /currency/.test(h) },
  { field: 'maturity_date', match: (h) => /maturity/.test(h) && /date/.test(h) },
  { field: 'maturity_amount', match: (h) => /maturity/.test(h) && /(amount|value|amt)/.test(h) },
  { field: 'start_date', match: (h) => /(start|open|issue|deposit|value)/.test(h) && /date/.test(h) },
  { field: 'interest_rate', match: (h) => /(rate of interest|interest rate|roi|rate)/.test(h) },
  { field: 'principal', match: (h) => /(principal|deposit amount|invested|amount)/.test(h) },
  { field: 'payout_frequency', match: (h) => /(payout|interest frequency|frequency|interest payment)/.test(h) },
  { field: 'tenure', match: (h) => /(tenure|period|term)/.test(h) },
  { field: 'serial', match: (h) => /^sr\.?\s*no/.test(h) || /^s\.?\s*no/.test(h) || /^#$/.test(h) }
];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function parseAmount(value) {
  const text = clean(value).replace(/[₹,\s]/g, '');
  if (!text || !/\d/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || /(DR|-)$/i.test(text);
  const amount = Number(text.replace(/[()]/g, '').replace(/(CR|DR)$/i, ''));
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

function parseRate(value) {
  const match = clean(value).match(/\d+(\.\d+)?/);
  if (!match) return null;
  const rate = Number(match[0]);
  return rate > 0 && rate <= 30 ? rate : null;
}

/** Accepts "16 Nov 2026", "16-11-2026", "2026-11-16", "16/11/26". */
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = clean(value);
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const named = text.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{2,4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const year = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
      return `${year}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    }
  }

  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return `${year}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  }
  return null;
}

function normalisePayout(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (/cumulative|reinvest|maturity/.test(text)) return 'at-maturity';
  if (/month/.test(text)) return 'monthly';
  if (/quarter/.test(text)) return 'quarterly';
  if (/half|semi/.test(text)) return 'half-yearly';
  if (/year|annual/.test(text)) return 'yearly';
  return null;
}

function toRows(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    return buffer.toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));
  }
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function mapHeader(row) {
  const mapping = {};
  const taken = new Set();
  for (const rule of COLUMN_RULES) {
    row.forEach((cell, index) => {
      if (taken.has(index) || mapping[rule.field] !== undefined) return;
      const header = clean(cell).toLowerCase().replace(/[.:]+$/, '');
      if (header && rule.match(header)) {
        mapping[rule.field] = index;
        taken.add(index);
      }
    });
  }
  return mapping;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const mapping = mapHeader(rows[i] || []);
    const hasAmount = mapping.principal !== undefined || mapping.maturity_amount !== undefined;
    const hasDate = mapping.maturity_date !== undefined || mapping.start_date !== undefined;
    if (hasAmount && hasDate) return { index: i, mapping };
  }
  return null;
}

function detectBank(rows) {
  const header = rows.slice(0, 6).map((row) => (row || []).map(clean).join(' ')).join(' ');
  const known = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'DCB', 'YES', 'IDFC', 'BANK OF BARODA', 'PNB', 'CANARA'];
  const upper = header.toUpperCase();
  const match = known.find((bank) => upper.includes(bank));
  if (match) return match === 'HDFC' ? 'HDFC Bank' : `${match} Bank`.replace(/ Bank Bank$/, ' Bank');
  const first = clean(rows[0]?.[0] || '').split(/\s{2,}|Page No/)[0];
  return first || null;
}

function detectHolder(rows) {
  for (const row of rows.slice(0, 15)) {
    const cells = (row || []).map(clean);
    const labelIndex = cells.findIndex((cell) => /^name\s*:?$/i.test(cell));
    if (labelIndex >= 0) {
      const value = cells.slice(labelIndex + 1).find(Boolean);
      if (value) return value;
    }
  }
  return null;
}

/** Short/Medium/Long term, matching the FD categories offered in the UI. */
function tenureCategory(startDate, maturityDate) {
  if (!startDate || !maturityDate) return null;
  const months = (new Date(`${maturityDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`))
    / (86400000 * 30.44);
  if (months < 12) return 'Short Term';
  if (months < 36) return 'Medium Term';
  return 'Long Term';
}

function isNoiseRow(cells) {
  const joined = cells.join(' ').trim();
  if (!joined) return true;
  if (/^\*+$/.test(joined.replace(/\s/g, ''))) return true;
  return /\btotal\b/i.test(joined) && !/\d{4}-\d{2}-\d{2}/.test(joined);
}

/**
 * @returns {{bank: string|null, holder: string|null, count: number, deposits: object[], skipped: number}}
 */
async function parseFdStatement({ buffer, filename = '', password = '' }) {
  let data = buffer;
  if (password) data = await decryptOfficeFile(buffer, password);

  let rows;
  try {
    rows = toRows(data, filename);
  } catch (error) {
    if (/password|encrypt/i.test(String(error?.message))) {
      throw new Error('This statement is password-protected. Enter the password and try again.');
    }
    throw new Error(`Could not read the statement: ${error.message}`);
  }

  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error('Could not find an FD summary table in this file. Expected columns such as Principal Amount, Maturity Amount, Maturity Date and Rate of Interest.');
  }

  const { mapping } = header;
  const bank = detectBank(rows);
  const holder = detectHolder(rows);
  const at = (cells, field) => (mapping[field] === undefined ? '' : cells[mapping[field]]);

  const deposits = [];
  let skipped = 0;

  for (const raw of rows.slice(header.index + 1)) {
    const cells = (raw || []).map(clean);
    if (isNoiseRow(cells)) continue;

    const principal = parseAmount(at(cells, 'principal'));
    const startDate = parseDate(at(cells, 'start_date'));
    const maturityDate = parseDate(at(cells, 'maturity_date'));
    if (!principal || (!startDate && !maturityDate)) {
      if (cells.some(Boolean)) skipped += 1;
      continue;
    }

    const maturityAmount = parseAmount(at(cells, 'maturity_amount'));
    const rate = parseRate(at(cells, 'interest_rate'));
    const accountNo = clean(at(cells, 'account_no')).replace(/\s/g, '');

    // Banks report maturity == principal for non-cumulative deposits that pay interest out.
    const cumulative = maturityAmount !== null && principal !== null
      ? maturityAmount > principal + 1
      : true;

    deposits.push({
      account_no: accountNo || null,
      branch: clean(at(cells, 'branch')) || null,
      holder: clean(at(cells, 'holder')) || holder,
      currency: clean(at(cells, 'currency')) || 'INR',
      principal,
      maturity_amount: maturityAmount,
      maturity_date: maturityDate,
      start_date: startDate,
      interest_rate: rate,
      payout_frequency: normalisePayout(at(cells, 'payout_frequency'))
        || (cumulative ? 'at-maturity' : null),
      cumulative,
      tenure_category: tenureCategory(startDate, maturityDate)
    });
  }

  if (!deposits.length) {
    throw new Error('No fixed deposit rows were found in this statement.');
  }

  return { bank, holder, count: deposits.length, deposits, skipped };
}

module.exports = { parseFdStatement, parseDate, parseAmount };
