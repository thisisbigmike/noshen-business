import { inTx, many, one } from "./db";
import { alertStaff } from "./staff-alerts";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { type Deps, lockDeal, notify, nowOf, settingsOf, userName } from "./core";
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
    await inTx(d.db, { type: "system" }, async (tx) => {
      const moved = await tx.db.query("update disputes set state = 'in_review' where id = $1 and state = 'collecting_evidence'", [r.id]);
      if (!moved.rowCount) return;
      const item = await one<{ title: string }>(tx.db, "select l.title from disputes x join deals dl on dl.id = x.deal_id join listings l on l.id = dl.listing_id where x.id = $1", [r.id]);
      await alertStaff(d, tx, "dispute_ready", `Dispute ready to decide: ${item?.title ?? "a deal"}`, "The time for photos and notes has ended. Over to a reviewer.", `/disputes/${r.id}`);
    });
    done.push(`evidence closed ${r.id}`);
  }

  // Hand-over deadline passed (and nothing sent): tell the buyer once that they may cancel for a full refund.
  for (const r of await many<{ id: string }>(d.db,
    `select id from deals dl where state = 'held' and handover_due_at <= $1 and delivered_at is null and sent_at is null
       and not exists (select 1 from notifications n where n.deal_id = dl.id and n.template = 'handover_overdue') ${filter}`, params())) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "held") return;
      const seller = firstName(await userName(tx.db, deal.seller_id));
      await notify(d, tx, deal.buyer_id, deal.id, "handover_overdue", `${seller} hasn't handed over in time. You can cancel now and get all your money back.`);
      done.push(`hand-over overdue ${deal.id}`);
    });
  }

  // A delivery on its way longer than usual for its zone, and not marked delivered: ask both people once, and tell
  // staff, so the money never sits held with nobody acting.
  const s = await settingsOf(d);
  for (const r of await many<{ id: string }>(d.db,
    `select dl.id from deals dl join listings l on l.id = dl.listing_id
      where dl.state = 'held' and dl.sent_at is not null and dl.delivered_at is null
        and dl.sent_at + make_interval(hours => case when dl.delivery_state = l.state then $${onlyDealId ? 3 : 2}::int else $${onlyDealId ? 4 : 3}::int end) <= $1
        and not exists (select 1 from notifications n where n.deal_id = dl.id and n.template = 'arrival_check') ${onlyDealId ? "and dl.id = $2" : ""}`,
    params([s.delivery_transit_hours.local, s.delivery_transit_hours.other]))) {
    await inTx(d.db, { type: "system" }, async (tx) => {
      const deal = await lockDeal(tx.db, r.id);
      if (deal.state !== "held" || deal.delivered_at) return;
      const seller = firstName(await userName(tx.db, deal.seller_id));
      const buyer = firstName(await userName(tx.db, deal.buyer_id));
      await notify(d, tx, deal.buyer_id, deal.id, "arrival_check", `Has your item arrived? If you have it, check it and confirm. If it hasn't come, report it as not delivered and the money stays held.`);
      await notify(d, tx, deal.seller_id, deal.id, "arrival_check", `Has ${buyer} got the item? Mark it delivered once it arrives. If it's stuck with ${deal.courier ?? "the courier"}, tell ${buyer} in the chat.`);
      const item = await one<{ title: string }>(tx.db, "select title from listings where id = $1", [deal.listing_id]);
      await alertStaff(d, tx, "delivery_late", `Delivery not confirmed: ${item?.title ?? "a deal"}`,
        `Sent ${when(deal.sent_at!, now)} with ${deal.courier ?? "a courier"}${deal.tracking_ref ? `, tracking ${deal.tracking_ref}` : ""}, and not marked delivered. ${seller} and ${buyer} have been asked.`, `/deals/${deal.id}`);
      done.push(`arrival check ${deal.id}`);
    });
  }
  return done;
}
