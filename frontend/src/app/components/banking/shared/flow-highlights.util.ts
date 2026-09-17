/** Month/year rankings and highlight stats for Income / Expense pages. */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type PeriodGrainKey = 'month' | 'year';

export type AmountPeriodRow = {
  key: string;
  label: string;
  amount: number;
  txn_count: number;
  pct: number;
  grain: PeriodGrainKey;
};

export type MonthBucket = {
  month: string;
  amount: number;
  txn_count: number;
};

export type FlowHighlights = {
  peakMonth: AmountPeriodRow | null;
  peakYear: AmountPeriodRow | null;
  quietMonth: AmountPeriodRow | null;
  avgMonthly: number;
  monthCount: number;
  peakVsAvg: number | null;
  latest: AmountPeriodRow | null;
  previous: AmountPeriodRow | null;
  latestChangePct: number | null;
};

export function formatYearMonthLabel(yyyyMm: string): string {
  const [y, m] = String(yyyyMm || '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return String(yyyyMm || '');
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

export function monthToPeriodRow(bucket: MonthBucket, total: number): AmountPeriodRow {
  const amount = Number(bucket.amount) || 0;
  return {
    key: bucket.month,
    label: formatYearMonthLabel(bucket.month),
    amount,
    txn_count: Number(bucket.txn_count) || 0,
    pct: total > 0 ? (amount / total) * 100 : 0,
    grain: 'month'
  };
}

export function yearToPeriodRow(
  year: string,
  amount: number,
  txnCount: number,
  total: number
): AmountPeriodRow {
  return {
    key: year,
    label: year,
    amount,
    txn_count: txnCount,
    pct: total > 0 ? (amount / total) * 100 : 0,
    grain: 'year'
  };
}

export function rankMonths(buckets: MonthBucket[], total: number): AmountPeriodRow[] {
  return [...buckets]
    .map((b) => monthToPeriodRow(b, total))
    .sort((a, b) => b.amount - a.amount || b.key.localeCompare(a.key));
}

export function rankYears(buckets: MonthBucket[], total: number): AmountPeriodRow[] {
  const map = new Map<string, { amount: number; txn_count: number }>();
  for (const b of buckets) {
    const year = String(b.month || '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    const cur = map.get(year) || { amount: 0, txn_count: 0 };
    cur.amount += Number(b.amount) || 0;
    cur.txn_count += Number(b.txn_count) || 0;
    map.set(year, cur);
  }
  return [...map.entries()]
    .map(([year, v]) => yearToPeriodRow(year, v.amount, v.txn_count, total))
    .sort((a, b) => b.amount - a.amount || b.key.localeCompare(a.key));
}

export function buildFlowHighlights(buckets: MonthBucket[], total: number): FlowHighlights {
  const months = rankMonths(buckets, total);
  const years = rankYears(buckets, total);
  const chronological = [...buckets].sort((a, b) => a.month.localeCompare(b.month));
  const monthCount = months.length;
  const avgMonthly = monthCount ? total / monthCount : 0;
  const peakMonth = months[0] || null;
  const quietMonth = months.length ? months[months.length - 1] : null;
  const latestBucket = chronological[chronological.length - 1];
  const previousBucket = chronological[chronological.length - 2];
  const latest = latestBucket ? monthToPeriodRow(latestBucket, total) : null;
  const previous = previousBucket ? monthToPeriodRow(previousBucket, total) : null;
  let latestChangePct: number | null = null;
  if (latest && previous && previous.amount > 0) {
    latestChangePct = ((latest.amount - previous.amount) / previous.amount) * 100;
  }
  return {
    peakMonth,
    peakYear: years[0] || null,
    quietMonth: quietMonth && peakMonth && quietMonth.key !== peakMonth.key ? quietMonth : null,
    avgMonthly,
    monthCount,
    peakVsAvg: peakMonth && avgMonthly > 0 ? peakMonth.amount / avgMonthly : null,
    latest,
    previous,
    latestChangePct
  };
}
