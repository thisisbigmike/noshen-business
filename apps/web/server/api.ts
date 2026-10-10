import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { createAuth } from "./auth";
import { withApp, partnerFor, mailFor, isDev, isLocal } from "@noshen/engine/context";
import { handlePartnerEvent } from "@noshen/engine/deals";
import { sweep } from "@noshen/engine/sweep";
import { dealView, dealsFor } from "@noshen/engine/queries";
import { DealError } from "@noshen/engine/core";
import { FakePartner } from "@noshen/engine/partner/fake";
import { WebhookSignatureError, type PartnerEvent } from "@noshen/engine/partner/types";
import { optionalUser } from "./web";
import { servePhoto } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";

/**
 * The JSON API: sign-in (Better Auth), the partner's webhook, photos, and read endpoints for
 * future native apps. The web pages call the same engine directly from their loaders and actions.
 */
export const api = new Hono();

api.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(mailFor()).handler(c.req.raw));

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

api.get("/photos/*", (c) => servePhoto(decodeURIComponent(c.req.path.slice("/photos/".length))));

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
