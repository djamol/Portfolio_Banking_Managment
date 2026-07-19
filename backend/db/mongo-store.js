const { getDb } = require('../config/mongodb');

const INVESTMENT_TYPES = [
  'FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'Saving Bank Balance'
];

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return s.slice(0, 10);
}

function toDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

function formatDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: rest.id ?? _id,
    investment_date: toDateString(rest.investment_date),
    change_date: rest.change_date ? toDateString(rest.change_date) : rest.change_date,
    txn_date: rest.txn_date ? toDateString(rest.txn_date) : rest.txn_date,
    amount: rest.amount != null ? Number(rest.amount) : rest.amount,
    created_at: rest.created_at ? new Date(rest.created_at).toISOString() : rest.created_at,
    updated_at: rest.updated_at ? new Date(rest.updated_at).toISOString() : rest.updated_at
  };
}

async function nextId(collectionName) {
  const db = getDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

async function syncCounter(collectionName, maxId) {
  if (!maxId) return;
  const db = getDb();
  const current = await db.collection('counters').findOne({ _id: collectionName });
  if (!current || current.seq < maxId) {
    await db.collection('counters').updateOne(
      { _id: collectionName },
      { $set: { seq: maxId } },
      { upsert: true }
    );
  }
}

async function getAllInvestments() {
  const rows = await getDb().collection('investments')
    .find({})
    .sort({ investment_date: -1, created_at: -1 })
    .toArray();
  return rows.map(formatDoc);
}

async function searchInvestments(criteria) {
  const filter = {};
  if (criteria.website_app_name) filter.website_app_name = criteria.website_app_name;
  if (criteria.sub_type_name) filter.sub_type_name = criteria.sub_type_name;
  if (criteria.sub_type_category) filter.sub_type_category = criteria.sub_type_category;

  const rows = await getDb().collection('investments')
    .find(filter)
    .sort({ investment_date: -1, created_at: -1 })
    .toArray();
  return rows.map(formatDoc);
}

async function getInvestmentById(id) {
  const numId = Number(id);
  const doc = await getDb().collection('investments').findOne({ id: numId });
  return formatDoc(doc);
}

async function createInvestment(data) {
  const now = new Date();
  const id = await nextId('investments');
  const doc = {
    id,
    website_app_name: data.website_app_name,
    investment_type: data.investment_type,
    sub_type_name: data.sub_type_name || null,
    sub_type_category: data.sub_type_category || null,
    amount: Number(data.amount),
    investment_date: toDateString(data.investment_date),
    notes: data.notes || null,
    created_at: now,
    updated_at: now
  };

  await getDb().collection('investments').insertOne(doc);
  await addHistory({
    investment_id: id,
    amount: doc.amount,
    change_date: doc.investment_date,
    change_type: 'added',
    notes: doc.notes
  });

  return getInvestmentById(id);
}

async function updateInvestment(id, data) {
  const numId = Number(id);
  const existing = await getDb().collection('investments').findOne({ id: numId });
  if (!existing) return null;

  const now = new Date();
  const update = {
    website_app_name: data.website_app_name,
    investment_type: data.investment_type,
    sub_type_name: data.sub_type_name || null,
    sub_type_category: data.sub_type_category || null,
    amount: Number(data.amount),
    investment_date: toDateString(data.investment_date),
    notes: data.notes || null,
    updated_at: now
  };

  await getDb().collection('investments').updateOne({ id: numId }, { $set: update });

  if (Number(existing.amount) !== Number(data.amount)) {
    await addHistory({
      investment_id: numId,
      amount: Number(data.amount),
      change_date: toDateString(data.investment_date) || toDateString(new Date()),
      change_type: 'updated',
      notes: data.notes || null
    });
  }

  return getInvestmentById(numId);
}

async function deleteInvestment(id) {
  const numId = Number(id);
  const existing = await getDb().collection('investments').findOne({ id: numId });
  if (!existing) return false;

  await addHistory({
    investment_id: numId,
    amount: Number(existing.amount),
    change_date: toDateString(new Date()),
    change_type: 'removed',
    notes: existing.notes || null
  });

  await getDb().collection('investments').deleteOne({ id: numId });
  await getDb().collection('investment_history').deleteMany({ investment_id: numId });
  await getDb().collection('investment_transactions').deleteMany({ investment_id: numId });
  return true;
}

async function addHistory(entry) {
  const id = await nextId('investment_history');
  await getDb().collection('investment_history').insertOne({
    id,
    investment_id: entry.investment_id,
    amount: Number(entry.amount),
    change_date: toDateString(entry.change_date),
    change_type: entry.change_type,
    notes: entry.notes || null,
    created_at: new Date()
  });
}

async function getAllSubTypeNames() {
  const rows = await getDb().collection('sub_type_names')
    .find({})
    .sort({ investment_type: 1, name: 1 })
    .toArray();
  return rows.map(formatDoc);
}

async function getSubTypeNamesByType(investmentType) {
  const rows = await getDb().collection('sub_type_names')
    .find({ investment_type: investmentType })
    .sort({ name: 1 })
    .toArray();
  return rows.map(formatDoc);
}

async function createSubTypeName(data) {
  const existing = await getDb().collection('sub_type_names').findOne({ name: data.name });
  if (existing) {
    const err = new Error('Sub-type name already exists');
    err.code = 'ER_DUP_ENTRY';
    throw err;
  }

  const id = await nextId('sub_type_names');
  const doc = {
    id,
    name: data.name,
    investment_type: data.investment_type,
    created_at: new Date()
  };
  await getDb().collection('sub_type_names').insertOne(doc);
  return formatDoc(doc);
}

async function deleteSubTypeName(id) {
  await getDb().collection('sub_type_names').deleteOne({ id: Number(id) });
}

async function getCategories(investmentType, subTypeNameId) {
  const filter = { investment_type: investmentType };
  if (subTypeNameId && subTypeNameId !== 'null') {
    filter.$or = [
      { sub_type_name_id: Number(subTypeNameId) },
      { sub_type_name_id: null }
    ];
  }

  const categories = await getDb().collection('sub_type_categories')
    .find(filter)
    .sort({ category: 1 })
    .toArray();

  const subTypeIds = [...new Set(categories.map((c) => c.sub_type_name_id).filter(Boolean))];
  const subTypes = subTypeIds.length
    ? await getDb().collection('sub_type_names').find({ id: { $in: subTypeIds } }).toArray()
    : [];
  const subTypeMap = Object.fromEntries(subTypes.map((s) => [s.id, s.name]));

  return categories.map((c) => formatDoc({
    ...c,
    sub_type_name: c.sub_type_name_id ? subTypeMap[c.sub_type_name_id] || null : null
  }));
}

async function createCategory(data) {
  const filter = {
    category: data.category,
    investment_type: data.investment_type,
    sub_type_name_id: data.sub_type_name_id || null
  };
  const existing = await getDb().collection('sub_type_categories').findOne(filter);
  if (existing) {
    const err = new Error('Category already exists for this sub-type');
    err.code = 'ER_DUP_ENTRY';
    throw err;
  }

  const id = await nextId('sub_type_categories');
  const doc = {
    id,
    category: data.category,
    sub_type_name_id: data.sub_type_name_id || null,
    investment_type: data.investment_type,
    created_at: new Date()
  };
  await getDb().collection('sub_type_categories').insertOne(doc);

  let subTypeName = null;
  if (doc.sub_type_name_id) {
    const subType = await getDb().collection('sub_type_names').findOne({ id: doc.sub_type_name_id });
    subTypeName = subType?.name || null;
  }

  return formatDoc({ ...doc, sub_type_name: subTypeName });
}

async function getAllCategories() {
  const categories = await getDb().collection('sub_type_categories')
    .find({})
    .sort({ investment_type: 1, category: 1 })
    .toArray();

  const subTypeIds = [...new Set(categories.map((c) => c.sub_type_name_id).filter(Boolean))];
  const subTypes = subTypeIds.length
    ? await getDb().collection('sub_type_names').find({ id: { $in: subTypeIds } }).toArray()
    : [];
  const subTypeMap = Object.fromEntries(subTypes.map((s) => [s.id, s.name]));

  return categories.map((c) => formatDoc({
    ...c,
    sub_type_name: c.sub_type_name_id ? subTypeMap[c.sub_type_name_id] || null : null
  }));
}

async function deleteCategory(id) {
  await getDb().collection('sub_type_categories').deleteOne({ id: Number(id) });
}

async function findInvestmentByKey(key) {
  const doc = await getDb().collection('investments').findOne({
    website_app_name: key.website_app_name,
    investment_type: key.investment_type,
    sub_type_name: key.sub_type_name || null,
    sub_type_category: key.sub_type_category || null
  });
  return formatDoc(doc);
}

async function upsertImportedInvestment(investment, isUpdate) {
  const existing = await findInvestmentByKey(investment);
  if (existing) {
    await getDb().collection('investments').updateOne(
      { id: existing.id },
      {
        $set: {
          amount: Number(investment.amount),
          investment_date: toDateString(investment.investment_date),
          notes: investment.notes || null,
          updated_at: new Date()
        }
      }
    );
    await addHistory({
      investment_id: existing.id,
      amount: Number(investment.amount),
      change_date: toDateString(investment.investment_date),
      change_type: 'updated',
      notes: investment.notes || null
    });
    return { action: 'updated', id: existing.id };
  }

  const created = await createInvestment(investment);
  return { action: 'imported', id: created.id };
}

async function getCollectionData(collectionName) {
  const rows = await getDb().collection(collectionName).find({}).toArray();
  return rows.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });
}

async function clearAllCollections() {
  const db = getDb();
  // Child collections first (bank_transactions before bank_accounts)
  const collections = [
    'bank_transactions',
    'investment_transactions',
    'investment_history',
    'investments',
    'sub_type_categories',
    'sub_type_names',
    'bank_accounts'
  ];
  for (const name of collections) {
    await db.collection(name).deleteMany({});
  }
}

async function importCollectionData(collectionName, documents, { freshInstall = false } = {}) {
  if (!documents.length) return { inserted: 0, skipped: 0 };

  const db = getDb();
  let inserted = 0;
  let skipped = 0;

  for (const raw of documents) {
    const doc = { ...raw };
    delete doc._id;
    if (doc.id != null) doc.id = Number(doc.id);

    if (doc.created_at) doc.created_at = toDateTime(doc.created_at);
    if (doc.updated_at) doc.updated_at = toDateTime(doc.updated_at);
    if (doc.investment_date) doc.investment_date = toDateString(doc.investment_date);
    if (doc.change_date) doc.change_date = toDateString(doc.change_date);
    if (doc.txn_date) doc.txn_date = toDateString(doc.txn_date);
    if (doc.value_date) doc.value_date = toDateString(doc.value_date);

    try {
      if (freshInstall) {
        await db.collection(collectionName).insertOne(doc);
        inserted++;
      } else {
        await db.collection(collectionName).updateOne(
          { id: doc.id },
          { $set: doc },
          { upsert: true }
        );
        inserted++;
      }
    } catch (error) {
      if (/duplicate/i.test(error.message)) {
        skipped++;
      } else {
        throw error;
      }
    }
  }

  const maxId = Math.max(...documents.map((d) => Number(d.id) || 0));
  await syncCounter(collectionName, maxId);
  return { inserted, skipped };
}

async function getCollectionCounts() {
  const db = getDb();
  const { COLLECTIONS } = require('../config/mongodb');
  const counts = {};
  for (const name of COLLECTIONS) {
    counts[name] = await db.collection(name).countDocuments();
  }
  return counts;
}

module.exports = {
  INVESTMENT_TYPES,
  formatDoc,
  getAllInvestments,
  searchInvestments,
  getInvestmentById,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  addHistory,
  getAllSubTypeNames,
  getSubTypeNamesByType,
  createSubTypeName,
  deleteSubTypeName,
  getCategories,
  createCategory,
  getAllCategories,
  deleteCategory,
  findInvestmentByKey,
  upsertImportedInvestment,
  getCollectionData,
  clearAllCollections,
  importCollectionData,
  getCollectionCounts,
  syncCounter
};
