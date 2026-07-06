const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const levelName = (process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LEVELS[levelName] ?? LEVELS.info;

function format(level, message, meta) {
  const ts = new Date().toISOString();
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${suffix}`;
}

function write(level, message, meta) {
  if (LEVELS[level] < minLevel) return;
  const line = format(level, message, meta);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function redact(value) {
  if (value === undefined || value === null || value === '') return '(not set)';
  const str = String(value);
  if (str.length <= 2) return '***';
  return `${str.slice(0, 2)}***(${str.length} chars)`;
}

function redactUri(uri) {
  if (!uri) return '(not set)';
  return String(uri).replace(/:([^:@/]+)@/, ':***@');
}

function logError(context, error, extra = {}) {
  const meta = {
    context,
    message: error?.message || String(error),
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    address: error?.address,
    port: error?.port,
    ...extra
  };

  if (levelName === 'debug' && error?.stack) {
    meta.stack = error.stack;
  }

  write('error', `${context} failed`, meta);
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  logError,
  redact,
  redactUri
};
