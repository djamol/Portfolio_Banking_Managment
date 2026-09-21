const { getDb } = require('../config/mongodb');

function formatSnapshot(row) {
  if (!row) return null;
  const { _id, ...snapshot } = row;
  return {
    ...snapshot,
    id: snapshot.id ?? _id,
    units: Number(snapshot.units),
    nav_price: Number(snapshot.nav_price),
    value: Number(snapshot.value)
  };
}

async function saveSnapshot(snapshot) {
  const collection = getDb().collection('mutual_fund_nav_history');
  await collection.updateOne(
    { investment_id: Number(snapshot.investment_id), snapshot_date: snapshot.snapshot_date },
    { $set: { ...snapshot, investment_id: Number(snapshot.investment_id), updated_at: new Date() } },
    { upsert: true }
  );
  return formatSnapshot(await collection.findOne({
    investment_id: Number(snapshot.investment_id),
    snapshot_date: snapshot.snapshot_date
  }));
}

async function listSnapshots(investmentId, from, to) {
  const filter = { investment_id: Number(investmentId) };
  if (from || to) filter.snapshot_date = {};
  if (from) filter.snapshot_date.$gte = from;
  if (to) filter.snapshot_date.$lte = to;
  return (await getDb().collection('mutual_fund_nav_history')
    .find(filter).sort({ snapshot_date: 1 }).toArray()).map(formatSnapshot);
}

module.exports = { saveSnapshot, listSnapshots };