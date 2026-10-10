// Checks the token Cloudflare Access adds to every request it lets through to the staff site.
// Kept free of Worker imports so the tests can run it. See https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export interface AccessKey extends JsonWebKey { kid?: string }

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

/**
 * The email of the person Access signed in, or null if the token isn't a valid Access token for this
 * application: wrong signature, wrong application (aud), wrong team (iss), expired, or not yet valid.
 */
export async function verifyAccessJwt(token: string, o: { team: string; aud: string; keys: AccessKey[]; now?: number }): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }, payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  try { header = json(parts[0]); payload = json(parts[1]); } catch { return null; }
  if (header.alg !== "RS256") return null;
  const jwk = o.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(o.aud)) return null;
  if (payload.iss !== `https://${o.team}`) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  return typeof payload.email === "string" && payload.email ? payload.email.toLowerCase() : null;
}
