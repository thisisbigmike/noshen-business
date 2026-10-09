import { inTx, many } from "../db";
import { firstName } from "../../shared/deal";
import { type Deps, lockDeal, notify, nowOf, userName } from "./core";
import { release } from "./deals";

/**
 * Acts on every deadline that has passed: the job of each Workflow timer, and the 15-minute sweep
 * that catches any timer that didn't fire. Every action re-checks the deal under a lock, so running
 * it twice, late, or at the same time as a person's action, does nothing extra.
 */
export async function sweep(d: Deps, onlyDealId?: string) {
  const now = nowOf(d);
  const filter = onlyDealId ? "and id = $2" : "";
  const params = (extra: unknown[] = []) => (onlyDealId ? [now, onlyDealId, ...extra] : [now, ...extra]);
  const done: string[] = [];

  for (const r of await many<{ id: string }>(d.db, `select id from deals where state = 'requested' and request_expires_at <= $1 ${filter}`, params())) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "requested" || deal.request_expires_at > now) return;
      await tx.db.query("update deals set state = 'declined' where id = $1", [deal.id]);
      await notify(d, tx, deal.buyer_id, deal.id, "request_expired", "The seller didn't answer in time, so your request expired. You paid nothing.");
      done.push(`expired request ${deal.id}`);
    });
  }

  for (const r of await many<{ id: string }>(d.db, `select id from deals where state = 'accepted' and payment_due_at <= $1 ${filter}`, params())) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "accepted" || !deal.payment_due_at || deal.payment_due_at > now) return;
      await tx.db.query("update deals set state = 'declined' where id = $1", [deal.id]);
      await notify(d, tx, deal.buyer_id, deal.id, "payment_expired", "The time to pay has passed, so the deal was cancelled. If you already sent money, it will be returned.");
      await notify(d, tx, deal.seller_id, deal.id, "payment_expired", "The buyer didn't pay in time, so the deal was cancelled. Your listing is still live.");
      done.push(`expired payment ${deal.id}`);
    });
  }

  for (const r of await many<{ id: string }>(d.db,
    `select id from deals where state = 'held' and delivered_at is not null and release_due_at <= $1 and not review_hold ${filter}`, params())) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "held" || !deal.release_due_at || deal.release_due_at > now || deal.review_hold) return;
      await release(d, tx, deal, "timer");
      done.push(`released after delivery ${deal.id}`);
    });
  }

  for (const r of await many<{ id: string }>(d.db,
    `select x.id from disputes x where x.state = 'collecting_evidence' and x.evidence_due_at <= $1 ${onlyDealId ? "and x.deal_id = $2" : ""}`, params())) {
    await d.db.query("update disputes set state = 'in_review' where id = $1 and state = 'collecting_evidence'", [r.id]);
    done.push(`evidence closed ${r.id}`);
  }

  // Hand-over deadline passed: tell the buyer once that they may cancel for a full refund.
  for (const r of await many<{ id: string }>(d.db,
    `select id from deals dl where state = 'held' and handover_due_at <= $1 and delivered_at is null
       and not exists (select 1 from notifications n where n.deal_id = dl.id and n.template = 'handover_overdue') ${filter}`, params())) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "held") return;
      const seller = firstName(await userName(tx.db, deal.seller_id));
      await notify(d, tx, deal.buyer_id, deal.id, "handover_overdue", `${seller} hasn't handed over in time. You can cancel now and get all your money back.`);
      done.push(`hand-over overdue ${deal.id}`);
    });
  }
  return done;
}
