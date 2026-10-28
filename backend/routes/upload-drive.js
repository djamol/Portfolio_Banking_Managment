const express = require('express');
const {
  resolveLocalBackup,
  createSqlBackupZip,
  deleteLocalBackup
} = require('../utils/backup-sql');
const { uploadBackupAndPrune, driveConfig } = require('../utils/google-drive');

const router = express.Router();

/**
 * Unauthenticated (cron-style), same mount pattern as /api/cron_job.
 * GET|POST /api/upload_drive
 *   ?filename=portfolio_....sql.zip  — optional local file
 *   ?create=1                        — create a fresh backup first
 *
 * Uploads to Google Drive folder PORTFOLIO_BK/ and deletes older *.sql.zip
 * so only the latest GOOGLE_DRIVE_KEEP_BACKUPS (default 4) remain.
 * On successful upload, the local zip is removed from BACKUP_DIR.
 */
async function handleUploadDrive(req, res) {
  try {
    const createFirst =
      String(req.query.create || req.body?.create || '').toLowerCase() === '1' ||
      String(req.query.create || req.body?.create || '').toLowerCase() === 'true';

    let local;
    if (createFirst) {
      const created = await createSqlBackupZip();
      local = {
        filename: created.filename,
        path: created.path,
        sizeBytes: created.sizeBytes
      };
    } else {
      const filename = req.query.filename || req.body?.filename || null;
      local = resolveLocalBackup(filename);
    }

    const result = await uploadBackupAndPrune(local);
    const localCleanup = deleteLocalBackup(local);
    const cfg = driveConfig();

    res.json({
      success: true,
      data: {
        local: {
          filename: local.filename,
          path: local.path,
          sizeBytes: local.sizeBytes,
          deletedAfterUpload: !!localCleanup.deleted
        },
        drive: result,
        message:
          `Uploaded to ${result.uploaded.drivePath}; kept latest ${cfg.keepBackups} backup(s), ` +
          `deleted ${result.deleted.length} old Drive file(s)` +
          (localCleanup.deleted ? `; removed local ${local.filename}.` : '.')
      }
    });
  } catch (error) {
    console.error('Error uploading backup to Google Drive:', error);
    const status = /not configured/i.test(error.message) ? 503 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
}

router.get('/', handleUploadDrive);
router.post('/', handleUploadDrive);

module.exports = router;
