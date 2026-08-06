/**
 * Obfuscates sensitive browser storage (AES-GCM via Web Crypto).
 * Not a substitute for server-side secrets — anyone with the bundle can reverse it,
 * but it stops casual localStorage inspection of DB credentials.
 */

const PREFIX = 'enc:v1:';
const KEY_MATERIAL = 'portfolio-db-custom-config-v1';
const SALT = new TextEncoder().encode('portfolio-storage-salt-v1');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getAesKey(): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(KEY_MATERIAL),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(value: unknown): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return PREFIX + bytesToBase64(combined);
}

export async function decryptJson<T = unknown>(raw: string): Promise<T | null> {
  if (!raw) return null;

  // Legacy plaintext JSON — migrate on next write
  if (!raw.startsWith(PREFIX)) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  try {
    const key = await getAesKey();
    const combined = base64ToBytes(raw.slice(PREFIX.length));
    if (combined.length < 13) return null;
    const iv = combined.slice(0, 12);
    const cipher = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
  } catch {
    return null;
  }
}

export function isEncryptedStorageValue(raw: string | null): boolean {
  return !!raw && raw.startsWith(PREFIX);
}
