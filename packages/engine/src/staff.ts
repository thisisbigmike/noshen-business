import { inTx, one } from "./db";
import { type Deps, DealError, notify } from "./core";

/**
 * A reviewer takes a listing down (for example, a prohibited item) or approves one that was held for checks.
 * The seller is told why, and the action is kept in the audit log.
 */
export async function moderateListing(d: Deps, staffId: string, listingId: string, action: "remove" | "approve", reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters. The seller will see it.");
  return inTx(d.db, { type: "staff", id: staffId }, async (tx) => {
    const l = await one<{ id: string; seller_id: string; title: string; status: string }>(tx.db,
      "select id, seller_id, title, status from listings where id = $1 for update", [listingId]);
    if (!l) throw new DealError("not_found", "We can't find that listing.", 404);
    if (action === "remove") {
      if (!["live", "paused", "blocked"].includes(l.status)) throw new DealError("state", "Only live, paused or held listings can be removed.");
      await tx.db.query("update listings set status = 'removed' where id = $1", [listingId]);
      await notify(d, tx, l.seller_id, null, "listing_removed", `We removed your listing "${l.title}". Reason: ${why}`);
    } else {
      if (l.status !== "blocked") throw new DealError("state", "Only listings held for checks can be approved.");
      await tx.db.query("update listings set status = 'live', published_at = coalesce(published_at, now()) where id = $1", [listingId]);
      await notify(d, tx, l.seller_id, null, "listing_approved", `Your listing "${l.title}" has been checked and is live.`);
    }
    await tx.db.query("insert into staff_actions (staff_id, action, target_type, target_id, reason) values ($1, $2, 'listing', $3, $4)",
      [staffId, action === "remove" ? "remove_listing" : "approve_listing", listingId, why]);
  });
}
