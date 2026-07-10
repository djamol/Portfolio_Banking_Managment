<?php

function logger_levels(): array
{
    return ['debug' => 0, 'info' => 1, 'warn' => 2, 'error' => 3];
}

function logger_min_level(): int
{
    $levelName = strtolower(app_env('LOG_LEVEL', 'info'));
    $levels = logger_levels();
    return $levels[$levelName] ?? $levels['info'];
}

function logger_format(string $level, string $message, ?array $meta = null): string
{
    $ts = gmdate('c');
    $suffix = ($meta && count($meta)) ? ' ' . json_encode($meta) : '';
    return "[{$ts}] [" . strtoupper($level) . "] {$message}{$suffix}";
}

function logger_write(string $level, string $message, ?array $meta = null): void
{
    $levels = logger_levels();
    if (($levels[$level] ?? 99) < logger_min_level()) {
        return;
    }
    $line = logger_format($level, $message, $meta);
    if ($level === 'error') {
        fwrite(STDERR, $line . PHP_EOL);
    } else {
        echo $line . PHP_EOL;
    }
}

function logger_redact($value): string
{
    if ($value === null || $value === '') {
        return '(not set)';
    }
    $str = (string) $value;
    if (strlen($str) <= 2) {
        return '***';
    }
    return substr($str, 0, 2) . '***(' . strlen($str) . ' chars)';
}

function logger_redact_uri(?string $uri): string
{
    if (!$uri) {
        return '(not set)';
    }
    return preg_replace('/:([^:@\/]+)@/', ':***@', $uri);
}

function logger_log_error(string $context, Throwable $error, array $extra = []): void
{
    $meta = array_merge([
        'context' => $context,
        'message' => $error->getMessage(),
        'code' => $error->getCode(),
    ], $extra);

    $levelName = strtolower(app_env('LOG_LEVEL', 'info'));
    if ($levelName === 'debug') {
        $meta['stack'] = $error->getTraceAsString();
    }

    logger_write('error', "{$context} failed", $meta);
}

function logger_debug(string $message, ?array $meta = null): void
{
    logger_write('debug', $message, $meta);
}

function logger_info(string $message, ?array $meta = null): void
{
    logger_write('info', $message, $meta);
}

function logger_warn(string $message, ?array $meta = null): void
{
    logger_write('warn', $message, $meta);
}

function logger_error(string $message, ?array $meta = null): void
{
    logger_write('error', $message, $meta);
}
