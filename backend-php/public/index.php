<?php

declare(strict_types=1);

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require __DIR__ . '/../vendor/autoload.php';

$appStartTime = microtime(true);

set_exception_handler(function (Throwable $error) {
    logger_log_error('Uncaught exception', $error);
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Internal server error']);
    exit(1);
});

$port = app_env_int('PORT', 3000);
if ($port <= 0) {
    $port = 3000;
}
$host = app_env('HOST', '0.0.0.0');
$publicPath = dirname(__DIR__) . '/public';
$hasFrontend = is_file($publicPath . '/index.html');

logger_info('Portfolio app starting', [
    'phpVersion' => PHP_VERSION,
    'pid' => getmypid(),
    'cwd' => getcwd(),
    'host' => $host,
    'port' => $port,
    'nodeEnv' => app_env('NODE_ENV', 'development'),
    'dbType' => app_get_db_type(),
    'frontendBundled' => $hasFrontend,
    'publicPath' => $publicPath,
]);

logger_info('Initializing database before binding HTTP port', [
    'note' => 'Health checks will fail until database connection succeeds',
]);

static $appBootstrapped = false;
if (!$appBootstrapped) {
    try {
        app_initialize_database();
    } catch (Throwable $error) {
        logger_log_error('Application startup', $error, [
            'hint' => 'Container will exit because the app cannot start without a database connection',
        ]);
        exit(1);
    }
    $appBootstrapped = true;
}

$app = AppFactory::create();

$basePath = app_detect_base_path();
if ($basePath !== '') {
    $app->setBasePath($basePath);
    logger_info('Slim base path configured for subdirectory deployment', ['basePath' => $basePath]);
}

$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

$app->add(function (Request $request, $handler) {
    $response = $handler->handle($request);
    return $response
        ->withHeader('Access-Control-Allow-Origin', '*')
        ->withHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization')
        ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
});

$app->options('/{routes:.+}', function (Request $request, Response $response) {
    return $response;
});

$app->add(function (Request $request, $handler) {
    $started = microtime(true);
    $response = $handler->handle($request);
    $durationMs = (int) round((microtime(true) - $started) * 1000);
    $status = $response->getStatusCode();
    $level = $status >= 500 ? 'error' : ($status >= 400 ? 'warn' : 'info');
    logger_write($level, 'HTTP request', [
        'method' => $request->getMethod(),
        'path' => $request->getUri()->getPath(),
        'status' => $status,
        'durationMs' => $durationMs,
        'ip' => $request->getServerParams()['REMOTE_ADDR'] ?? null,
    ]);
    return $response;
});

$app->get('/api/health', function (Request $request, Response $response) use ($appStartTime) {
    $uptimeSeconds = (int) round(microtime(true) - $appStartTime);
    $payload = [
        'success' => true,
        'status' => 'ok',
        'dbType' => app_get_db_type(),
        'uptimeSeconds' => $uptimeSeconds,
        'timestamp' => gmdate('c'),
    ];
    $response->getBody()->write(json_encode($payload));
    return $response->withHeader('Content-Type', 'application/json');
});

require __DIR__ . '/../routes/investments.php';
require __DIR__ . '/../routes/analytics.php';
require __DIR__ . '/../routes/categories.php';
require __DIR__ . '/../routes/portfolio.php';

register_investment_routes($app);
register_analytics_routes($app);
register_category_routes($app);
register_portfolio_routes($app);

if ($hasFrontend) {
    logger_info('Serving bundled frontend from /public');
    $app->get('/{routes:.+}', function (Request $request, Response $response) use ($publicPath) {
        $path = $request->getUri()->getPath();
        if (str_starts_with($path, '/api')) {
            $response->getBody()->write(json_encode(['success' => false, 'error' => 'Not found']));
            return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
        }
        $file = $publicPath . $path;
        if ($path !== '/' && is_file($file)) {
            $response->getBody()->write((string) file_get_contents($file));
            return $response;
        }
        $response->getBody()->write((string) file_get_contents($publicPath . '/index.html'));
        return $response->withHeader('Content-Type', 'text/html');
    });
} else {
    logger_warn('Frontend bundle not found; API-only mode');
    $app->get('/', function (Request $request, Response $response) {
        $response->getBody()->write('Portfolio Management Backend API');
        return $response->withHeader('Content-Type', 'text/plain');
    });
}

$app->addErrorMiddleware(true, true, true);

static $serverReadyLogged = false;
if (!$serverReadyLogged) {
    logger_info('Server is ready', [
        'url' => "http://{$host}:{$port}",
        'healthCheck' => "http://{$host}:{$port}/api/health",
        'dbType' => app_get_db_type(),
    ]);
    $serverReadyLogged = true;
}

$app->run();
