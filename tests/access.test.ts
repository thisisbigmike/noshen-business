import { beforeAll, describe, expect, it } from "vitest";
import { verifyAccessJwt, type AccessKey } from "../apps/admin/server/access-jwt";

// A stand-in for Cloudflare Access: our own signing key and tokens shaped like Access's.
const team = "noshen.cloudflareaccess.com";
const aud = "a1b2c3staffsiteaud";
let keys: AccessKey[];
let sign: (payload: object, header?: object) => Promise<string>;

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  keys = [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key-1" }];
  sign = async (payload, header = { alg: "RS256", kid: "key-1", typ: "JWT" }) => {
    const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)));
    return `${body}.${b64url(sig)}`;
  };
});

const now = Math.floor(Date.now() / 1000);
const good = () => ({ aud: [aud], iss: `https://${team}`, email: "Tobi@NosHen.ng", exp: now + 600, iat: now, nbf: now });

describe("staff site: Cloudflare Access check", () => {
  it("lets through a valid token and returns the person's email", async () => {
    expect(await verifyAccessJwt(await sign(good()), { team, aud, keys })).toBe("tobi@noshen.ng");
  });

  it("refuses tokens for another application, another team, or that have expired", async () => {
    expect(await verifyAccessJwt(await sign({ ...good(), aud: ["some-other-app"] }), { team, aud, keys })).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good(), iss: "https://attacker.cloudflareaccess.com" }), { team, aud, keys })).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...good(), exp: now - 1 }), { team, aud, keys })).toBeNull();
  });

  it("refuses a changed token, an unknown key, a non-RS256 token, and one without an email", async () => {
    const t = await sign(good());
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...good(), email: "attacker@example.com" }))}.${s}`;
    expect(await verifyAccessJwt(forged, { team, aud, keys })).toBeNull();
    expect(await verifyAccessJwt(await sign(good(), { alg: "RS256", kid: "key-2" }), { team, aud, keys })).toBeNull();
    expect(await verifyAccessJwt(await sign(good(), { alg: "none", kid: "key-1" }), { team, aud, keys })).toBeNull();
    const { email: _, ...noEmail } = good();
    expect(await verifyAccessJwt(await sign(noEmail), { team, aud, keys })).toBeNull();
    expect(await verifyAccessJwt("not-a-token", { team, aud, keys })).toBeNull();
  });
});
