const fs = require('fs');
const logger = require('./logger');
const { isBackupZipName } = require('./backup-sql');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

function driveConfig() {
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const folderName = String(process.env.GOOGLE_DRIVE_BACKUP_FOLDER || 'PORTFOLIO_BK').trim() || 'PORTFOLIO_BK';
  const keepRaw = Number(process.env.GOOGLE_DRIVE_KEEP_BACKUPS);
  const keepBackups = Number.isFinite(keepRaw) && keepRaw > 0 ? Math.floor(keepRaw) : 4;

  return { clientId, clientSecret, refreshToken, folderId, folderName, keepBackups };
}

function assertDriveConfigured(cfg = driveConfig()) {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error(
      'Google Drive is not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.'
    );
  }
  return cfg;
}

async function getAccessToken(cfg = assertDriveConfigured()) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || res.statusText;
    throw new Error(`Google OAuth token refresh failed: ${detail}`);
  }
  return data.access_token;
}

async function driveFetch(accessToken, url, options = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  if (!res.ok) {
    const detail = json?.error?.message || json?.error || text || res.statusText;
    throw new Error(`Google Drive API error (${res.status}): ${detail}`);
  }
  return json;
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Resolve PORTFOLIO_BK folder id (env override or find/create by name under My Drive root).
 */
async function resolveBackupFolderId(accessToken, cfg = assertDriveConfigured()) {
  if (cfg.folderId) {
    return cfg.folderId;
  }

  const q = [
    `name = '${escapeDriveQueryValue(cfg.folderName)}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `'root' in parents`,
    'trashed = false'
  ].join(' and ');

  const listed = await driveFetch(
    accessToken,
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)&pageSize=5`
  );

  if (listed.files && listed.files.length > 0) {
    return listed.files[0].id;
  }

  const created = await driveFetch(accessToken, `${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: cfg.folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root']
    })
  });

  logger.info('Created Google Drive backup folder', { folderName: cfg.folderName, id: created.id });
  return created.id;
}

/**
 * List backup zip files in the Drive folder, newest first.
 */
async function listDriveBackupFiles(accessToken, folderId) {
  const q = [
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    'trashed = false'
  ].join(' and ');

  const files = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      q,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,size)',
      orderBy: 'createdTime desc',
      pageSize: '100'
    });
    if (pageToken) params.set('pageToken', pageToken);

    const page = await driveFetch(accessToken, `${DRIVE_API}/files?${params}`);
    for (const f of page.files || []) {
      if (isBackupZipName(f.name)) {
        files.push(f);
      }
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  files.sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  return files;
}

async function uploadFileToFolder(accessToken, folderId, localPath, filename) {
  const fileBuf = fs.readFileSync(localPath);
  const metadata = {
    name: filename,
    parents: [folderId]
  };

  const boundary = `portfolio_backup_${Date.now()}`;
  const metaPart =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n`;
  const fileHeader =
    `--${boundary}\r\n` +
    'Content-Type: application/zip\r\n\r\n';
  const closing = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    Buffer.from(fileHeader, 'utf8'),
    fileBuf,
    Buffer.from(closing, 'utf8')
  ]);

  const uploaded = await driveFetch(
    accessToken,
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size,webViewLink`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    }
  );

  return uploaded;
}

async function deleteDriveFile(accessToken, fileId) {
  await driveFetch(accessToken, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  });
}

/**
 * Upload local backup zip to PORTFOLIO_BK and delete older backups beyond keep count.
 */
async function uploadBackupAndPrune(localBackup) {
  const cfg = assertDriveConfigured();
  const accessToken = await getAccessToken(cfg);
  const folderId = await resolveBackupFolderId(accessToken, cfg);

  const uploaded = await uploadFileToFolder(
    accessToken,
    folderId,
    localBackup.path,
    localBackup.filename
  );

  logger.info('Uploaded backup to Google Drive', {
    folder: cfg.folderName,
    folderId,
    fileId: uploaded.id,
    name: uploaded.name
  });

  const all = await listDriveBackupFiles(accessToken, folderId);
  const keep = cfg.keepBackups;
  const toDelete = all.slice(keep);
  const deleted = [];

  for (const file of toDelete) {
    try {
      await deleteDriveFile(accessToken, file.id);
      deleted.push({ id: file.id, name: file.name, createdTime: file.createdTime });
      logger.info('Deleted old Google Drive backup', { id: file.id, name: file.name });
    } catch (err) {
      logger.warn('Failed to delete old Google Drive backup', {
        id: file.id,
        name: file.name,
        error: err.message
      });
    }
  }

  const remaining = all.slice(0, keep).map((f) => ({
    id: f.id,
    name: f.name,
    createdTime: f.createdTime,
    size: f.size
  }));

  return {
    folderName: cfg.folderName,
    folderId,
    keepBackups: keep,
    uploaded: {
      id: uploaded.id,
      name: uploaded.name,
      createdTime: uploaded.createdTime,
      size: uploaded.size,
      webViewLink: uploaded.webViewLink || null,
      drivePath: `${cfg.folderName}/${uploaded.name}`
    },
    remaining,
    deleted
  };
}

module.exports = {
  driveConfig,
  assertDriveConfigured,
  getAccessToken,
  resolveBackupFolderId,
  listDriveBackupFiles,
  uploadBackupAndPrune
};
