<?php

use MongoDB\Client;
use MongoDB\Database;

const MONGO_COLLECTIONS = [
    'sub_type_names',
    'sub_type_categories',
    'investments',
    'investment_history',
    'investment_transactions',
];

function mongo_get_config(): array
{
    return [
        'uri' => app_env('MONGODB_URI', 'mongodb://localhost:27017'),
        'database' => app_env('MONGODB_DB', app_env('DB_NAME', 'portfolio')),
    ];
}

/** @var Client|null */
$mongoClient = null;

/** @var Database|null */
$mongoDb = null;

function mongo_get_connection_summary(): array
{
    $mongoConfig = mongo_get_config();
    return [
        'uri' => logger_redact_uri($mongoConfig['uri']),
        'database' => $mongoConfig['database'],
    ];
}

function mongo_get_db(): Database
{
    global $mongoDb;
    if ($mongoDb === null) {
        throw new RuntimeException('MongoDB not initialized. Call mongo_initialize_database() first.');
    }
    return $mongoDb;
}

function mongo_get_client(): Client
{
    global $mongoClient;
    if ($mongoClient === null) {
        throw new RuntimeException('MongoDB not initialized. Call mongo_initialize_database() first.');
    }
    return $mongoClient;
}

function mongo_sleep(int $ms): void
{
    usleep($ms * 1000);
}

function mongo_ensure_indexes(Database $database): void
{
    logger_info('MongoDB: ensuring indexes');
    $indexSpecs = [
        ['collection' => 'investments', 'spec' => ['investment_date' => -1]],
        ['collection' => 'investments', 'spec' => ['investment_type' => 1]],
        ['collection' => 'investments', 'spec' => ['website_app_name' => 1]],
        ['collection' => 'investment_history', 'spec' => ['investment_id' => 1, 'change_date' => -1]],
        ['collection' => 'sub_type_names', 'spec' => ['name' => 1], 'options' => ['unique' => true]],
        [
            'collection' => 'sub_type_categories',
            'spec' => ['category' => 1, 'sub_type_name_id' => 1, 'investment_type' => 1],
            'options' => ['unique' => true],
        ],
    ];

    foreach ($indexSpecs as $item) {
        try {
            $database->selectCollection($item['collection'])->createIndex(
                $item['spec'],
                $item['options'] ?? []
            );
        } catch (MongoDB\Driver\Exception\RuntimeException $error) {
            $code = $error->getCode();
            if ($code === 85 || $code === 86) {
                logger_debug('MongoDB: index already exists', [
                    'collection' => $item['collection'],
                    'spec' => $item['spec'],
                ]);
                continue;
            }
            throw $error;
        }
    }
}

function mongo_initialize_database_once(): void
{
    global $mongoClient, $mongoDb;

    $mongoConfig = mongo_get_config();
    logger_info('MongoDB: connecting', mongo_get_connection_summary());

    $mongoClient = new Client($mongoConfig['uri'], [
        'serverSelectionTimeoutMS' => 10000,
        'connectTimeoutMS' => 10000,
    ]);

    $mongoDb = $mongoClient->selectDatabase($mongoConfig['database']);
    $mongoDb->command(['ping' => 1]);
    logger_info('MongoDB: ping successful', ['database' => $mongoConfig['database']]);

    mongo_ensure_indexes($mongoDb);
    logger_info('MongoDB: initialization complete', mongo_get_connection_summary());
}

function mongo_initialize_database(): void
{
    $maxAttempts = app_env_int('DB_CONNECT_RETRIES', 15);
    $delayMs = app_env_int('DB_CONNECT_DELAY_MS', 2000);

    logger_info('MongoDB: starting connection attempts', array_merge([
        'maxAttempts' => $maxAttempts,
        'delayMs' => $delayMs,
        'maxWaitSeconds' => (int) round(($maxAttempts * $delayMs) / 1000),
    ], mongo_get_connection_summary()));

    global $mongoClient, $mongoDb;

    for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
        try {
            mongo_initialize_database_once();
            return;
        } catch (Throwable $error) {
            logger_log_error("MongoDB initialization attempt {$attempt}/{$maxAttempts}", $error, mongo_get_connection_summary());
            $mongoClient = null;
            $mongoDb = null;
            if ($attempt === $maxAttempts) {
                logger_error('MongoDB: all connection attempts exhausted', [
                    'hint' => 'Check MONGODB_URI, MONGODB_DB and that MongoDB is running',
                ]);
                throw $error;
            }
            logger_warn('MongoDB: retrying connection', ['attempt' => $attempt, 'nextRetryInMs' => $delayMs]);
            mongo_sleep($delayMs);
        }
    }
}

function mongo_close_database(): void
{
    global $mongoClient, $mongoDb;
    $mongoClient = null;
    $mongoDb = null;
    logger_info('MongoDB: connection closed');
}
