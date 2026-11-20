const LOCAL_API_DEFAULT = 'http://localhost:3000';

/** ng serve (and similar) is not the API — point at the Express backend instead. */
function isFrontendDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!/^localhost$|^127\.0\.0\.1$/i.test(url.hostname)) return false;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return port === '4200' || port === '4201' || port === '4300';
  } catch {
    return false;
  }
}

export function defaultApiDomain(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    if (isFrontendDevOrigin(window.location.origin)) {
      return LOCAL_API_DEFAULT;
    }
    return window.location.origin;
  }
  return LOCAL_API_DEFAULT;
}

export function normalizeApiDomain(domain: string): string {
  let normalized = domain.trim();
  if (!normalized) {
    return defaultApiDomain();
  }

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }

  normalized = normalized.replace(/\/+$/, '');
  // Stale save from when the login form defaulted to window.location.origin on ng serve.
  if (isFrontendDevOrigin(normalized)) {
    return LOCAL_API_DEFAULT;
  }
  return normalized;
}

export function getApiDomain(): string {
  const stored = localStorage.getItem('apiDomain');
  if (stored) {
    return normalizeApiDomain(stored);
  }
  return defaultApiDomain();
}

export function getApiBaseUrl(): string {
  return `${getApiDomain()}/api`;
}
