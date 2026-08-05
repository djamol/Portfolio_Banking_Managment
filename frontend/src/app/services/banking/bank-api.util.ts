import { getApiBaseUrl } from '../../utils/api-url.util';

export function bankApiUrl(path = ''): string {
  const base = `${getApiBaseUrl()}/banking`;
  if (!path) return base;
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}
