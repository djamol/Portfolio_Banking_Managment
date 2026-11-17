export type BreakdownLevel = 'platform' | 'type' | 'subType' | 'category';
export type BreakdownUnit = 'lakh' | 'crore' | 'rupee';

export type BreakdownHolding = {
  website_app_name?: string | null;
  investment_type?: string | null;
  sub_type_name?: string | null;
  sub_type_category?: string | null;
  amount?: number | string | null;
};

export type BreakdownNode = {
  id: string;
  label: string;
  level: 'portfolio' | BreakdownLevel;
  path: string[];
  amount: number;
  count: number;
  pctOfPortfolio: number;
  pctOfParent: number;
  collapsedOthers: boolean;
  /** Labels rolled into this box. One name for a normal box, several for Others. */
  members: string[];
  directMatch: boolean;
  dim: boolean;
  children: BreakdownNode[];
  band: number;
};

export type LayoutNode = BreakdownNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  amountLabel: string;
  metaLabel: string;
  tooltip: string;
  stripe: string;
};

export type LayoutLink = {
  d: string;
};

export type BreakdownLayout = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  width: number;
  height: number;
  portfolioAmount: number;
  holdingCount: number;
  childRows: Array<{ label: string; amount: number; count: number; pctOfPortfolio: number; pctOfParent: number }>;
  appliedFocus: string[];
  searchMiss: boolean;
};

const NODE_W = 188;
const NODE_H = 64;
const GAP_X = 56;
const GAP_Y = 12;
const PAD = 16;

const LEVEL_FIELD: Record<BreakdownLevel, keyof BreakdownHolding> = {
  platform: 'website_app_name',
  type: 'investment_type',
  subType: 'sub_type_name',
  category: 'sub_type_category'
};

export const LEVEL_STRIPE: Record<LayoutNode['level'] | 'others', string> = {
  portfolio: '#4a7c9b',
  platform: '#3b6f8f',
  type: '#3d8b6e',
  subType: '#b8860b',
  category: '#6d5b8a',
  others: '#64748b'
};

export function levelLabel(level: BreakdownLevel): string {
  switch (level) {
    case 'platform': return 'Platform';
    case 'type': return 'Type';
    case 'subType': return 'Sub type';
    case 'category': return 'Category';
  }
}

export function formatBreakdownAmount(value: number, unit: BreakdownUnit): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (unit === 'crore') {
    return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (unit === 'lakh') {
    return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  }
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function toAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function fieldLabel(row: BreakdownHolding, level: BreakdownLevel): string {
  const raw = row[LEVEL_FIELD[level]];
  const text = raw == null ? '' : String(raw).trim();
  return text || 'Unspecified';
}

function sumAmount(rows: BreakdownHolding[]): number {
  return rows.reduce((sum, row) => sum + toAmount(row.amount), 0);
}

type Group = { label: string; rows: BreakdownHolding[] };

function groupRows(rows: BreakdownHolding[], level: BreakdownLevel): Group[] {
  const buckets = new Map<string, BreakdownHolding[]>();
  for (const row of rows) {
    const label = fieldLabel(row, level);
    const list = buckets.get(label);
    if (list) list.push(row);
    else buckets.set(label, [row]);
  }
  return [...buckets.entries()]
    .map(([label, grouped]) => ({ label, rows: grouped }))
    .sort((a, b) => sumAmount(b.rows) - sumAmount(a.rows) || a.label.localeCompare(b.label));
}

function makeNode(
  id: string,
  label: string,
  level: BreakdownNode['level'],
  path: string[],
  amount: number,
  count: number,
  portfolioAmount: number,
  parentAmount: number,
  collapsedOthers: boolean,
  members: string[],
  children: BreakdownNode[]
): BreakdownNode {
  return {
    id,
    label,
    level,
    path,
    amount,
    count,
    pctOfPortfolio: portfolioAmount ? (amount / portfolioAmount) * 100 : 0,
    pctOfParent: parentAmount ? (amount / parentAmount) * 100 : 0,
    collapsedOthers,
    members,
    directMatch: false,
    dim: false,
    children,
    band: 0
  };
}

function buildChildren(
  rows: BreakdownHolding[],
  levels: BreakdownLevel[],
  depth: number,
  depthLeft: number,
  path: string[],
  portfolioAmount: number,
  topN: number,
  minPct: number
): BreakdownNode[] {
  if (depthLeft <= 0 || depth >= levels.length || !rows.length) return [];

  const level = levels[depth];
  const parentAmount = sumAmount(rows);
  let ranked = groupRows(rows, level);
  const rest: Group[] = [];

  if (minPct > 0 && ranked.length > 1 && parentAmount > 0) {
    const floor = (minPct / 100) * parentAmount;
    const above = ranked.filter((group) => sumAmount(group.rows) >= floor);
    const below = ranked.filter((group) => sumAmount(group.rows) < floor);
    if (above.length) {
      ranked = above;
      rest.push(...below);
    }
  }

  const cap = Math.max(1, topN);
  if (ranked.length > cap) {
    rest.push(...ranked.slice(cap));
    ranked = ranked.slice(0, cap);
  }

  const nodes = ranked.map((group) => {
    const nextPath = [...path, group.label];
    const id = `${level}:${nextPath.join('\u0001')}`;
    return makeNode(
      id,
      group.label,
      level,
      nextPath,
      sumAmount(group.rows),
      group.rows.length,
      portfolioAmount,
      parentAmount,
      false,
      [group.label],
      buildChildren(group.rows, levels, depth + 1, depthLeft - 1, nextPath, portfolioAmount, topN, minPct)
    );
  });

  if (rest.length) {
    const restRows = rest.flatMap((group) => group.rows);
    const id = `others:${[...path, `others-${depth}`].join('\u0001')}`;
    nodes.push(makeNode(
      id,
      `Others (${rest.length})`,
      level,
      path,
      sumAmount(restRows),
      restRows.length,
      portfolioAmount,
      parentAmount,
      true,
      rest.map((group) => group.label),
      []
    ));
  }

  return nodes;
}

function markSearch(node: BreakdownNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  let childHit = false;
  for (const child of node.children) {
    if (markSearch(child, query)) childHit = true;
  }
  const direct = !!q && node.label.toLowerCase().includes(q);
  node.directMatch = direct;
  node.dim = !!q && !direct && !childHit;
  return !q || direct || childHit;
}

function annotateBand(node: BreakdownNode): number {
  if (!node.children.length) {
    node.band = NODE_H;
    return NODE_H;
  }
  const inner = node.children.reduce((sum, child) => sum + annotateBand(child), 0);
  node.band = Math.max(NODE_H, inner + GAP_Y * (node.children.length - 1));
  return node.band;
}

function place(
  node: BreakdownNode,
  depth: number,
  top: number,
  unit: BreakdownUnit,
  nodes: LayoutNode[],
  links: LayoutLink[],
  maxDepth: { value: number }
): void {
  maxDepth.value = Math.max(maxDepth.value, depth);
  const x = PAD + depth * (NODE_W + GAP_X);
  const y = top;
  nodes.push({
    ...node,
    children: node.children,
    x,
    y,
    width: NODE_W,
    height: NODE_H,
    amountLabel: formatBreakdownAmount(node.amount, unit),
    metaLabel: `${node.pctOfPortfolio.toFixed(1)}% · ${node.count} holding${node.count === 1 ? '' : 's'}`,
    tooltip: [
      node.collapsedOthers
        ? `Others combines ${node.members.join(', ')} because they fell outside Top branches or Hide under`
        : node.label,
      formatBreakdownAmount(node.amount, 'rupee'),
      `${node.pctOfPortfolio.toFixed(1)}% of portfolio`,
      `${node.pctOfParent.toFixed(1)}% of parent`,
      `${node.count} holding${node.count === 1 ? '' : 's'}`,
      node.level === 'portfolio' ? '' : 'Click to open these holdings'
    ].filter(Boolean).join(' · '),
    stripe: node.collapsedOthers ? LEVEL_STRIPE.others : LEVEL_STRIPE[node.level]
  });

  let childTop = top;
  const parentMidY = y + NODE_H / 2;
  for (const child of node.children) {
    const childX = PAD + (depth + 1) * (NODE_W + GAP_X);
    const childMidY = childTop + NODE_H / 2;
    const midX = x + NODE_W + GAP_X / 2;
    links.push({
      d: `M ${x + NODE_W} ${parentMidY} H ${midX} V ${childMidY} H ${childX}`
    });
    place(child, depth + 1, childTop, unit, nodes, links, maxDepth);
    childTop += child.band + GAP_Y;
  }
}

export function buildBreakdownLayout(options: {
  rows: BreakdownHolding[];
  levels: BreakdownLevel[];
  depth: number;
  topN: number;
  minPct: number;
  unit: BreakdownUnit;
  search: string;
  focusPath: string[];
}): BreakdownLayout {
  const portfolioAmount = sumAmount(options.rows);
  const levels = options.levels;
  let focus = options.focusPath.filter(Boolean);
  if (focus.length > levels.length) focus = [];

  let focusedRows = options.rows;
  for (let i = 0; i < focus.length; i++) {
    const level = levels[i];
    const label = focus[i];
    focusedRows = focusedRows.filter((row) => fieldLabel(row, level) === label);
    if (!focusedRows.length) {
      focus = [];
      focusedRows = options.rows;
      break;
    }
  }

  const rootAmount = sumAmount(focusedRows);
  const rootLabel = focus.length ? focus[focus.length - 1] : 'Portfolio';
  const rootLevel: BreakdownNode['level'] = focus.length ? levels[focus.length - 1] : 'portfolio';
  const remaining = levels.length - focus.length;
  const visibleDepth = remaining > 0 ? Math.max(1, Math.min(options.depth, remaining)) : 0;

  const children = visibleDepth
    ? buildChildren(
      focusedRows,
      levels,
      focus.length,
      visibleDepth,
      focus,
      portfolioAmount,
      options.topN,
      options.minPct
    )
    : [];

  const root = makeNode(
    focus.length ? `focus:${focus.join('\u0001')}` : 'portfolio',
    rootLabel,
    rootLevel,
    focus,
    rootAmount,
    focusedRows.length,
    portfolioAmount,
    portfolioAmount,
    false,
    [],
    children
  );
  const searchHit = markSearch(root, options.search);
  const searchMiss = !!options.search.trim() && !searchHit;
  if (searchMiss) {
    const undim = (node: BreakdownNode) => {
      node.dim = false;
      node.children.forEach(undim);
    };
    undim(root);
  }
  annotateBand(root);

  const nodes: LayoutNode[] = [];
  const links: LayoutLink[] = [];
  const maxDepth = { value: 0 };
  place(root, 0, PAD, options.unit, nodes, links, maxDepth);

  return {
    nodes,
    links,
    width: PAD * 2 + (maxDepth.value + 1) * NODE_W + maxDepth.value * GAP_X,
    height: root.band + PAD * 2,
    portfolioAmount,
    holdingCount: options.rows.length,
    childRows: children.map((child) => ({
      label: child.label,
      amount: child.amount,
      count: child.count,
      pctOfPortfolio: child.pctOfPortfolio,
      pctOfParent: child.pctOfParent
    })),
    appliedFocus: focus,
    searchMiss
  };
}
