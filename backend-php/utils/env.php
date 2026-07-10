<?php

/**
 * Read an environment variable from $_ENV, $_SERVER, or getenv().
 * Treats empty strings as unset so defaults apply (common on shared hosting).
 */
function app_env(string $key, ?string $default = null): ?string
{
    $candidates = [];

    if (array_key_exists($key, $_ENV)) {
        $candidates[] = $_ENV[$key];
    }
    if (array_key_exists($key, $_SERVER)) {
        $candidates[] = $_SERVER[$key];
    }

    $fromGetenv = getenv($key);
    if ($fromGetenv !== false) {
        $candidates[] = $fromGetenv;
    }

    foreach ($candidates as $value) {
        if ($value === null) {
            continue;
        }
        $str = trim((string) $value);
        if ($str !== '') {
            return $str;
        }
    }

    return $default;
}

function app_env_int(string $key, int $default): int
{
    $value = app_env($key);
    if ($value === null) {
        return $default;
    }
    $n = (int) $value;
    return $n > 0 ? $n : $default;
}

function app_env_bool(string $key, bool $default = false): bool
{
    $value = app_env($key);
    if ($value === null) {
        return $default;
    }
    return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
}

function app_load_dotenv(string $rootDir): ?string
{
    $paths = array_unique([
        $rootDir,
        dirname($rootDir),
        getcwd() ?: '',
    ]);

    foreach ($paths as $path) {
        if ($path === '' || !is_dir($path)) {
            continue;
        }
        $envFile = $path . DIRECTORY_SEPARATOR . '.env';
        if (!is_file($envFile)) {
            continue;
        }

        $dotenv = Dotenv\Dotenv::createImmutable($path);
        $dotenv->safeLoad();
        return $envFile;
    }

    return null;
}

/**
 * Detect Slim base path when the app is deployed in a subdirectory.
 * Example: URL /portfolio/api/categories/... with routes /api/categories/...
 *          → base path is /portfolio
 */
function app_detect_base_path(): string
{
    $configured = app_env('APP_BASE_PATH');
    if ($configured !== null) {
        $path = '/' . trim($configured, '/');
        return $path === '/' ? '' : $path;
    }

    $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/index.php');

    // /portfolio/api/public/index.php → /portfolio/api
    $apiMount = preg_replace('#/public/index\.php$#', '', $scriptName);
    $apiMount = preg_replace('#/index\.php$#', '', $apiMount);

    if ($apiMount === '' || $apiMount === '/') {
        return '';
    }

    $parent = dirname($apiMount);
    if ($parent === '/' || $parent === '.' || $parent === '\\') {
        return '';
    }

    return $parent;
}
