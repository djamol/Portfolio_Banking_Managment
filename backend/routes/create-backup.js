const express = require('express');
const { createSqlBackupZip, listLocalBackupZips, getBackupDir } = require('../utils/backup-sql');

const router = express.Router();

/**
 * Unauthenticated (cron-style), same mount pattern as /api/cron_job.
 * GET|POST /api/create_backup — dump DB to SQL, zip as *.sql.zip under BACKUP_DIR.
 */
async function handleCreateBackup(req, res) {
  try {
    const data = await createSqlBackupZip();
    res.json({
      success: true,
      data: {
        filename: data.filename,
        path: data.path,
        sqlEntryName: data.sqlEntryName,
        sizeBytes: data.sizeBytes,
        exportedAt: data.exportedAt,
        source: data.source,
        counts: data.counts,
        backupDir: data.backupDir,
        driveHint: `Upload with /api/upload_drive → PORTFOLIO_BK/${data.filename}`
      }
    });
  } catch (error) {
    console.error('Error creating SQL backup zip:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

router.get('/', handleCreateBackup);
router.post('/', handleCreateBackup);

router.get('/list', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        backupDir: getBackupDir(),
        files: listLocalBackupZips()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
