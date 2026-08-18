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
