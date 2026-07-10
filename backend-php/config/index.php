<?php

function app_get_db_type(): string
{
    $dbType = strtolower(app_env('DB_TYPE', 'mysql'));
    return $dbType === 'mongodb' ? 'mongodb' : 'mysql';
}

function app_is_mongodb(): bool
{
    return app_get_db_type() === 'mongodb';
}

function app_log_startup_config(): void
{
    $summary = [
        'dbType' => app_get_db_type(),
        'nodeEnv' => app_env('NODE_ENV', 'development'),
        'logLevel' => app_env('LOG_LEVEL', 'info'),
    ];

    if (app_is_mongodb()) {
        $summary = array_merge($summary, mongo_get_connection_summary());
    } else {
        $summary = array_merge($summary, mysql_get_connection_summary());
    }

    logger_info('Database backend selected', $summary);
}

function app_initialize_database(): void
{
    app_log_startup_config();
    if (app_is_mongodb()) {
        mongo_initialize_database();
        return;
    }
    mysql_initialize_database();
}

function app_get_pool(): PDO
{
    if (app_is_mongodb()) {
        throw new RuntimeException('app_get_pool() is only available when DB_TYPE=mysql');
    }
    return mysql_get_pool();
}

function app_get_mongo_db(): MongoDB\Database
{
    if (!app_is_mongodb()) {
        throw new RuntimeException('app_get_mongo_db() is only available when DB_TYPE=mongodb');
    }
    return mongo_get_db();
}
