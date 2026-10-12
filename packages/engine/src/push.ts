// Notifications on people's phones and computers (Web Push), sent straight from the Worker with WebCrypto.
//
// Each device that turns notifications on gives us a subscription: an endpoint at its push service (Google's
// for Chrome and Android, Apple's for Safari and iPhone, Mozilla's for Firefox) and two keys. We encrypt each
// message for that device alone (RFC 8291, "aes128gcm"), and sign a short token proving it's from NosHen
// (VAPID, RFC 8292). The push service can't read the message; it only delivers it.

export interface PushSubscriptionKeys { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; url?: string; tag?: string }

export interface PushConfig {
  /** The application server's public key: 65 bytes, uncompressed P-256, base64url. Browsers subscribe with it. */
  publicKey: string;
  /** The matching private key as a JWK (JSON). A secret. */
  privateJwk: string;
  /** Who to contact about our pushes: a mailto: or https: address. */
  subject: string;
}

export type PushResult = "sent" | "gone" | "failed";

const enc = new TextEncoder();
/** Bytes backed by an ordinary ArrayBuffer, as WebCrypto wants them. */
type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (text: string): Bytes => new Uint8Array(enc.encode(text));

export const b64u = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Bytes {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * Encrypts a message for one device (RFC 8291 with RFC 8188's aes128gcm). `ephemeral` and `salt` are fresh each
 * time; they can be given only so the RFC's worked example can be checked in tests.
 */
export async function encryptForDevice(payload: Bytes, uaPublic: Bytes, authSecret: Bytes,
  ephemeral?: CryptoKeyPair, saltIn?: Bytes): Promise<Bytes> {
  const as = ephemeral ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const ua = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = saltIn ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the message, then the 0x02 delimiter that marks the last record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** The VAPID header: a token signed with our key, valid for 12 hours, for one push service. */
async function vapidHeader(endpoint: string, cfg: PushConfig) {
  const aud = new URL(endpoint).origin;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: cfg.subject })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(cfg.privateJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${cfg.publicKey}`;
}

/** Sends one message to one device. "gone" means the device turned notifications off: forget the subscription. */
export async function sendPush(cfg: PushConfig, sub: PushSubscriptionKeys, msg: PushMessage): Promise<PushResult> {
  const body = await encryptForDevice(utf8(JSON.stringify(msg)), b64u.decode(sub.p256dh), b64u.decode(sub.auth));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, cfg),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "high",
      ...(msg.tag ? { Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  return res.ok ? "sent" : "failed";
}

/** A new key pair for VAPID, in the forms the config wants. Run once per site (see scripts/vapid-keys.mjs). */
export async function newVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return {
    publicKey: b64u.encode(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  };
}
