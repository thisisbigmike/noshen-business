import type { Db } from "../db";
import { many, one } from "../db";
import type { DealState } from "../../shared/deal";

export interface SellerSummary {
  id: string; name: string; idVerified: boolean; rating: number | null; ratingCount: number; completedDeals: number;
}

export async function sellerSummary(db: Db, userId: string): Promise<SellerSummary> {
  const r = await one(db,
    `select u.id, u.full_name,
       exists (select 1 from kyc_checks k where k.user_id = u.id and k.result = 'verified') as verified,
       (select round(avg(stars)::numeric, 1) from ratings where ratee_id = u.id) as rating,
       (select count(*) from ratings where ratee_id = u.id) as rating_count,
       (select count(*) from deals where seller_id = u.id and state = 'paid_out') as completed
     from users u where u.id = $1`, [userId]);
  return { id: r.id, name: r.full_name ?? "Seller", idVerified: r.verified, rating: r.rating === null ? null : Number(r.rating), ratingCount: Number(r.rating_count), completedDeals: Number(r.completed) };
}

export async function listingView(db: Db, id: string) {
  const l = await one(db, "select * from listings where id = $1", [id]);
  if (!l) return null;
  return { listing: l, seller: await sellerSummary(db, l.seller_id) };
}

export async function browse(db: Db, f: { cat?: string; area?: string; sort?: string; q?: string }) {
  const where = ["status = 'live'"];
  const p: unknown[] = [];
  if (f.cat === "phone" || f.cat === "laptop") { p.push(f.cat); where.push(`category = $${p.length}`); }
  if (f.area) { p.push(f.area); where.push(`area = $${p.length}`); }
  if (f.q) { p.push(`%${f.q}%`); where.push(`title ilike $${p.length}`); }
  const order = f.sort === "price_asc" ? "price_kobo asc" : f.sort === "price_desc" ? "price_kobo desc" : "published_at desc";
  return many(db, `select id, title, price_kobo, area, category, condition, photo_keys, published_at from listings where ${where.join(" and ")} order by ${order} limit 60`, p);
}

export async function areasWithListings(db: Db) {
  return (await many<{ area: string }>(db, "select distinct area from listings where status = 'live' order by area")).map((r) => r.area);
}

export async function myListings(db: Db, userId: string) {
  return many(db,
    `select l.*, (select count(*) from deals d where d.listing_id = l.id and d.state = 'requested') as requests
     from listings l where seller_id = $1 and status <> 'removed' order by created_at desc`, [userId]);
}

export interface DealListItem {
  id: string; state: DealState; role: "buyer" | "seller"; title: string; other: string;
  price_kobo: string; amount_due_kobo: string; seller_share_kobo: string; handover: "meetup" | "delivery";
  request_expires_at: Date; payment_due_at: Date | null; handover_due_at: Date | null; release_due_at: Date | null;
  delivered_at: Date | null; review_hold: boolean; created_at: Date; updated_at: Date; decision_due_at: Date | null;
}

export async function dealsFor(db: Db, userId: string): Promise<DealListItem[]> {
  return many<DealListItem>(db,
    `select d.id, d.state, case when d.buyer_id = $1 then 'buyer' else 'seller' end as role, l.title,
       coalesce(case when d.buyer_id = $1 then s.full_name else b.full_name end, 'Someone') as other,
       d.price_kobo, d.amount_due_kobo, d.seller_share_kobo, d.handover, d.request_expires_at, d.payment_due_at,
       d.handover_due_at, d.release_due_at, d.delivered_at, d.review_hold, d.created_at, d.updated_at,
       (select decision_due_at from disputes x where x.deal_id = d.id) as decision_due_at
     from deals d join listings l on l.id = d.listing_id join users b on b.id = d.buyer_id join users s on s.id = d.seller_id
     where d.buyer_id = $1 or d.seller_id = $1
     order by d.updated_at desc`, [userId]);
}

/** Whether this person needs to act on the deal now. */
export function needsAction(x: { state: DealState; role: "buyer" | "seller"; delivered_at: Date | null; handover: string; review_hold: boolean }) {
  if (x.review_hold) return false;
  if (x.state === "requested") return x.role === "seller";
  if (x.state === "accepted") return x.role === "buyer";
  if (x.state === "held") return x.handover === "delivery" ? (x.delivered_at ? x.role === "buyer" : x.role === "seller") : true;
  if (x.state === "disputed") return true;
  return false;
}

export async function dealView(db: Db, dealId: string) {
  const deal = await one(db, "select * from deals where id = $1", [dealId]);
  if (!deal) return null;
  const [listing, buyer, seller, payments, events, messages, dispute, ratings, sellerBank, transfers] = await Promise.all([
    one(db, "select * from listings where id = $1", [deal.listing_id]),
    sellerSummary(db, deal.buyer_id),
    sellerSummary(db, deal.seller_id),
    many(db, "select amount_kobo, sender_name, matches_amount_due, matches_buyer_name, received_at from payments where deal_id = $1 order by received_at", [dealId]),
    many(db, "select type, actor, actor_id, from_state, to_state, payload, at from deal_events where deal_id = $1 order by id", [dealId]),
    many(db, "select m.id, m.sender_id, m.body, m.flagged, m.at from messages m where m.deal_id = $1 order by m.id", [dealId]),
    one(db, "select * from disputes where deal_id = $1", [dealId]),
    many(db, "select rater_id, stars, comment from ratings where deal_id = $1", [dealId]),
    one(db, "select account_last4, bank_code from bank_accounts where user_id = $1 and is_default and removed_at is null", [deal.seller_id]),
    many(db, "select kind, amount_kobo, status, created_at, updated_at from transfers where deal_id = $1 order by created_at", [dealId]),
  ]);
  const evidence = dispute ? await many(db, "select uploader_id, file_key, note, at from evidence where dispute_id = $1 order by at", [dispute.id]) : [];
  const rc = await one(db, "select failed_attempts, locked_until from release_codes where deal_id = $1", [dealId]);
  return { deal, listing, buyer, seller, payments, events, messages, dispute, evidence, ratings, sellerBank, transfers, releaseCode: rc };
}

export async function unreadCount(db: Db, userId: string) {
  const r = await one<{ n: string }>(db, "select count(*) as n from notifications where user_id = $1 and channel = 'in_app' and read_at is null", [userId]);
  return Number(r?.n ?? 0);
}

export async function notificationsFor(db: Db, userId: string) {
  const rows = await many(db,
    "select id, deal_id, template, params, created_at, read_at from notifications where user_id = $1 and channel = 'in_app' order by created_at desc limit 50", [userId]);
  await db.query("update notifications set read_at = now(), status = 'read' where user_id = $1 and channel = 'in_app' and read_at is null", [userId]);
  return rows;
}

// ---------------------------------------------------------------------------
// Staff console
// ---------------------------------------------------------------------------

export async function staffQueues(db: Db) {
  const [disputes, holds, locked, stuck, failed] = await Promise.all([
    many(db,
      `select x.id, x.deal_id, x.reason, x.state, x.decision_due_at, x.evidence_due_at, l.title, b.full_name as buyer, s.full_name as seller,
              (select coalesce(sum(amount_kobo),0) from payments p where p.deal_id = d.id) as held_kobo
       from disputes x join deals d on d.id = x.deal_id join listings l on l.id = d.listing_id
       join users b on b.id = d.buyer_id join users s on s.id = d.seller_id
       where x.state <> 'decided' order by x.decision_due_at`),
    many(db,
      `select d.id, d.review_hold_reason, d.state_changed_at, d.amount_due_kobo, l.title, b.full_name as buyer, s.full_name as seller
       from deals d join listings l on l.id = d.listing_id join users b on b.id = d.buyer_id join users s on s.id = d.seller_id
       where d.review_hold order by d.state_changed_at`),
    many(db,
      `select d.id, rc.locked_until, l.title from release_codes rc join deals d on d.id = rc.deal_id join listings l on l.id = d.listing_id
       where rc.locked_until > now() order by rc.locked_until`),
    many(db,
      `select d.id, d.state, d.handover_due_at, l.title from deals d join listings l on l.id = d.listing_id
       where (d.state = 'held' and d.handover_due_at < now() - interval '1 hour')
          or (d.state = 'released' and d.state_changed_at < now() - interval '1 hour')
       order by d.handover_due_at nulls last`),
    many(db,
      `select t.id, t.deal_id, t.kind, t.amount_kobo, t.failure_reason, t.updated_at from transfers t where t.status = 'failed' order by t.updated_at desc`),
  ]);
  return { disputes, holds, locked, stuck, failed };
}

export async function auditLog(db: Db) {
  return many(db,
    `select a.at, a.action, a.target_type, a.target_id, a.reason, st.name, st.role from staff_actions a join staff st on st.id = a.staff_id order by a.id desc limit 200`);
}

export async function moneySummary(db: Db) {
  const check = await one(db, "select * from held_funds_check");
  const byState = await many(db,
    `select d.state, count(*) as n, coalesce(sum(p.amount_kobo),0) as kobo from deals d left join payments p on p.deal_id = d.id
     where d.state in ('held','disputed') group by d.state`);
  const transfers = await many(db,
    `select t.created_at, t.kind, t.deal_id, t.amount_kobo, t.status from transfers t order by t.created_at desc limit 50`);
  const unmatched = await many(db, "select amount_kobo, sender_name, received_at from payments where deal_id is null order by received_at desc");
  return { check, byState, transfers, unmatched };
}
