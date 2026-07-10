<?php

const MONGO_EXPORT_COLLECTIONS = MONGO_COLLECTIONS;

function mongo_export_to_extended_json($value)
{
    if ($value === null) {
        return null;
    }
    if ($value instanceof DateTimeInterface) {
        return ['$date' => $value->format('c')];
    }
    if (is_array($value)) {
        $out = [];
        foreach ($value as $key => $val) {
            $out[$key] = mongo_export_to_extended_json($val);
        }
        return $out;
    }
    return $value;
}

function mongo_export_from_extended_json($value)
{
    if ($value === null) {
        return $value;
    }
    if (is_array($value) && !array_is_list($value) && isset($value['$date'])) {
        return new DateTime($value['$date']);
    }
    if (is_array($value)) {
        $out = [];
        foreach ($value as $key => $val) {
            $out[$key] = mongo_export_from_extended_json($val);
        }
        return $out;
    }
    return $value;
}

function mongo_export_fetch_mysql_collections(PDO $pool): array
{
    $collections = [];
    $counts = [];

    foreach (MONGO_EXPORT_COLLECTIONS as $name) {
        $stmt = $pool->query("SELECT * FROM `{$name}`");
        $rows = $stmt->fetchAll();
        $counts[$name] = count($rows);
        $collections[$name] = array_map('mongo_export_to_extended_json', $rows);
    }

    return ['collections' => $collections, 'counts' => $counts];
}

function mongo_export_fetch_mongo_collections(): array
{
    $collections = [];
    $counts = [];

    foreach (MONGO_EXPORT_COLLECTIONS as $name) {
        $rows = mongo_store_get_collection_data($name);
        $counts[$name] = count($rows);
        $collections[$name] = array_map('mongo_export_to_extended_json', $rows);
    }

    return ['collections' => $collections, 'counts' => $counts];
}

function mongo_export_database(): array
{
    $exportedAt = gmdate('c');
    $database = app_env('MONGODB_DB', app_env('DB_NAME', 'portfolio'));

    if (app_is_mongodb()) {
        $result = mongo_export_fetch_mongo_collections();
    } else {
        $result = mongo_export_fetch_mysql_collections(app_get_pool());
    }

    $payload = [
        'meta' => [
            'format' => 'portfolio-mongo-export',
            'version' => 1,
            'database' => $database,
            'dbType' => app_is_mongodb() ? 'mongodb' : 'mysql',
            'exportedAt' => $exportedAt,
        ],
        'collections' => $result['collections'],
    ];

    return [
        'json' => json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        'payload' => $payload,
        'counts' => $result['counts'],
        'exportedAt' => $exportedAt,
    ];
}
