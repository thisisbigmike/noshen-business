import { createRequestHandler } from "react-router";
import { api } from "../server/api";
import { withApp } from "@noshen/engine/context";
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

/** Routes that belong to a signed-in person or an active deal: never indexed, never cached by shared proxies, no referrer leaks. */
function isPrivatePath(pathname: string): boolean {
  if (pathname === "/deals" || pathname === "/account" || pathname === "/sell" || pathname === "/signin" || pathname === "/signout" || pathname === "/notifications" || pathname === "/prefs" || pathname === "/waitlist") return true;
  if (pathname.startsWith("/d/") || pathname.startsWith("/account/") || pathname.startsWith("/sell/") || pathname.startsWith("/link/")) return true;
  if (/^\/l\/[^/]+\/buy\/?$/.test(pathname)) return true;
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/public/")) return true;
  return false;
}

/** Strict security headers on every customer-site response to protect buyers, sellers and their deal data. */
function harden(res: Response, pathname: string): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  out.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isPrivatePath(pathname)) {
    out.headers.set("Referrer-Policy", "no-referrer");
    out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    out.headers.set("Cache-Control", "private, no-store");
  } else {
    out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  return out;
}

/**
 * The visitor's country from Cloudflare, as a header the pages can read (the pay screen puts the ways to pay
 * that suit it first). Always set here, so a visitor can't send their own.
 */
function withCountry(request: Request) {
  const req = new Request(request);
  req.headers.set("x-noshen-country", String((request.cf as { country?: string } | undefined)?.country ?? ""));
  return req;
}

const isApiOrDiscovery = (pathname: string) =>
  pathname.startsWith("/api/") ||
  pathname.startsWith("/photos/") ||
  pathname.startsWith("/videos/") ||
  pathname === "/robots.txt" ||
  pathname === "/sitemap.xml" ||
  pathname === "/llms.txt" ||
  pathname === "/.well-known/ai-plugin.json";

/** The customer site: buying, selling and deals. Staff work happens on the separate staff site (apps/admin). */
export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === `/${GOOGLE_SITE_VERIFICATION}`) {
      return harden(new Response(`google-site-verification: ${GOOGLE_SITE_VERIFICATION}`, { headers: { "content-type": "text/html; charset=utf-8" } }), pathname);
    }
    const res = isApiOrDiscovery(pathname) ? await api.fetch(request, env, ctx) : await pages(withCountry(request));
    return harden(res, pathname);
  },

  // Every 15 minutes: act on any deadline whose timer didn't fire (TRD: stuck-deal watch).
  // Once an hour, a backstop: act on any passed deadline a timer missed, and read the chain for any payment the
  // booked checks missed. Not more often, so the database (which sleeps when idle) isn't kept awake all the time.
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(withApp(async (d) => {
      const done = await sweep(d);
      const chain = await watchCrypto(d);
      if (done.length || chain.payments || chain.settled) console.log("hourly", { done, chain });
    }));
  },
} satisfies ExportedHandler<Env>;
