import { createRequestHandler } from "react-router";
import { api } from "../server/api";
import { withApp } from "@noshen/engine/context";
import { sweep } from "@noshen/engine/sweep";

// Deal deadlines run as Cloudflare Workflows (see wrangler.jsonc).
export { DealTimers } from "@noshen/engine/timers";

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

/** The customer site: buying, selling and deals. Staff work happens on the separate staff site (apps/admin). */
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/photos/")) return api.fetch(request, env, ctx);
    return pages(request);
  },

  // Every 15 minutes: act on any deadline whose timer didn't fire (TRD: stuck-deal watch).
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp((d) => sweep(d)).then((done) => { if (done.length) console.log("sweep", done); }));
  },
} satisfies ExportedHandler<Env>;
