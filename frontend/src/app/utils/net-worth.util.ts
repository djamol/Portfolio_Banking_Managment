export const INVESTED_TYPES = ['Mutual Fund', 'ETF', 'Stock', 'Bond', 'PPF', 'EPF', 'Crypto'];

export type NetWorthBucket = {
  invested: number;
  fds: number;
  cash: number;
  realEstate: number;
  total: number;
};

export type HoldingRow = {
  investment_type: string;
  sub_type_name?: string | null;
  sub_type_category?: string | null;
  amount: number;
  website_app_name?: string;
};

export function isRealEstate(row: HoldingRow): boolean {
  if (row.investment_type === 'Real Estate') return true;
  const sub = (row.sub_type_name || '').toLowerCase();
  const cat = (row.sub_type_category || '').toLowerCase();
  return sub.includes('real estate') || cat.includes('properties') || cat.includes('real estate');
}

export function isExcelLegacy(row: { website_app_name?: string; sub_type_name?: string | null }): boolean {
  const plat = (row.website_app_name || '').toLowerCase();
  const sub = (row.sub_type_name || '').toLowerCase();
  return plat.includes('excel legacy') || sub.includes('excel legacy');
}

export function isFunded(amount: number): boolean {
  return amount > 0;
}

export function computeBucketsFromHoldings(
  rows: HoldingRow[],
  liveBankCash: number,
  useLiveCash: boolean
): NetWorthBucket {
  let invested = 0;
  let fds = 0;
  let realEstate = 0;
  let savingBankSnapshot = 0;

  for (const row of rows) {
    const amt = row.amount;
    if (amt <= 0) continue;
    if (isRealEstate(row)) {
      realEstate += amt;
      continue;
    }
    if (row.investment_type === 'FD') {
      fds += amt;
      continue;
    }
    if (row.investment_type === 'Saving Bank Balance') {
      savingBankSnapshot += amt;
      continue;
    }
    if (INVESTED_TYPES.includes(row.investment_type)) {
      invested += amt;
    }
  }

  const cash = useLiveCash ? liveBankCash : savingBankSnapshot;
  const total = invested + fds + cash + realEstate;
  return { invested, fds, cash, realEstate, total };
}

export function bucketChartLabels(): string[] {
  return ['Invested', 'FDs', 'Cash', 'Real estate'];
}
