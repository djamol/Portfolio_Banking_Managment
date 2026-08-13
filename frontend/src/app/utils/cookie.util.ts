/** Small helpers for non-HttpOnly browser cookies. */

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function setCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; path?: string; sameSite?: 'Lax' | 'Strict' | 'None' } = {}
): void {
  if (typeof document === 'undefined') return;
  const path = options.path ?? '/';
  const sameSite = options.sameSite ?? 'Lax';
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (options.maxAgeSeconds != null) {
    cookie += `; Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`;
  }
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    cookie += '; Secure';
  }
  document.cookie = cookie;
}

export function deleteCookie(name: string, path = '/'): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=${path}; Max-Age=0; SameSite=Lax`;
}
