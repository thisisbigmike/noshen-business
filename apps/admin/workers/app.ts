import { createRequestHandler } from "react-router";
import { accessGate } from "../server/access";
import { api } from "../server/api";

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
    const gate = await accessGate(request);
    if (gate instanceof Response) return harden(gate);
    const { pathname } = new URL(gate.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/photos/")) return harden(await api.fetch(gate, env, ctx));
    return harden(await pages(gate));
  },
} satisfies ExportedHandler<Env>;
