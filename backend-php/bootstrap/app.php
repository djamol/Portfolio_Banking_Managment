<?php

/**
 * Application bootstrap — loads .env before config so DB_* variables are available.
 */

$appRootDir = dirname(__DIR__);

require_once $appRootDir . '/utils/env.php';

$loadedEnvFile = app_load_dotenv($appRootDir);

require_once $appRootDir . '/utils/logger.php';
require_once $appRootDir . '/utils/snapshot-queries.php';
require_once $appRootDir . '/config/database.php';
require_once $appRootDir . '/config/mongodb.php';
require_once $appRootDir . '/config/index.php';
require_once $appRootDir . '/db/mysql-store.php';
require_once $appRootDir . '/db/mongo-store.php';
require_once $appRootDir . '/db/index.php';
require_once $appRootDir . '/utils/mongo-analytics.php';
require_once $appRootDir . '/utils/sql-export.php';
require_once $appRootDir . '/utils/sql-import.php';
require_once $appRootDir . '/utils/mongo-export.php';
require_once $appRootDir . '/utils/mongo-import.php';

if ($loadedEnvFile) {
    logger_debug('Loaded environment file', ['path' => $loadedEnvFile]);
} else {
    logger_warn('No .env file found; using server environment variables and defaults', [
        'searchedRoot' => $appRootDir,
        'hint' => 'Create .env in the project root (parent of public/) with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME',
    ]);
}
