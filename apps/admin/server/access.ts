import { env } from "cloudflare:workers";
import { verifyAccessJwt, type AccessKey } from "./access-jwt";

/** Set by the gate below for the pages to read; any copy sent by the browser is removed first. */
export const ACCESS_EMAIL_HEADER = "x-noshen-access-email";

let keyCache: { team: string; at: number; keys: AccessKey[] } | null = null;
async function accessKeys(team: string): Promise<AccessKey[]> {
  if (keyCache && keyCache.team === team && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Couldn't load Cloudflare Access keys (${res.status})`);
  const keys = ((await res.json()) as { keys: AccessKey[] }).keys;
  keyCache = { team, at: Date.now(), keys };
  return keys;
}

const page = (status: number, title: string, text: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title><body style="font:16px/1.5 system-ui;max-width:560px;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${text}</p></body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/**
 * Lets a request through to the staff site only if Cloudflare Access did. Returns the request to serve
 * (with the Access email attached) or the refusal to send. Locally (http) Access isn't used; on a real
 * https address the site stays locked until ACCESS_TEAM_DOMAIN and ACCESS_AUD are set.
 */
export async function accessGate(request: Request): Promise<Request | Response> {
  const req = new Request(request);
  req.headers.delete(ACCESS_EMAIL_HEADER);
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud) {
    if (new URL(env.ADMIN_URL).protocol === "https:") {
      return page(503, "Staff site locked", "Cloudflare Access isn't set up for this site yet, so it refuses every request. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see the README) and deploy again.");
    }
    return req;
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  let email: string | null = null;
  if (token) {
    try { email = await verifyAccessJwt(token, { team, aud, keys: await accessKeys(team) }); } catch (e) { console.error("access check failed", e); }
  }
  if (!email) return page(403, "Not allowed", "This is NosHen's staff site. Sign in through Cloudflare Access with your NosHen work account.");
  req.headers.set(ACCESS_EMAIL_HEADER, email);
  return req;
}
