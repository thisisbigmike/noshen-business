import { createRequestHandler } from "react-router";
import { accessGate } from "../server/access";
import { api } from "../server/api";
import { withApp } from "@noshen/engine/context";
import { flushStaffAlerts } from "@noshen/engine/staff-alerts";

// Deadlines set by staff decisions run as this Worker's own Workflow (see wrangler.jsonc).
export { DealTimers } from "@noshen/engine/timers";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

/** Headers on every staff-site response: never framed by another site, never indexed, no referrer leaks. */
function harden(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("Referrer-Policy", "same-origin");
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}

/** The staff site. Every request passes the Cloudflare Access check first, then staff sign-in. */
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
    if (pathname.startsWith("/api/") || pathname.startsWith("/photos/")) return harden(await api.fetch(gate, env, ctx));
    return harden(await pages(gate));
  },

  // Once an hour: send any staff alert still waiting (alerts normally go at once; this catches any that couldn't).
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp((d) => flushStaffAlerts(d)).then((n) => { if (n) console.log("staff alerts sent", n); }));
  },
} satisfies ExportedHandler<Env>;
