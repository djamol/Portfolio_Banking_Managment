/** Hierarchical bank category helpers for Category_Sub_Detail (and legacy "A / B"). */

export type CategoryTreeNode = {
  /** Path key, e.g. Expense or Expense_Loan */
  key: string;
  /** Display label for this level */
  label: string;
  /** Nesting depth starting at 0 */
  depth: number;
  /** Child groups / leaves */
  children: CategoryTreeNode[];
  /** All concrete category values under this node (inclusive) */
  leaves: string[];
};

export function splitCategoryParts(category: string): string[] {
  const raw = String(category || '').trim();
  if (!raw) return [];
  if (raw.includes('_')) {
    return raw.split('_').map((p) => p.trim()).filter(Boolean);
  }
  if (raw.includes(' / ')) {
    return raw.split(' / ').map((p) => p.trim()).filter(Boolean);
  }
  return [raw];
}

export function formatCategoryLabel(category: string, separator = ' → '): string {
  const parts = splitCategoryParts(category);
  return parts.length ? parts.join(separator) : category;
}

/** Join path parts back to stored category value (prefer underscore hierarchy). */
export function joinCategoryParts(parts: string[], sampleLeaf?: string): string {
  const clean = parts.map((p) => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  if (sampleLeaf && sampleLeaf.includes(' / ') && !sampleLeaf.includes('_')) {
    return clean.join(' / ');
  }
  return clean.join('_');
}

/**
 * Build a selectable tree from flat category strings.
 * Leaf values remain the original full category string.
 */
export function buildCategoryTree(categories: string[]): CategoryTreeNode[] {
  const rootChildren: CategoryTreeNode[] = [];
  const byKey = new Map<string, CategoryTreeNode>();

  const ensure = (key: string, label: string, depth: number, parentChildren: CategoryTreeNode[]): CategoryTreeNode => {
    let node = byKey.get(key);
    if (!node) {
      node = { key, label, depth, children: [], leaves: [] };
      byKey.set(key, node);
      parentChildren.push(node);
    }
    return node;
  };

  const sorted = [...new Set(categories.map((c) => String(c || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const cat of sorted) {
    const parts = splitCategoryParts(cat);
    if (!parts.length) continue;
    let parentChildren = rootChildren;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path = path ? `${path}_${parts[i]}` : parts[i];
      // Use original string as key for single-part legacy so leaves match exactly
      const key = i === parts.length - 1 && parts.length === 1 ? cat : path;
      const node = ensure(key, parts[i], i, parentChildren);
      if (!node.leaves.includes(cat)) node.leaves.push(cat);
      parentChildren = node.children;
    }
  }

  // Propagate leaves up so parents know all descendants
  const rollup = (nodes: CategoryTreeNode[]): string[] => {
    const all: string[] = [];
    for (const n of nodes) {
      const childLeaves = rollup(n.children);
      const merged = [...new Set([...n.leaves, ...childLeaves])];
      n.leaves = merged;
      all.push(...merged);
    }
    return [...new Set(all)];
  };
  rollup(rootChildren);

  const sortNodes = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(rootChildren);
  return rootChildren;
}
