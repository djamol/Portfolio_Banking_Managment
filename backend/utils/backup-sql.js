const fs = require('fs');
const path = require('path');
const { isMongoDb, getPool } = require('../config/index');
const { exportDatabaseSql } = require('./sql-export');
const { createSingleFileZip } = require('./zip-file');
const logger = require('./logger');

const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'backups');
const ZIP_SUFFIX = '.sql.zip';

function getBackupDir() {
  const raw = String(process.env.BACKUP_DIR || '').trim();
  return raw ? path.resolve(raw) : DEFAULT_BACKUP_DIR;
}

function ensureBackupDir() {
  const dir = getBackupDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function isBackupZipName(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith(ZIP_SUFFIX);
}

/**
 * Create a SQL dump, zip it as `portfolio_YYYY-MM-DD_HHmmss.sql.zip`, write under BACKUP_DIR.
 */
async function createSqlBackupZip() {
  const dir = ensureBackupDir();
  const pool = isMongoDb() ? null : getPool();
  const { sql, counts, exportedAt, source } = await exportDatabaseSql(pool);

  const stamp = stampForFilename(new Date(exportedAt));
  const sqlEntryName = `portfolio_${stamp}.sql`;
  const zipName = `portfolio_${stamp}${ZIP_SUFFIX}`;
  const zipPath = path.join(dir, zipName);
  const zipBuffer = createSingleFileZip(sqlEntryName, sql);

  fs.writeFileSync(zipPath, zipBuffer);

  logger.info('SQL backup zip created', {
    zipName,
    sizeBytes: zipBuffer.length,
    source,
    tables: counts
  });

  return {
    filename: zipName,
    path: zipPath,
    sqlEntryName,
    sizeBytes: zipBuffer.length,
    exportedAt,
    source,
    counts,
    backupDir: dir
  };
}

/**
 * List local backup zips, newest first (by mtime).
 */
function listLocalBackupZips() {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter(isBackupZipName)
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      const st = fs.statSync(fullPath);
      return {
        filename,
        path: fullPath,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        mtime: st.mtime.toISOString()
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function getLatestLocalBackup() {
  const list = listLocalBackupZips();
  return list[0] || null;
}

function resolveLocalBackup(filename) {
  if (filename) {
    const base = path.basename(String(filename));
    if (!isBackupZipName(base)) {
      throw new Error(`Invalid backup filename (expected *${ZIP_SUFFIX}): ${base}`);
    }
    const fullPath = path.join(getBackupDir(), base);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Backup file not found: ${base}`);
    }
    const st = fs.statSync(fullPath);
    return {
      filename: base,
      path: fullPath,
      sizeBytes: st.size,
      mtimeMs: st.mtimeMs,
      mtime: st.mtime.toISOString()
    };
  }
  const latest = getLatestLocalBackup();
  if (!latest) {
    throw new Error('No local backup zip found. Call /api/create_backup first.');
  }
  return latest;
}

/**
 * Delete a local backup zip after successful Drive upload.
 * Only allows paths under BACKUP_DIR with *.sql.zip names.
 */
function deleteLocalBackup(localBackup) {
  if (!localBackup?.path || !localBackup?.filename) {
    return { deleted: false, reason: 'missing path' };
  }
  const base = path.basename(String(localBackup.filename));
  if (!isBackupZipName(base)) {
    return { deleted: false, reason: 'not a backup zip name' };
  }
  const expected = path.join(getBackupDir(), base);
  const resolved = path.resolve(localBackup.path);
  if (resolved !== path.resolve(expected)) {
    return { deleted: false, reason: 'path outside backup dir' };
  }
  if (!fs.existsSync(resolved)) {
    return { deleted: false, reason: 'already missing' };
  }
  fs.unlinkSync(resolved);
  logger.info('Deleted local backup zip after Drive upload', { filename: base });
  return { deleted: true, filename: base, path: resolved };
}

module.exports = {
  ZIP_SUFFIX,
  getBackupDir,
  ensureBackupDir,
  createSqlBackupZip,
  listLocalBackupZips,
  getLatestLocalBackup,
  resolveLocalBackup,
  deleteLocalBackup,
  isBackupZipName
};
