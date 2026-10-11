import { createRequestHandler } from "react-router";
import { api } from "../server/api";
import { isDemo, withApp } from "@noshen/engine/context";
import { sweep } from "@noshen/engine/sweep";

// Deal deadlines run as Cloudflare Workflows (see wrangler.jsonc).
export { DealTimers } from "@noshen/engine/timers";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

// Google Search Console ownership check for this address (needed for Google sign-in branding). Answered here,
// not as a file in public/, because static files ending in .html are redirected to the address without it.
const GOOGLE_SITE_VERIFICATION = "google246ad6ce9be68826.html";

/** The customer site: buying, selling and deals. Staff work happens on the separate staff site (apps/admin). */
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === `/${GOOGLE_SITE_VERIFICATION}`) {
      return new Response(`google-site-verification: ${GOOGLE_SITE_VERIFICATION}`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const res = pathname.startsWith("/api/") || pathname.startsWith("/photos/") ? await api.fetch(request, env, ctx) : await pages(request);
    if (!isDemo()) return res;
    // A demo with pretend payments stays out of search results, so nobody mistakes it for the real service.
    const out = new Response(res.body, res);
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    return out;
  },

  // Every 15 minutes: act on any deadline whose timer didn't fire (TRD: stuck-deal watch).
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp((d) => sweep(d)).then((done) => { if (done.length) console.log("sweep", done); }));
  },
} satisfies ExportedHandler<Env>;
