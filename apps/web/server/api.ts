import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { createAuth } from "./auth";
import { withApp, partnerFor, cryptoFor, walletsFor, mailFor, pushFor, isDev, isLocal } from "@noshen/engine/context";
import { pushToUser } from "@noshen/engine/core";
import { handlePartnerEvent } from "@noshen/engine/deals";
import { handleWalletEvent } from "@noshen/engine/wallets";
import { agentDeals, agentPerson, agentWallet, logAgentRequest, startAgentLink, unlinkChat, type AgentChannel } from "@noshen/engine/agent";
import { timingSafeEqual } from "@noshen/engine/crypto";
import type { Deps } from "@noshen/engine/core";
import type { WalletEvent } from "@noshen/engine/partner/blockradar";
import { sweep } from "@noshen/engine/sweep";
import { browse, dealView, dealsFor, listingView } from "@noshen/engine/queries";
import { checkSeller } from "@noshen/engine/handles";
import { DealError, settingsOf } from "@noshen/engine/core";
import { FakePartner } from "@noshen/engine/partner/fake";
import { FakeCryptoPartner } from "@noshen/engine/partner/fake-crypto";
import { koboForCoin, type Network } from "@noshen/shared/payments";
import { WebhookSignatureError, type PartnerEvent } from "@noshen/engine/partner/types";
import { optionalUser } from "./web";
import { servePhoto, serveVideo } from "@noshen/engine/photos";
import { many, one } from "@noshen/engine/db";
import { CATEGORIES, categoryOf, isCategory } from "@noshen/shared/categories";
import { CONDITIONS, firstName } from "@noshen/shared/deal";
import { isState, placeLabel } from "@noshen/shared/locations";
import { feeFor, naira } from "@noshen/shared/money";
import { photoUrl } from "@noshen/shared/photos";
import { profileUrl } from "@noshen/shared/social";
import { cryptoQuotes } from "@noshen/engine/stablecoins";

/**
 * Per-isolate sliding-window rate limiter by client IP and bucket.
 * Protects sign-in OTP endpoints and public agent discovery APIs from brute-force or scraping floods.
 */
const rateWindows = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, bucket: string, maxPerMinute: number): boolean {
  const now = Date.now();
  if (rateWindows.size > 5000) {
    for (const [k, v] of rateWindows) if (v.resetAt <= now) rateWindows.delete(k);
  }
  const key = `${bucket}:${ip}`;
  const cur = rateWindows.get(key);
  if (!cur || cur.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  cur.count += 1;
  return cur.count <= maxPerMinute;
}
const clientIp = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/**
 * The JSON API: sign-in (Better Auth), the partner's webhook, photos, public AI/agent discovery, and read endpoints.
 * The web pages call the same engine directly from their loaders and actions.
 */
export const api = new Hono();

api.on(["GET", "POST"], "/api/auth/*", async (c) => {
  if (c.req.method === "POST" && !checkRateLimit(clientIp(c), "auth", 25)) {
    return c.json({ error: "Too many sign-in attempts. Please wait a minute and try again." }, 429);
  }
  return (await createAuth(mailFor())).handler(c.req.raw);
});

// The partner's webhook: verify the signature first, store the event once, then process it.
api.post("/api/webhooks/partner", async (c) => {
  const raw = await c.req.text();
  let event: PartnerEvent;
  try {
    event = await partnerFor().verifyWebhook(raw, c.req.raw.headers);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return c.json({ error: "bad signature" }, 401);
    throw e;
  }
  const result = await withApp((d) => handlePartnerEvent(d, event));
  return c.json({ ok: true, result });
});

// The crypto partner's webhook (USDT received, refunds sent): its own signature, checked the same way.
api.post("/api/webhooks/crypto", async (c) => {
  const cx = cryptoFor();
  if (!cx) return c.notFound();
  const raw = await c.req.text();
  let event: PartnerEvent;
  try {
    event = await cx.verifyWebhook(raw, c.req.raw.headers);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return c.json({ error: "bad signature" }, 401);
    throw e;
  }
  const result = await withApp((d) => handlePartnerEvent(d, event, "crypto"));
  return c.json({ ok: true, result });
});

// The wallet provider's webhook (deposits into people's NosHen wallets, withdrawals sent or failed). Each master
// wallet signs with its own API key. It sends again until it gets a 200, so the same event may come more than once.
api.post("/api/webhooks/blockradar", async (c) => {
  const wallets = walletsFor();
  if (!wallets) return c.notFound();
  const raw = await c.req.text();
  let event: WalletEvent;
  try {
    event = await wallets.verifyWebhook(raw, c.req.header("x-blockradar-signature") ?? null);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return c.json({ error: "bad signature" }, 401);
    throw e;
  }
  const result = await withApp((d) => handleWalletEvent(d, event));
  return c.json({ ok: true, result });
});

// The NosHen assistant's API. The Telegram bot calls it with its own key, for the person whose chat it's in, and
// gets only what agent.ts allows: linking, and looking things up for a linked person. Every rule is checked there;
// the bot never reaches the database or the wallets itself.
const textBytes = (s: string) => new TextEncoder().encode(s);
api.use("/api/agent/*", async (c, next) => {
  const key = (env as unknown as Record<string, string | undefined>).AGENT_API_KEY;
  if (!key) return c.notFound();
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(textBytes(given), textBytes(key))) return c.json({ error: "Not allowed." }, 401);
  await next();
});
const agentRefusal = (e: unknown) => (e instanceof DealError ? { error: e.code, message: e.message, status: e.status } : null);
api.post("/api/agent/link", async (c) => {
  const b = await c.req.json<{ channel?: string; externalId?: string; externalName?: string }>().catch(() => ({}) as never);
  try {
    return c.json(await withApp((d) => startAgentLink(d, b?.channel as AgentChannel, String(b?.externalId ?? ""), b?.externalName ?? null)));
  } catch (e) {
    const r = agentRefusal(e);
    if (r) return c.json(r, 400);
    throw e;
  }
});
api.post("/api/agent/unlink", async (c) => {
  const b = await c.req.json<{ channel?: string; externalId?: string }>().catch(() => ({}) as never);
  try {
    return c.json({ unlinked: await withApp((d) => unlinkChat(d, b?.channel as AgentChannel, String(b?.externalId ?? ""))) });
  } catch (e) {
    const r = agentRefusal(e);
    if (r) return c.json(r, 400);
    throw e;
  }
});
/** Looks something up for the person linked to the chat in ?channel=&externalId=, if the assistant may act for them. */
function forLinkedPerson(action: string, look: (d: Deps, userId: string) => Promise<unknown>) {
  return async (c: any) => {
    try {
      return await withApp(async (d) => {
        const p = await agentPerson(d, c.req.query("channel") as AgentChannel, c.req.query("externalId") ?? "");
        if (!p) return c.json({ error: "not_linked", message: "This chat isn't linked to a NosHen account yet. Send /link to link it." }, 403);
        if (!p.allowed) {
          await logAgentRequest(d.db, p.linkId, action, false);
          return c.json({ error: "not_allowed", message: p.why }, 403);
        }
        const result = await look(d, p.userId);
        await logAgentRequest(d.db, p.linkId, action, true);
        return c.json({ name: p.name, ...(result as object) });
      });
    } catch (e) {
      const r = agentRefusal(e);
      if (r) return c.json(r, r.status === 503 ? 503 : 400);
      throw e;
    }
  };
}
api.get("/api/agent/me", forLinkedPerson("me", async () => ({ linked: true })));
api.get("/api/agent/wallet", forLinkedPerson("wallet", agentWallet));
api.get("/api/agent/deals", forLinkedPerson("deals", async (d, userId) => ({ deals: await agentDeals(d, userId) })));

// Phone and computer notifications: a device turns them on (or off) for the signed-in person. Only NosHen's own
// pages may call these (checked by Origin, on top of the sign-in cookie being same-site).
api.use("/api/push/*", async (c, next) => {
  if (c.req.header("origin") !== new URL(env.APP_URL).origin) return c.json({ error: "Not allowed." }, 403);
  await next();
});
// Phone and computer notifications: a device turns them on (or off) for the signed-in person.
api.post("/api/push/subscribe", async (c) => {
  const me = await optionalUser(c.req.raw);
  if (!me) return c.json({ error: "Sign in first." }, 401);
  if (!pushFor()) return c.json({ error: "Notifications aren't set up on this site yet." }, 503);
  const sub = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>().catch(() => ({}) as never);
  const ok = typeof sub?.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && /^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh ?? "") && /^[A-Za-z0-9_-]{16,32}$/.test(sub.keys?.auth ?? "");
  if (!ok) return c.json({ error: "That isn't a valid notification subscription." }, 400);
  // One device, one person: if someone else used this browser before, it now notifies whoever signed in.
  await withApp((d) => d.db.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       user_agent = excluded.user_agent, failures = 0`,
    [me.id, sub.endpoint, sub.keys!.p256dh, sub.keys!.auth, (c.req.header("user-agent") ?? "").slice(0, 300)]));
  return c.json({ ok: true });
});

api.post("/api/push/unsubscribe", async (c) => {
  const me = await optionalUser(c.req.raw);
  if (!me) return c.json({ error: "Sign in first." }, 401);
  const { endpoint } = await c.req.json<{ endpoint?: string }>().catch(() => ({}) as never);
  if (typeof endpoint === "string") await withApp((d) => d.db.query("delete from push_subscriptions where endpoint = $1 and user_id = $2", [endpoint, me.id]));
  return c.json({ ok: true });
});

/** Sends a test notification to the signed-in person's devices, so they can see it works. */
api.post("/api/push/test", async (c) => {
  const me = await optionalUser(c.req.raw);
  if (!me) return c.json({ error: "Sign in first." }, 401);
  const cfg = pushFor();
  if (!cfg) return c.json({ error: "Notifications aren't set up on this site yet." }, 503);
  await withApp((d) => pushToUser(d, cfg, me.id, { title: "NosHen test", body: "This is a test you asked for. Updates on your deals will look like this.", url: "/notifications", tag: "test" }));
  return c.json({ ok: true });
});

/**
 * A deal page's live connection: a WebSocket into the deal's room (workers/deal-room.ts). Only the deal's buyer
 * and seller, and only from NosHen's own pages.
 */
api.get("/api/deals/:id/live", async (c) => {
  if (c.req.header("upgrade") !== "websocket") return c.text("Expected a WebSocket", 426);
  if (c.req.header("origin") !== new URL(env.APP_URL).origin) return c.text("Not allowed", 403);
  const me = await optionalUser(c.req.raw);
  if (!me) return c.text("Sign in first", 401);
  const dealId = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/.test(dealId)) return c.text("Not found", 404);
  const deal = await withApp((d) => one<{ buyer_id: string; seller_id: string }>(d.db, "select buyer_id, seller_id from deals where id = $1", [dealId]));
  if (!deal || (deal.buyer_id !== me.id && deal.seller_id !== me.id)) return c.text("Not found", 404);
  const ns = (env as unknown as { DEAL_ROOMS: DurableObjectNamespace }).DEAL_ROOMS;
  return ns.get(ns.idFromName(dealId)).fetch("https://room/connect", {
    headers: { Upgrade: "websocket", "x-user": me.id, "x-role": deal.seller_id === me.id ? "seller" : "buyer" },
  });
});

api.get("/photos/*", (c) => servePhoto(decodeURIComponent(c.req.path.slice("/photos/".length)), c.req.query("size") === "small"));
api.get("/videos/*", (c) => serveVideo(c.req.raw, decodeURIComponent(c.req.path.slice("/videos/".length)),
  c.req.query("poster") ? "poster" : c.req.query("size") === "small" ? "small" : undefined));

api.get("/api/me", async (c) => {
  const u = await optionalUser(c.req.raw);
  return u ? c.json({ id: u.id, phone: u.phone, name: u.full_name }) : c.json({ error: "signed out" }, 401);
});

api.get("/api/deals", async (c) => {
  const u = await optionalUser(c.req.raw);
  if (!u) return c.json({ error: "signed out" }, 401);
  return c.json(await withApp((d) => dealsFor(d.db, u.id)));
});

api.get("/api/deals/:id", async (c) => {
  const u = await optionalUser(c.req.raw);
  if (!u) return c.json({ error: "signed out" }, 401);
  const v = await withApp((d) => dealView(d.db, c.req.param("id")));
  if (!v || (v.deal.buyer_id !== u.id && v.deal.seller_id !== u.id)) return c.json({ error: "not found" }, 404);
  const isBuyer = v.deal.buyer_id === u.id;
  const { deal, listing, payments, events, messages, dispute } = v;
  // Redact sender_name unless the signed-in caller is the buyer, and never expose collection account details to the seller.
  const safeDeal = {
    id: deal.id, listing_id: deal.listing_id, buyer_id: deal.buyer_id, seller_id: deal.seller_id,
    price_kobo: deal.price_kobo, fee_kobo: deal.fee_kobo, fee_payer: deal.fee_payer,
    amount_due_kobo: deal.amount_due_kobo, seller_share_kobo: deal.seller_share_kobo,
    handover: deal.handover, state: deal.state, kind: deal.kind, review_hold: deal.review_hold,
    request_expires_at: deal.request_expires_at, payment_due_at: deal.payment_due_at,
    handover_due_at: deal.handover_due_at, delivered_at: deal.delivered_at, release_due_at: deal.release_due_at,
    created_at: deal.created_at, updated_at: deal.updated_at, closed_at: deal.closed_at,
  };
  const safePayments = payments.map((p: any) => ({
    ...p,
    sender_name: isBuyer ? p.sender_name : undefined,
  }));
  return c.json({ deal: safeDeal, listing: { id: listing.id, title: listing.title }, payments: safePayments, events, messages, dispute });
});

// ---------------------------------------------------------------------------
// Search Engine, LLM & AI Agent Discovery (/robots.txt, /sitemap.xml, /llms.txt, /api/public/*)
// Strict security: read-only, rate-limited, public listings only, zero PII or IMEI/serial exposure.
// ---------------------------------------------------------------------------

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

api.get("/robots.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  const rules = [
    "Allow: /",
    "Allow: /browse",
    "Allow: /l/",
    "Allow: /s/",
    "Allow: /check",
    "Allow: /api/public/",
    "Allow: /llms.txt",
    "Allow: /sitemap.xml",
    "Disallow: /deals",
    "Disallow: /d/",
    "Disallow: /account",
    "Disallow: /sell",
    "Disallow: /link/",
    "Disallow: /signin",
    "Disallow: /signout",
    "Disallow: /notifications",
    "Disallow: /prefs",
    "Disallow: /waitlist",
    "Disallow: /l/*/buy",
    "Disallow: /api/auth/",
    "Disallow: /api/deals",
    "Disallow: /api/me",
    "Disallow: /api/push/",
    "Disallow: /api/webhooks/",
    "Disallow: /api/agent/",
    "Disallow: /api/dev/",
  ].join("\n");
  const bots = ["*", "Googlebot", "Google-Extended", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot", "ClaudeBot", "Claude-Web", "PerplexityBot", "Applebot-Extended"];
  const body = bots.map((b) => `User-agent: ${b}\n${rules}`).join("\n\n") + `\n\nSitemap: ${origin}/sitemap.xml\n`;
  return c.text(body, 200, { "Cache-Control": "public, max-age=3600" });
});

api.get("/sitemap.xml", async (c) => {
  if (!checkRateLimit(clientIp(c), "sitemap", 20)) return c.text("Too many requests", 429);
  const origin = new URL(c.req.url).origin;
  const { items, shops } = await withApp(async (d) => {
    const items = await many<{ id: string; updated_at: Date }>(
      d.db,
      `select l.id, l.updated_at from listings l join users u on u.id = l.seller_id
        where l.status = 'live' and l.visibility = 'public' and u.status = 'active'
        order by l.published_at desc limit 500`,
    );
    const shops = await many<{ seller_id: string; last_mod: Date }>(
      d.db,
      `select l.seller_id, max(l.updated_at) as last_mod from listings l join users u on u.id = l.seller_id
        where l.status = 'live' and l.visibility = 'public' and u.status = 'active'
        group by l.seller_id order by max(l.updated_at) desc limit 200`,
    );
    return { items, shops };
  });
  const staticPaths = ["/", "/browse", "/check", "/safety", "/terms", "/deal-terms", "/privacy", "/cookies", "/prohibited-items"];
  const catPaths = CATEGORIES.map((cat) => `/browse?cat=${encodeURIComponent(cat.key)}`);
  const urls = [
    ...staticPaths.map((p) => `<url><loc>${xmlEscape(`${origin}${p}`)}</loc><changefreq>daily</changefreq></url>`),
    ...catPaths.map((p) => `<url><loc>${xmlEscape(`${origin}${p}`)}</loc><changefreq>hourly</changefreq></url>`),
    ...items.map((x) => `<url><loc>${xmlEscape(`${origin}/l/${x.id}`)}</loc><lastmod>${new Date(x.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq></url>`),
    ...shops.map((s) => `<url><loc>${xmlEscape(`${origin}/s/${s.seller_id}`)}</loc><lastmod>${new Date(s.last_mod).toISOString()}</lastmod><changefreq>daily</changefreq></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
});

api.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  const md = `# NosHen — Escrow-Protected Commerce & Seller Verification

> Your money is held until you have the item. Across Nigeria (Naira bank transfer + USDT/USDC on Solana, Base, and BNB Smart Chain), with global stablecoin checkout from anywhere.

## Overview for AI Assistants (ChatGPT, Gemini, Claude, Perplexity) & Shopping Agents
NosHen protects online deals between strangers so neither the buyer nor the seller has to take the risk first:
1. **Buyer requests or opens a checkout link** and pays into NosHen (licensed partner bank in NGN or on-chain USDT/USDC on Solana, Base, or BNB Smart Chain).
2. **Money is held**: the seller sees the funds are held in NosHen, so there are no fake transfer alerts, and the seller cannot touch the money yet.
3. **Buyer checks the item**: at the meet-up or upon delivery (with built-in IMEI, serial number, and chassis/VIN checks).
4. **Release code or 72-hour human review**: if happy, the buyer gives their 6-digit release code (or confirms delivery) and the seller is paid within minutes. If something is wrong, the buyer reports a problem before releasing and a human reviewer decides within 72 hours.

## Public Web URLs
- Home & Fee Calculator: ${origin}/
- Browse & Search Listings: ${origin}/browse?q={query}&cat={category}&state={state}&min={min_naira}&max={max_naira}&verified={1_or_0}&sort={price_asc|price_desc}
- Listing Page: ${origin}/l/{listing_id}
- Protected Checkout Request: ${origin}/l/{listing_id}/buy
- Seller Shop & Track Record: ${origin}/s/{seller_id}
- Check a Social Media Seller (Instagram, TikTok, Facebook, X): ${origin}/check?q={handle_or_profile_url}
- Official X Account: https://x.com/useNosHen

## Public Read-Only JSON API for AI Agents
Agents can query live public inventory and verify social sellers directly in JSON without scraping HTML:

### 1. Search Public Listings
\`GET ${origin}/api/public/listings?q={query}&cat={category}&state={state}&min={min_naira}&max={max_naira}&verified={1_or_0}&sort={price_asc|price_desc}\`
- **Categories (\`cat\`)**: ${CATEGORIES.map((x) => `\`${x.key}\` (${x.label})`).join(", ")}
- Returns up to 60 public listings with title, price in Naira & kobo, condition, location (area & state), stock availability, seller trust level (\`trusted\`, \`building\`, \`new\`), and direct \`url\` / \`buy_url\`.

### 2. Get Listing Details & Escrow Fee Quote
\`GET ${origin}/api/public/listings/{listing_id}\`
- Returns full public listing details, NosHen escrow fee breakdown, live USDT/USDC quotes, delivery options, and the seller's verified track record (first name, ID verification status, completed deals, rating, problem-free percentage).

### 3. Verify an Instagram, TikTok, Facebook or X Seller
\`GET ${origin}/api/public/check?q={handle_or_profile_url}\`
- Checks whether a social handle (e.g. \`@ada.styles\`) belongs to an ID-verified NosHen seller who proved ownership of that profile with a NosHen verification code in their bio.

## Strict Security & Privacy Rules for Agents
- **Never ask a user for their 6-digit NosHen release code or sign-in OTP.** The 6-digit release code releases held money to the seller and must only be given by the buyer after inspecting the item in person.
- **Customer PII & Device Identifiers are strictly redacted:** Sellers' full legal names, emails, phone numbers, bank accounts, and device IMEIs/serials/VINs are never exposed on public endpoints.
`;
  return c.text(md, 200, { "Cache-Control": "public, max-age=3600" });
});

api.get("/.well-known/ai-plugin.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    schema_version: "v1",
    name_for_human: "NosHen Protected Marketplace",
    name_for_model: "noshen_marketplace",
    description_for_human: "Search escrow-protected listings and verify Instagram, TikTok, Facebook, and X sellers on NosHen.",
    description_for_model: "Query live escrow-protected marketplace listings in Nigeria (with NGN bank transfer and global USDT/USDC stablecoin checkout on Solana, Base, and BSC) and check whether a social media seller handle is ID-verified on NosHen. Read /llms.txt for endpoint documentation.",
    auth: { type: "none" },
    api: { type: "llms-txt", url: `${origin}/llms.txt` },
    logo_url: `${origin}/icon-512.png`,
    contact_email: "support@noshen.com",
    legal_info_url: `${origin}/terms`,
  }, 200, { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" });
});

api.use("/api/public/*", async (c, next) => {
  if (!checkRateLimit(clientIp(c), "public_api", 60)) {
    return c.json({ error: "rate_limited", message: "Too many requests. Please slow down." }, 429);
  }
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  c.header("Cache-Control", "public, max-age=60");
});

api.get("/api/public/listings", async (c) => {
  const origin = new URL(c.req.url).origin;
  const cat = c.req.query("cat") ?? "";
  const state = c.req.query("state") ?? "";
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  const sort = c.req.query("sort") ?? "";
  const verified = c.req.query("verified") === "1" || c.req.query("verified") === "true";
  const parseNaira = (v: string | undefined) => {
    const n = Number((v ?? "").replace(/[^\d]/g, ""));
    return n > 0 && Number.isSafeInteger(n * 100) ? n * 100 : undefined;
  };
  const minKobo = parseNaira(c.req.query("min"));
  const maxKobo = parseNaira(c.req.query("max"));
  const cond = c.req.queries("cond")?.filter((x) => CONDITIONS.some(([k]) => k === x)) ?? [];

  const rows = await withApp((d) => browse(d.db, {
    cat: isCategory(cat) ? cat : "",
    state: isState(state) ? state : "",
    q,
    sort,
    minKobo,
    maxKobo,
    conditions: cond,
    verifiedOnly: verified,
  }));

  return c.json({
    marketplace: "NosHen",
    escrow_protection: "Money is held by a licensed partner bank or on-chain escrow until the buyer inspects the item and releases it.",
    count: rows.length,
    listings: rows.map((l: any) => {
      const priceKobo = Number(l.price_kobo);
      const qty = Number(l.quantity ?? 1);
      const sold = Number(l.sold_count ?? 0);
      return {
        id: l.id,
        title: l.title,
        category: l.category,
        category_label: categoryOf(l.category).label,
        condition: l.condition,
        size: l.size ?? null,
        price_kobo: priceKobo,
        price_naira: priceKobo / 100,
        price_formatted: naira(priceKobo),
        currency: "NGN",
        area: l.area,
        state: l.state,
        location: placeLabel(l.area, l.state),
        status: l.status,
        available_quantity: l.status === "live" ? Math.max(0, qty - sold) : 0,
        published_at: l.published_at,
        photo_url: l.photo_keys?.[0] ? `${origin}${photoUrl(l.photo_keys[0])}` : null,
        url: `${origin}/l/${l.id}`,
        buy_url: l.status === "live" ? `${origin}/l/${l.id}/buy` : null,
        seller: {
          trust_level: l.seller.level,
          completed_deals: l.seller.deals,
        },
      };
    }),
  });
});

api.get("/api/public/listings/:id", async (c) => {
  const origin = new URL(c.req.url).origin;
  const id = c.req.param("id");
  return withApp(async (d) => {
    const v = await listingView(d.db, id);
    // Only public live or sold listings are accessible via the public discovery API; link-only listings stay private to people with the link.
    if (!v || v.listing.visibility !== "public" || !["live", "sold"].includes(v.listing.status)) {
      return c.json({ error: "not_found", message: "Listing not found." }, 404);
    }
    const l = v.listing;
    const s = await settingsOf(d);
    const priceKobo = Number(l.price_kobo);
    const feeKobo = feeFor(priceKobo, s.fee);
    const quotes = await cryptoQuotes(d, priceKobo + feeKobo).catch(() => null);
    const qty = Number(l.quantity ?? 1);
    const sold = Number(l.sold_count ?? 0);
    return c.json({
      id: l.id,
      title: l.title,
      description: l.description ?? null,
      category: l.category,
      category_label: categoryOf(l.category).label,
      condition: l.condition,
      size: l.size ?? null,
      price_kobo: priceKobo,
      price_naira: priceKobo / 100,
      price_formatted: naira(priceKobo),
      noshen_fee_kobo: feeKobo,
      noshen_fee_formatted: naira(feeKobo),
      total_buyer_pays_kobo: priceKobo + feeKobo,
      total_buyer_pays_formatted: naira(priceKobo + feeKobo),
      currency: "NGN",
      stablecoin_quotes: quotes ? {
        rate_formatted: naira(quotes.usdt.rateKobo),
        usdt_amount: (quotes.usdt.micro / 1_000_000).toFixed(2),
        usdc_amount: (quotes.usdc.micro / 1_000_000).toFixed(2),
        networks: ["solana", "base", "bsc"],
      } : null,
      area: l.area,
      state: l.state,
      location: placeLabel(l.area, l.state),
      delivery: {
        meetup_free: true,
        local_delivery_kobo: l.delivery_local_kobo !== null ? Number(l.delivery_local_kobo) : null,
        other_states_delivery_kobo: l.delivery_other_kobo !== null ? Number(l.delivery_other_kobo) : null,
      },
      has_verified_identifier_on_file: Boolean(l.imei_or_serial),
      status: l.status,
      available_quantity: l.status === "live" ? Math.max(0, qty - sold) : 0,
      published_at: l.published_at,
      photos: (l.photo_keys ?? []).map((k: string) => `${origin}${photoUrl(k)}`),
      url: `${origin}/l/${l.id}`,
      buy_url: l.status === "live" ? `${origin}/l/${l.id}/buy` : null,
      seller: {
        id: v.seller.id,
        first_name: firstName(v.seller.name),
        id_verified: v.seller.idVerified,
        completed_sales: v.seller.completedDeals,
        problem_free_percent: v.seller.problemFree,
        rating: v.seller.rating,
        rating_count: v.seller.ratingCount,
        shop_url: `${origin}/s/${v.seller.id}`,
      },
    });
  });
});

api.get("/api/public/check", async (c) => {
  const origin = new URL(c.req.url).origin;
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (!q) return c.json({ error: "missing_query", message: "Pass ?q=@handle or a profile URL." }, 400);
  const res = await withApp((d) => checkSeller(d.db, q));
  if (!res.query) return c.json({ valid_handle: false, verified: false, matches: [] });
  return c.json({
    valid_handle: true,
    query: res.query,
    verified: res.matches.length > 0,
    matches: res.matches.map((m) => ({
      platform: m.platform,
      handle: m.handle,
      profile_url: profileUrl(m.platform, m.handle),
      seller: {
        id: m.seller.id,
        first_name: firstName(m.seller.name),
        id_verified: m.seller.idVerified,
        completed_sales: m.seller.completedDeals,
        problem_free_percent: m.seller.problemFree,
        rating: m.seller.rating,
        rating_count: m.seller.ratingCount,
        shop_url: `${origin}/s/${m.seller.id}`,
      },
    })),
  });
});

// ---------------------------------------------------------------------------
// Development tools: only with the fake partner and same-origin requests.
// ---------------------------------------------------------------------------
api.use("/api/dev/*", async (c, next) => {
  if (!isDev()) return c.notFound();
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(env.APP_URL).origin) return c.json({ error: "Not allowed." }, 403);
  await next();
});

/**
 * Pretends to be the buyer's bank: sends a signed "money received" webhook for a deal. With pretend payments
 * (on this computer or the public demo), and only the signed-in buyer of that deal can use it.
 */
api.post("/api/dev/partner/transfer-in", async (c) => {
  if (!isDev()) return c.notFound();
  const me = await optionalUser(c.req.raw);
  if (!me) return c.json({ error: "Sign in first." }, 401);
  const { dealId, senderName, amountKobo } = await c.req.json<{ dealId: string; senderName?: string; amountKobo?: number }>();
  const deal = await withApp((d) => one(d.db,
    "select d.collection_ref, d.amount_due_kobo, d.buyer_id, u.full_name from deals d join users u on u.id = d.buyer_id where d.id = $1", [dealId]));
  if (!deal || deal.buyer_id !== me.id) return c.json({ error: "Only the buyer can pay into this deal." }, 403);
  if (!deal?.collection_ref) return c.json({ error: "This deal has no account to pay into yet." }, 400);
  const event: PartnerEvent = {
    id: `evt_${crypto.randomUUID()}`, type: "collection.received",
    data: {
      collection_ref: deal.collection_ref, amount_kobo: amountKobo ?? Number(deal.amount_due_kobo),
      sender_name: (senderName ?? deal.full_name ?? "BUYER").toUpperCase(), sender_bank_code: "058", sender_account: "0123456789",
      received_at: new Date().toISOString(),
    },
  };
  const partner = partnerFor() as FakePartner;
  const body = JSON.stringify(event);
  const res = await api.request("/api/webhooks/partner", { method: "POST", body, headers: { "x-fake-signature": await partner.sign(body) } }, env);
  return c.json(await res.json(), res.status as 200);
});

/**
 * Pretends to be the buyer's wallet: sends a signed "USDT or USDC received" webhook for a deal's address, with the exact
 * amount asked for, or too little. Pretend payments only, and only the signed-in buyer of that deal.
 */
api.post("/api/dev/crypto/send", async (c) => {
  if (!isDev()) return c.notFound();
  const me = await optionalUser(c.req.raw);
  if (!me) return c.json({ error: "Sign in first." }, 401);
  const { dealId, coin, network, short } = await c.req.json<{ dealId: string; coin: string; network: string; short?: boolean }>();
  const dep = await withApp((d) => one(d.db,
    `select c.*, x.buyer_id from crypto_deposits c join deals x on x.id = c.deal_id where c.deal_id = $1 and c.coin = $2 and c.network = $3`, [dealId, coin, network]));
  if (!dep || dep.buyer_id !== me.id) return c.json({ error: "Only the buyer can pay into this deal." }, 403);
  const quoted = Number(dep.amount_micro);
  const sent = short ? Math.floor((quoted * 0.9) / 10_000) * 10_000 : quoted;
  // On a network NosHen reads itself (Solana devnet), the demo wallet really pays: a transaction anyone can look up.
  const coins = cryptoFor();
  if (coins?.watches?.includes(network as Network) && coins.demoPay) {
    try {
      const tx = await coins.demoPay(network as Network, dep.provider_ref, sent);
      return c.json({ ok: true, tx, explorer: coins.explorer?.(network as Network, "tx", tx) ?? null });
    } catch (e) {
      console.error("demo wallet", e);
      return c.json({ error: "The Solana network didn't take the payment just now. Try again in a moment." }, 503);
    }
  }
  // The partner credits the deal its amount due if the right USDT came while the amount held; otherwise it converts at its rate.
  const inTime = new Date(dep.quote_expires_at) > new Date();
  const kobo = sent === quoted && inTime ? Number(dep.amount_kobo) : koboForCoin(sent, Number(dep.rate_kobo));
  const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
  const event: PartnerEvent = {
    id: `evt_${crypto.randomUUID()}`, type: "crypto.received",
    data: { deposit_ref: dep.provider_ref, coin: dep.coin, network: dep.network, amount_micro: sent, amount_kobo: kobo, tx_hash: network === "solana" ? `test${hex(40)}` : `0x${hex(32)}`, received_at: new Date().toISOString() },
  };
  const partner = ((coins as { fallback?: unknown }).fallback ?? coins) as FakeCryptoPartner;
  const body = JSON.stringify(event);
  const res = await api.request("/api/webhooks/crypto", { method: "POST", body, headers: { "x-fake-crypto-signature": await partner.sign(body) } }, env);
  return c.json(await res.json(), res.status as 200);
});

/** Runs the timer sweep now (it also runs every 15 minutes). Development server only. */
api.post("/api/dev/sweep", async (c) => {
  if (!isLocal()) return c.notFound();
  return c.json({ done: await withApp((d) => sweep(d)) });
});

api.onError((e, c) => {
  if (e instanceof DealError) return c.json({ error: e.message, code: e.code }, e.status as 400);
  console.error(e);
  return c.json({ error: "Something went wrong on our side." }, 500);
});
