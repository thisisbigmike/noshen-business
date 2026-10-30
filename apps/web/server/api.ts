import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { createAuth } from "./auth";
import { withApp, partnerFor, cryptoFor, walletsFor, mailFor, pushFor, isDev, isLocal } from "@noshen/engine/context";
import { pushToUser } from "@noshen/engine/core";
import { handlePartnerEvent } from "@noshen/engine/deals";
import { handleWalletEvent } from "@noshen/engine/wallets";
import type { WalletEvent } from "@noshen/engine/partner/blockradar";
import { sweep } from "@noshen/engine/sweep";
import { dealView, dealsFor } from "@noshen/engine/queries";
import { DealError } from "@noshen/engine/core";
import { FakePartner } from "@noshen/engine/partner/fake";
import { FakeCryptoPartner } from "@noshen/engine/partner/fake-crypto";
import { koboForCoin, type Network } from "@noshen/shared/payments";
import { WebhookSignatureError, type PartnerEvent } from "@noshen/engine/partner/types";
import { optionalUser } from "./web";
import { servePhoto } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";

/**
 * The JSON API: sign-in (Better Auth), the partner's webhook, photos, and read endpoints for
 * future native apps. The web pages call the same engine directly from their loaders and actions.
 */
export const api = new Hono();

api.on(["GET", "POST"], "/api/auth/*", async (c) => (await createAuth(mailFor())).handler(c.req.raw));

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
  const { deal, listing, payments, events, messages, dispute } = v;
  return c.json({ deal, listing: { id: listing.id, title: listing.title }, payments, events, messages, dispute });
});

// ---------------------------------------------------------------------------
// Development tools: only with the fake partner.
// ---------------------------------------------------------------------------

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
