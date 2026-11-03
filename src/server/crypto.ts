const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export async function hashSecret(secret: string, customSaltHex?: string): Promise<string> {
  const enc = new TextEncoder();
  const saltBytes = customSaltHex
    ? hexToBytes(customSaltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(saltBytes);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LEN_BITS,
  );

  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2$${saltHex}$${hashHex}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, expectedHex] = parts;
  const computed = await hashSecret(secret, saltHex);
  const [, , actualHex] = computed.split('$');
  if (!actualHex || actualHex.length !== expectedHex.length) return false;
  // Constant-time string compare
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizeBirthDate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\//g, '-');
  if (/^\d{8}$/.test(trimmed)) {
    const y = trimmed.slice(0, 4);
    const m = trimmed.slice(4, 6);
    const d = trimmed.slice(6, 8);
    return validateDateParts(Number(y), Number(m), Number(d));
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (!m) return null;
  return validateDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validateDateParts(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

