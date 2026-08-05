/**
 * Near-duplicate detection helpers for bank transactions.
 * Strips volatile refs so overlapping statement re-imports can match.
 */

const BALANCE_EPS = 0.05;
const NARRATION_JACCARD_MIN = 0.92;
const MAX_GROUPS = 200;

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Uppercase + collapse whitespace + strip volatile tokens
 * (UPI/IMPS/NEFT refs, long digit runs, UTR/RRN/REF codes).
 * Keeps merchant / purpose words (e.g. SWIGGY) so different payees do not collide.
 */
function normalizeNarrationForDedupe(narration) {
  let s = normalizeWhitespace(narration).toUpperCase();
  if (!s) return '';

  s = s
    .replace(/\b(UTR|RRN|REF(?:NO)?|REFERENCE|TXN(?:\s*ID)?|TID)\s*[\/:\-#]?\s*[A-Z0-9]+/gi, ' ')
    .replace(/\b[0-9]{6,}\b/g, ' ')
    .replace(/\b[0-9A-F]{12,}\b/gi, ' ')
    .replace(/\b(UPI|IMPS|NEFT|RTGS|NACH|ACH|ECS)\b/gi, ' $1 ')
    .replace(/\b\d{1,2}[:.]\d{2}([:.]\d{2})?\b/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

function tokenSet(normalized) {
  if (!normalized) return new Set();
  return new Set(normalized.split(' ').filter((t) => t.length > 1));
}

function jaccardSimilarity(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function narrationsSimilar(a, b, minJaccard = NARRATION_JACCARD_MIN) {
  const na = normalizeNarrationForDedupe(a);
  const nb = normalizeNarrationForDedupe(b);
  if (!na && !nb) return true;
  if (na === nb) return true;
  return jaccardSimilarity(tokenSet(na), tokenSet(nb)) >= minJaccard;
}

function balancesSimilar(a, b, eps = BALANCE_EPS) {
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) <= eps;
}

function amountKey(withdrawal, deposit) {
  return `${Number(withdrawal || 0).toFixed(2)}|${Number(deposit || 0).toFixed(2)}`;
}

function dateKey(txnDate) {
  return String(txnDate || '').slice(0, 10);
}

function keepScore(txn) {
  const manual = String(txn.category_source || '').toLowerCase() === 'manual' ? 1 : 0;
  const hasPayee = txn.payee && String(txn.payee).trim() && String(txn.payee) !== 'Unknown' ? 1 : 0;
  const narrLen = String(txn.narration || '').length;
  // Higher is better; id inverted so older (lower id) wins ties
  return { manual, hasPayee, narrLen, id: Number(txn.id) || 0 };
}

function preferKeep(a, b) {
  const sa = keepScore(a);
  const sb = keepScore(b);
  if (sa.manual !== sb.manual) return sa.manual > sb.manual ? a : b;
  if (sa.hasPayee !== sb.hasPayee) return sa.hasPayee > sb.hasPayee ? a : b;
  if (sa.narrLen !== sb.narrLen) return sa.narrLen > sb.narrLen ? a : b;
  return sa.id <= sb.id ? a : b;
}

function summarizeTxn(txn) {
  return {
    id: Number(txn.id),
    account_id: Number(txn.account_id),
    txn_date: dateKey(txn.txn_date),
    narration: txn.narration || '',
    withdrawal: Number(txn.withdrawal) || 0,
    deposit: Number(txn.deposit) || 0,
    balance: txn.balance == null ? null : Number(txn.balance),
    category: txn.category || null,
    category_source: txn.category_source || null,
    payee: txn.payee || null,
    fingerprint: txn.fingerprint || null,
    import_batch_id: txn.import_batch_id || null
  };
}

/**
 * Cluster rows that already share account/date/amounts into near-duplicate groups.
 */
function clusterNearDuplicates(rows, { maxGroups = MAX_GROUPS } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { groups: [], groups_found: 0, scanned: rows?.length || 0 };
  }

  const buckets = new Map();
  for (const row of rows) {
    if (row.balance == null || row.balance === undefined) continue;
    if (!Number.isFinite(Number(row.balance))) continue;
    const key = `${Number(row.account_id)}|${dateKey(row.txn_date)}|${amountKey(row.withdrawal, row.deposit)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const groups = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    const n = bucket.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function union(i, j) {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!balancesSimilar(bucket[i].balance, bucket[j].balance)) continue;
        if (!narrationsSimilar(bucket[i].narration, bucket[j].narration)) continue;
        union(i, j);
      }
    }

    const clusters = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(bucket[i]);
    }

    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      let keep = members[0];
      for (let i = 1; i < members.length; i++) {
        keep = preferKeep(keep, members[i]);
      }
      const duplicates = members.filter((m) => Number(m.id) !== Number(keep.id));
      groups.push({
        account_id: Number(keep.account_id),
        txn_date: dateKey(keep.txn_date),
        withdrawal: Number(keep.withdrawal) || 0,
        deposit: Number(keep.deposit) || 0,
        balance: Number(keep.balance),
        reason: 'same_account_date_amount_balance_narration',
        keep: summarizeTxn(keep),
        duplicates: duplicates.map(summarizeTxn),
        delete_ids: duplicates.map((d) => Number(d.id))
      });
    }
  }

  groups.sort((a, b) => {
    const da = a.txn_date.localeCompare(b.txn_date);
    if (da !== 0) return -da;
    return a.account_id - b.account_id;
  });

  return {
    groups: groups.slice(0, maxGroups),
    groups_found: groups.length,
    scanned: rows.length,
    truncated: groups.length > maxGroups
  };
}

function collectDeleteIds(scanResult) {
  const ids = [];
  for (const g of scanResult.groups || []) {
    for (const id of g.delete_ids || []) ids.push(Number(id));
  }
  return ids;
}

module.exports = {
  BALANCE_EPS,
  NARRATION_JACCARD_MIN,
  MAX_GROUPS,
  normalizeNarrationForDedupe,
  narrationsSimilar,
  balancesSimilar,
  amountKey,
  dateKey,
  preferKeep,
  clusterNearDuplicates,
  collectDeleteIds,
  summarizeTxn
};
