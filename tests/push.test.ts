import { afterEach, describe, expect, it, vi } from "vitest";
import { b64u, encryptForDevice, newVapidKeys, sendPush } from "@noshen/engine/push";

// RFC 8291, section 5: the worked example of encrypting a push message.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function keyPair(priv: string, pub: string): Promise<CryptoKeyPair> {
  const raw = b64u.decode(pub);
  const jwk = { kty: "EC", crv: "P-256", d: priv, x: b64u.encode(raw.slice(1, 33)), y: b64u.encode(raw.slice(33, 65)) };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return { privateKey, publicKey };
}

describe("phone notifications (Web Push)", () => {
  it("encrypts exactly as the standard's worked example", async () => {
    const out = await encryptForDevice(new Uint8Array(new TextEncoder().encode(RFC.plaintext)), b64u.decode(RFC.uaPublic), b64u.decode(RFC.auth),
      await keyPair(RFC.asPrivate, RFC.asPublic), b64u.decode(RFC.salt));
    expect(b64u.encode(out)).toBe(RFC.body);
  });

  it("makes VAPID keys a browser accepts: a 65-byte public key and a private key that signs", async () => {
    const k = await newVapidKeys();
    expect(b64u.decode(k.publicKey)).toHaveLength(65);
    const key = await crypto.subtle.importKey("jwk", JSON.parse(k.privateJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode("x"));
    expect(new Uint8Array(sig)).toHaveLength(64); // r || s, as a VAPID token needs
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends a message only that device can read, signed so the push service knows it's from NosHen", async () => {
    // The device: its own key pair and secret, as a browser makes them when notifications are turned on.
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const vapid = await newVapidKeys();
    let seen: { url: string; headers: Record<string, string>; body: Uint8Array } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: new Uint8Array(init.body as ArrayBuffer) };
      return new Response(null, { status: 201 });
    });
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) };
    const msg = { title: "NosHen", body: "₦310,000 is held safely.", url: "/d/1", tag: "deal-1" };
    expect(await sendPush({ publicKey: vapid.publicKey, privateJwk: vapid.privateJwk, subject: "https://noshen.example" }, sub, msg)).toBe("sent");
    const got = seen!;
    expect(got.headers["Content-Encoding"]).toBe("aes128gcm");

    // The push service checks the signed token against our public key, and that it's for its own address.
    const [scheme, rest] = got.headers.Authorization.split(" ", 2);
    expect(scheme).toBe("vapid");
    const t = /t=([^,]+)/.exec(got.headers.Authorization)![1];
    expect(/k=([A-Za-z0-9_-]+)/.exec(rest + got.headers.Authorization)![1]).toBe(vapid.publicKey);
    const [h, c, sig] = t.split(".");
    const pub = await crypto.subtle.importKey("raw", b64u.decode(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64u.decode(sig), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(b64u.decode(c)))).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://noshen.example" });

    // The device decrypts it with its own keys (RFC 8291) and finds the message.
    const body = got.body;
    const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPublic as Uint8Array<ArrayBuffer>, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
    const B = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;
    const hk = async (s: Uint8Array, k: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: B(s), info: B(info) }, await crypto.subtle.importKey("raw", B(k), "HKDF", false, ["deriveBits"]), n * 8));
    const te = new TextEncoder();
    const join = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
    const ikm = await hk(auth, ecdh, join(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
    const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: B(nonce) }, await crypto.subtle.importKey("raw", B(cek), "AES-GCM", false, ["decrypt"]), B(cipher)));
    expect(plain[plain.length - 1]).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))).toEqual(msg);
  });

  it("knows when a device has turned notifications off", async () => {
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const vapid = await newVapidKeys();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 410 }));
    const sub = { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x", p256dh: b64u.encode(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))), auth: b64u.encode(new Uint8Array(16)) };
    expect(await sendPush({ ...vapid, subject: "https://noshen.example" }, sub, { title: "t", body: "b" })).toBe("gone");
  });
});
