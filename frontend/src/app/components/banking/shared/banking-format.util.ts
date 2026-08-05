import { formatCategoryLabel } from '../../../utils/category-tree.util';

export function currencySymbol(currency?: string | null): string {
  const c = (currency || 'INR').toUpperCase();
  if (c === 'INR') return '₹';
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  return c + ' ';
}

export function formatMoney(value: any): string {
  const n = Number(value) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCurrency(value: any, currency?: string | null): string {
  return `${currencySymbol(currency)}${formatMoney(value)}`;
}

export function formatPct(value: any): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

export function formatCat(category: string | null | undefined): string {
  if (!category) return '—';
  return formatCategoryLabel(category, ' → ');
}

export function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
