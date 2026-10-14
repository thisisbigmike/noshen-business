import { createRequestHandler } from "react-router";
import { api } from "../server/api";
import { isDemo, withApp } from "@noshen/engine/context";
import { sweep } from "@noshen/engine/sweep";
import { watchCrypto } from "@noshen/engine/stablecoins";

// Deal deadlines run as Cloudflare Workflows (see wrangler.jsonc).
export { DealTimers } from "@noshen/engine/timers";
// Live deal rooms: a deal's open pages update the moment something happens (see deal-room.ts).
export { DealRoom } from "./deal-room";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

// Google Search Console ownership check for this address (needed for Google sign-in branding). Answered here,
// not as a file in public/, because static files ending in .html are redirected to the address without it.
const GOOGLE_SITE_VERIFICATION = "google246ad6ce9be68826.html";

/**
 * The visitor's country from Cloudflare, as a header the pages can read (the pay screen puts the ways to pay
 * that suit it first). Always set here, so a visitor can't send their own.
 */
function withCountry(request: Request) {
  const req = new Request(request);
  req.headers.set("x-noshen-country", String((request.cf as { country?: string } | undefined)?.country ?? ""));
  return req;
}

/** The customer site: buying, selling and deals. Staff work happens on the separate staff site (apps/admin). */
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === `/${GOOGLE_SITE_VERIFICATION}`) {
      return new Response(`google-site-verification: ${GOOGLE_SITE_VERIFICATION}`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const res = pathname.startsWith("/api/") || pathname.startsWith("/photos/") ? await api.fetch(request, env, ctx) : await pages(withCountry(request));
    if (!isDemo()) return res;
    // A demo with pretend payments stays out of search results, so nobody mistakes it for the real service.
    const out = new Response(res.body, res);
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    return out;
  },

  // Every 15 minutes: act on any deadline whose timer didn't fire (TRD: stuck-deal watch).
  async scheduled(event, _env, ctx) {
    // Every 15 minutes: act on passed deadlines. Every minute: read the chain for payments to deals' Solana addresses.
    if (event.cron === "*/15 * * * *") ctx.waitUntil(withApp((d) => sweep(d)).then((done) => { if (done.length) console.log("sweep", done); }));
    else ctx.waitUntil(withApp((d) => watchCrypto(d)).then((r) => { if (r.payments || r.settled) console.log("chain", r); }));
  },
} satisfies ExportedHandler<Env>;
