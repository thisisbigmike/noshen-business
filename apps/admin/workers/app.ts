import { createRequestHandler } from "react-router";
import { accessGate } from "../server/access";
import { api } from "../server/api";
import { withApp } from "@noshen/engine/context";
import { flushStaffAlerts } from "@noshen/engine/staff-alerts";

// Deadlines set by staff decisions run as this Worker's own Workflow (see wrangler.jsonc).
export { DealTimers } from "@noshen/engine/timers";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

/** Per-isolate rate limiter for staff sign-in attempts (15 POST requests/minute per IP). */
const authLimits = new Map<string, { count: number; resetAt: number }>();
function allowSignIn(request: Request): boolean {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  if (authLimits.size > 2000) {
    for (const [k, v] of authLimits) if (v.resetAt <= now) authLimits.delete(k);
  }
  const cur = authLimits.get(ip);
  if (!cur || cur.resetAt <= now) {
    authLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  cur.count += 1;
  return cur.count <= 15;
}

/** Headers on every staff-site response: never framed by another site, never indexed, never cached, no referrer leaks. */
function harden(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  out.headers.set("Referrer-Policy", "no-referrer");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  out.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "private, no-store");
  return out;
}

/** The staff site. Protected by staff-only sign-in + mandatory 2FA TOTP (and optional Cloudflare Access if configured). */
export default {
  async fetch(request, env, ctx) {
    // The customer site (through its service binding) asks for waiting staff alerts to be sent. It carries nothing
    // and returns nothing: the alerts are read from the database with this site's own login. Harmless to repeat.
    if (new URL(request.url).pathname === "/internal/staff-alerts/flush" && request.method === "POST") {
      ctx.waitUntil(withApp((d) => flushStaffAlerts(d)).catch((e) => console.error("staff alerts", e)));
      return new Response(null, { status: 202 });
    }
    const gate = await accessGate(request);
    if (gate instanceof Response) return harden(gate);
    const { pathname } = new URL(gate.url);
    if (gate.method === "POST" && (pathname === "/signin" || pathname.startsWith("/api/auth/")) && !allowSignIn(gate)) {
      return harden(new Response("Too many sign-in attempts. Please wait a minute and try again.", { status: 429, headers: { "content-type": "text/plain; charset=utf-8" } }));
    }
    if (pathname.startsWith("/api/") || pathname.startsWith("/photos/") || pathname.startsWith("/videos/")) return harden(await api.fetch(gate, env, ctx));
    return harden(await pages(gate));
  },

  // Once an hour: send any staff alert still waiting (alerts normally go at once; this catches any that couldn't).
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp((d) => flushStaffAlerts(d)).then((n) => { if (n) console.log("staff alerts sent", n); }));
  },
} satisfies ExportedHandler<Env>;
