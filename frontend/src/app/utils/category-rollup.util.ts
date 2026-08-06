/** Roll up flat bank category analytics rows by hierarchy depth (Category_Sub_Detail). */

import {
  formatCategoryLabel,
  joinCategoryParts,
  splitCategoryParts
} from './category-tree.util';

export type CategoryGrain = 'parent' | 'sub' | 'leaf';

export type CategoryAmountRow = {
  category: string;
  txn_count?: number;
  total_debit?: number;
  total_credit?: number;
};

export type RolledCategoryRow = {
  /** Aggregation key (path prefix or full leaf) */
  key: string;
  /** Display label */
  label: string;
  txn_count: number;
  total_debit: number;
  total_credit: number;
  /** Concrete leaf category strings under this bucket */
  leaves: string[];
  /** True when drilling would reveal more specific children */
  canDrill: boolean;
};

export function grainToDepth(grain: CategoryGrain): number | null {
  if (grain === 'parent') return 1;
  if (grain === 'sub') return 2;
  return null;
}

export function categoryKeyAtDepth(category: string, depth: number | null): string {
  const raw = String(category || '').trim() || 'Uncategorized';
  if (depth == null) return raw;
  const parts = splitCategoryParts(raw);
  if (!parts.length) return raw;
  const take = Math.min(depth, parts.length);
  return joinCategoryParts(parts.slice(0, take), raw);
}

/** True if `category` is the drill key or a descendant path. */
export function isUnderCategoryKey(category: string, drillKey: string): boolean {
  const cat = String(category || '').trim();
  const key = String(drillKey || '').trim();
  if (!key) return true;
  if (!cat) return false;
  if (cat === key) return true;
  // Underscore hierarchy
  if (cat.startsWith(key + '_')) return true;
  // Legacy "A / B"
  if (cat.startsWith(key + ' / ')) return true;
  return false;
}

/**
 * Target rollup depth for the current view.
 * At root: parent=1, sub=2, leaf=full.
 * When drilled: show the next level under the drill key (or leaves if grain is leaf).
 */
export function resolveRollupDepth(grain: CategoryGrain, drillKey = ''): number | null {
  if (grain === 'leaf') return null;
  const grainDepth = grainToDepth(grain)!;
  const drillParts = drillKey ? splitCategoryParts(drillKey) : [];
  if (!drillParts.length) return grainDepth;
  return Math.max(grainDepth, drillParts.length + 1);
}

export function rollupCategoryRows(
  rows: CategoryAmountRow[],
  grain: CategoryGrain,
  drillKey = ''
): RolledCategoryRow[] {
  const depth = resolveRollupDepth(grain, drillKey);
  const map = new Map<string, RolledCategoryRow>();

  for (const row of rows || []) {
    const cat = String(row.category || '').trim() || 'Uncategorized';
    if (drillKey && !isUnderCategoryKey(cat, drillKey)) continue;

    const key = categoryKeyAtDepth(cat, depth);
    // When drilled, skip the drill node itself if it would be the only bucket at this depth
    if (drillKey && key === drillKey && depth != null) {
      const parts = splitCategoryParts(cat);
      if (parts.length <= splitCategoryParts(drillKey).length) continue;
    }

    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: formatCategoryLabel(key),
        txn_count: 0,
        total_debit: 0,
        total_credit: 0,
        leaves: [],
        canDrill: false
      };
      map.set(key, bucket);
    }
    bucket.txn_count += Number(row.txn_count) || 0;
    bucket.total_debit += Number(row.total_debit) || 0;
    bucket.total_credit += Number(row.total_credit) || 0;
    if (!bucket.leaves.includes(cat)) bucket.leaves.push(cat);
  }

  for (const bucket of map.values()) {
    const keyParts = splitCategoryParts(bucket.key);
    bucket.canDrill =
      grain !== 'leaf' &&
      bucket.leaves.some((leaf) => {
        const leafParts = splitCategoryParts(leaf);
        return leafParts.length > keyParts.length || leaf !== bucket.key;
      });
  }

  return [...map.values()].sort(
    (a, b) => b.total_debit + b.total_credit - (a.total_debit + a.total_credit)
  );
}

/** Roll up month×category rows to month×rollupKey. */
export function rollupCategoryMonthRows(
  rows: Array<{ month?: string; category?: string; txn_count?: number; total_debit?: number; total_credit?: number }>,
  grain: CategoryGrain,
  drillKey = ''
): Array<{ month: string; category: string; txn_count: number; total_debit: number; total_credit: number }> {
  const depth = resolveRollupDepth(grain, drillKey);
  const map = new Map<string, { month: string; category: string; txn_count: number; total_debit: number; total_credit: number }>();

  for (const row of rows || []) {
    const month = String(row.month || '');
    if (!month) continue;
    const cat = String(row.category || '').trim() || 'Uncategorized';
    if (drillKey && !isUnderCategoryKey(cat, drillKey)) continue;
    const key = categoryKeyAtDepth(cat, depth);
    if (drillKey && key === drillKey && depth != null) {
      const parts = splitCategoryParts(cat);
      if (parts.length <= splitCategoryParts(drillKey).length) continue;
    }
    const mapKey = `${month}::${key}`;
    let bucket = map.get(mapKey);
    if (!bucket) {
      bucket = { month, category: key, txn_count: 0, total_debit: 0, total_credit: 0 };
      map.set(mapKey, bucket);
    }
    bucket.txn_count += Number(row.txn_count) || 0;
    bucket.total_debit += Number(row.total_debit) || 0;
    bucket.total_credit += Number(row.total_credit) || 0;
  }

  return [...map.values()];
}

export function defaultIncomeCategories(allCategories: string[]): string[] {
  const fromList = (allCategories || []).filter(
    (c) => c === 'Interest Income' || String(c).startsWith('Income_') || String(c).startsWith('Income /')
  );
  return [...new Set(fromList)].sort((a, b) => a.localeCompare(b));
}

/** Default spend categories: exclude income and transfers. */
export function defaultExpenseCategories(allCategories: string[]): string[] {
  const fromList = (allCategories || []).filter((c) => {
    const s = String(c || '');
    if (!s) return false;
    if (s === 'Interest Income' || s.startsWith('Income_') || s.startsWith('Income /')) return false;
    if (s.startsWith('Transfer_') || s.startsWith('Transfer /')) return false;
    return true;
  });
  return [...new Set(fromList)].sort((a, b) => a.localeCompare(b));
}

/** Expand selected income keys (may be parents) to matching leaf rows. */
export function matchSelectedCategories(
  category: string,
  selected: string[]
): boolean {
  if (!selected?.length) return false;
  const cat = String(category || '').trim();
  return selected.some((sel) => isUnderCategoryKey(cat, sel) || cat === sel);
}
