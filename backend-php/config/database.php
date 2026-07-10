<?php

/** @var PDO|null */
$mysqlPool = null;

function mysql_get_db_config(): array
{
    return [
        'host' => app_env('DB_HOST', 'localhost'),
        'port' => app_env_int('DB_PORT', 3306),
        'user' => app_env('DB_USER', 'root'),
        'password' => app_env('DB_PASSWORD', ''),
        'database' => app_env('DB_NAME', 'portfolio'),
    ];
}

function mysql_should_create_database(): bool
{
    if (app_env_bool('DB_CREATE_DATABASE', false)) {
        return true;
    }
    // Docker/local dev convenience: auto-create only on typical local hosts
    $host = app_env('DB_HOST', 'localhost');
    return in_array($host, ['localhost', '127.0.0.1', 'db'], true);
}

function mysql_get_connection_summary(): array
{
    $dbConfig = mysql_get_db_config();
    return [
        'host' => $dbConfig['host'],
        'port' => $dbConfig['port'],
        'user' => $dbConfig['user'],
        'database' => $dbConfig['database'],
        'password' => logger_redact($dbConfig['password']),
    ];
}

function mysql_get_dsn(bool $includeDatabase = true): string
{
    $dbConfig = mysql_get_db_config();
    if ($includeDatabase) {
        return sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $dbConfig['host'],
            $dbConfig['port'],
            $dbConfig['database']
        );
    }
    return sprintf(
        'mysql:host=%s;port=%d;charset=utf8mb4',
        $dbConfig['host'],
        $dbConfig['port']
    );
}

function mysql_get_pool(): PDO
{
    global $mysqlPool;
    $dbConfig = mysql_get_db_config();

    if ($mysqlPool === null) {
        $mysqlPool = new PDO(
            mysql_get_dsn(),
            $dbConfig['user'],
            $dbConfig['password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    }

    return $mysqlPool;
}

function mysql_sleep(int $ms): void
{
    usleep($ms * 1000);
}

function mysql_create_tables(): void
{
    $pool = mysql_get_pool();
    logger_info('MySQL: creating tables if missing');

    $pool->exec("
        CREATE TABLE IF NOT EXISTS investments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            website_app_name VARCHAR(255) NOT NULL,
            investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
            sub_type_name VARCHAR(255),
            sub_type_category VARCHAR(255),
            amount DECIMAL(15, 2) NOT NULL,
            investment_date DATE NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_investment_type (investment_type),
            INDEX idx_investment_date (investment_date),
            INDEX idx_website_app (website_app_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pool->exec("
        CREATE TABLE IF NOT EXISTS investment_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            investment_id INT NOT NULL,
            amount DECIMAL(15, 2) NOT NULL,
            change_date DATE NOT NULL,
            change_type ENUM('added', 'removed', 'updated') NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE,
            INDEX idx_investment_id (investment_id),
            INDEX idx_change_date (change_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pool->exec("
        CREATE TABLE IF NOT EXISTS sub_type_names (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_investment_type (investment_type),
            INDEX idx_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pool->exec("
        CREATE TABLE IF NOT EXISTS sub_type_categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            category VARCHAR(255) NOT NULL,
            sub_type_name_id INT,
            investment_type ENUM('FD', 'Stock', 'ETF', 'Bond', 'Mutual Fund', 'Crypto', 'PPF', 'EPF', 'Saving Bank Balance') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sub_type_name_id) REFERENCES sub_type_names(id) ON DELETE SET NULL,
            INDEX idx_investment_type (investment_type),
            INDEX idx_sub_type_name_id (sub_type_name_id),
            UNIQUE KEY unique_category_subtype (category, sub_type_name_id, investment_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $pool->exec("
        CREATE TABLE IF NOT EXISTS investment_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            investment_id INT NOT NULL,
            txn_date DATE NOT NULL,
            txn_type ENUM(
                'buy', 'sell', 'dividend', 'interest', 'fee',
                'deposit', 'withdrawal', 'transfer_in', 'transfer_out'
            ) NOT NULL,
            units DECIMAL(20, 8) NULL,
            price DECIMAL(20, 8) NULL,
            cashflow_amount DECIMAL(15, 2) NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE,
            INDEX idx_txn_investment_id (investment_id),
            INDEX idx_txn_date (txn_date),
            INDEX idx_txn_type (txn_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    logger_info('MySQL: tables ready');
}

function mysql_initialize_database_once(): void
{
    $dbConfig = mysql_get_db_config();

    if (empty($dbConfig['database'])) {
        throw new RuntimeException('DB_NAME is not set. Add DB_NAME to your .env file (project root, parent of public/).');
    }

    logger_info('MySQL: connecting', mysql_get_connection_summary());

    if (mysql_should_create_database()) {
        $connection = new PDO(
            mysql_get_dsn(false),
            $dbConfig['user'],
            $dbConfig['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );

        logger_info('MySQL: server reachable, ensuring database exists', ['database' => $dbConfig['database']]);
        $dbName = $dbConfig['database'];
        $connection->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}`");
        $connection = null;
    }

    global $mysqlPool;
    $mysqlPool = null;
    mysql_get_pool();
    mysql_create_tables();
    logger_info('MySQL: initialization complete', mysql_get_connection_summary());
}

function mysql_initialize_database(): void
{
    $maxAttempts = app_env_int('DB_CONNECT_RETRIES', 15);
    $delayMs = app_env_int('DB_CONNECT_DELAY_MS', 2000);

    logger_info('MySQL: starting connection attempts', array_merge([
        'maxAttempts' => $maxAttempts,
        'delayMs' => $delayMs,
        'maxWaitSeconds' => (int) round(($maxAttempts * $delayMs) / 1000),
    ], mysql_get_connection_summary()));

    global $mysqlPool;

    for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
        try {
            mysql_initialize_database_once();
            return;
        } catch (Throwable $error) {
            logger_log_error("MySQL initialization attempt {$attempt}/{$maxAttempts}", $error, mysql_get_connection_summary());
            $mysqlPool = null;
            if ($attempt === $maxAttempts) {
                logger_error('MySQL: all connection attempts exhausted', [
                    'hint' => 'Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and that MySQL is running',
                ]);
                throw $error;
            }
            logger_warn('MySQL: retrying connection', ['attempt' => $attempt, 'nextRetryInMs' => $delayMs]);
            mysql_sleep($delayMs);
        }
    }
}

function mysql_ensure_tables_exist(): void
{
    global $mysqlPool;
    if ($mysqlPool === null) {
        mysql_get_pool();
    }
    mysql_create_tables();
}
