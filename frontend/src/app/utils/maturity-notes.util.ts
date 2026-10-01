const MATURITY_TAG = /maturity\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i;
const MATURES_TAG = /matures?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i;

export const MATURITY_HELPER_TYPES = ['FD', 'Bond', 'PPF', 'EPF'];

export function showsMaturityHelper(type: string | null | undefined): boolean {
  return !!type && MATURITY_HELPER_TYPES.includes(type);
}

/** Returns YYYY-MM-DD from notes, or null. */
export function parseMaturityDateFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(MATURITY_TAG) || notes.match(MATURES_TAG);
  return match ? match[1] : null;
}

export function parseMaturityDateObject(notes: string | null | undefined): Date | null {
  const ymd = parseMaturityDateFromNotes(notes);
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const RATE_TAG = /(?:rate|roi|interest)\s*[:=]?\s*(\d+(?:\.\d+)?)/i;
const PERCENT_TAG = /(\d+(?:\.\d+)?)\s*%/;
const PAYOUT_WORD = '(monthly|quarterly|half[- ]?yearly|yearly|annual(?:ly)?|cumulative|at[- ]maturity)';
const PAYOUT_TAGS = [
  new RegExp(`payout\\s*[:=]?\\s*${PAYOUT_WORD}`, 'i'),
  new RegExp(`${PAYOUT_WORD}\\s*(?:interest\\s*)?pay`, 'i')
];

export function parseRateFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const match = notes.match(RATE_TAG) || notes.match(PERCENT_TAG);
  const rate = match ? Number(match[1]) : NaN;
  return rate > 0 && rate <= 30 ? rate : null;
}

export function parsePayoutFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const tag of PAYOUT_TAGS) {
    const match = notes.match(tag);
    if (!match) continue;
    const word = match[1].toLowerCase();
    if (word.startsWith('half')) return 'half-yearly';
    if (word.startsWith('annual')) return 'yearly';
    if (word === 'cumulative' || word.startsWith('at')) return 'at-maturity';
    return word;
  }
  return null;
}

const toNum = (value: any): number | null =>
  value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? null : Number(value);

/** Deposit fields for edit/clone forms; selects need '' (not null) to match their default option. */
export function depositFormFields(src: any) {
  return {
    interest_rate: toNum(src?.interest_rate) ?? parseRateFromNotes(src?.notes),
    maturity_amount: toNum(src?.maturity_amount),
    payout_frequency: src?.payout_frequency || parsePayoutFromNotes(src?.notes) || '',
    compounding: src?.compounding || ''
  };
}

/** Write or clear `maturity:YYYY-MM-DD` in notes without dropping other text. */
export function setMaturityDateInNotes(notes: string | null | undefined, ymd: string | null | undefined): string {
  const current = notes || '';
  const cleaned = current
    .replace(MATURITY_TAG, '')
    .replace(MATURES_TAG, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!ymd) return cleaned;
  return cleaned ? `${cleaned}\nmaturity:${ymd}` : `maturity:${ymd}`;
}
