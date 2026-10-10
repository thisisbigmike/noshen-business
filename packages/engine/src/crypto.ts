// HMACs, field encryption and release codes, using Web Crypto (the same in Workers and Node).

const enc = new TextEncoder();

async function hmacKey(secret: string, hash: "SHA-256" | "SHA-512") {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
}

export async function hmac(secret: string, data: string, hash: "SHA-256" | "SHA-512" = "SHA-256"): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, hash), enc.encode(data)));
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Compares in constant time, so the time taken doesn't reveal how much matched. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Release codes are never stored. The code for a deal is derived from a server secret, so the
 * buyer's app can show it again, and the database keeps only an HMAC to check what the seller types.
 */
export async function releaseCodeFor(secret: string, dealId: string): Promise<string> {
  const h = await hmac(secret, `release-code:${dealId}`);
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

export const releaseCheck = (secret: string, dealId: string, code: string) => hmac(secret, `release-check:${dealId}:${code}`);

// Field encryption (AES-256-GCM) for bank account numbers. Stored as iv (12 bytes) + ciphertext.
async function aesKey(keyB64: string) {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length < 32) throw new Error("FIELD_KEY must be at least 32 random bytes, base64");
  return crypto.subtle.importKey("raw", raw.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptField(keyB64: string, text: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptField(keyB64: string, data: Uint8Array): Promise<string> {
  const iv = data.slice(0, 12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), data.slice(12));
  return new TextDecoder().decode(pt);
}

export const asBytes = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));

export function randomId(len = 10): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
