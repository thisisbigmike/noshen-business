import { inTx, one, type Tx } from "./db";
import { type Deps, DealError, N, lockDeal, notify } from "./core";
import { retryFailedTransfer } from "./deals";
import { sweep } from "./sweep";
import { naira } from "@noshen/shared/money";

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

// ---------------------------------------------------------------------------
// People, release codes, transfers and deadlines. Every action needs a reason and goes in the audit log.
// ---------------------------------------------------------------------------

export interface StaffActor { id: string; role: "reviewer" | "admin" }

function reasonOf(reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters. It's kept in the audit log.");
  return why;
}

async function logAction(tx: Tx, staffId: string, action: string, targetType: "user" | "deal" | "listing", targetId: string, reason: string, payload: object = {}) {
  await tx.db.query("insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, $2, $3, $4, $5, $6)",
    [staffId, action, targetType, targetId, reason, JSON.stringify(payload)]);
}

/**
 * Freezes, bans or reactivates an account. A frozen or banned person can't sign in to buy or sell, and their
 * listings disappear from Browse; deals already under way carry on, and their money stays held. Reviewers can
 * freeze and unfreeze; banning, and lifting a ban, is for admins.
 */
export async function setAccountStatus(d: Deps, staff: StaffActor, userId: string, status: "active" | "frozen" | "banned", reason: string) {
  const why = reasonOf(reason);
  if (!["active", "frozen", "banned"].includes(status)) throw new DealError("status", "Choose active, frozen or banned.");
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const u = await one<{ status: string }>(tx.db, "select status from users where id = $1 for update", [userId]);
    if (!u) throw new DealError("not_found", "We can't find that person.", 404);
    if (u.status === status) throw new DealError("state", `This account is already ${status}.`);
    if ((status === "banned" || u.status === "banned") && staff.role !== "admin") throw new DealError("forbidden", "Only an admin can ban an account or lift a ban.", 403);
    await tx.db.query("update users set status = $2 where id = $1", [userId, status]);
    await notify(d, tx, userId, null, status === "active" ? "account_active" : "account_paused", status === "active"
      ? "Your NosHen account is active again. You can buy and sell as before."
      : "Your NosHen account has been paused, so you can't buy or sell for now. Any deal already under way is safe: its money stays held. Contact NosHen support to find out more.");
    await logAction(tx, staff.id, status === "active" ? "reactivate_user" : status === "frozen" ? "freeze_user" : "ban_user", "user", userId, why, { from: u.status, to: status });
  });
}

/** Sets the most one seller can take in a deal (whatever their checks), or puts them back on the standard rules (null). */
export async function setDealLimit(d: Deps, staff: StaffActor, userId: string, maxKobo: number | null, reason: string) {
  const why = reasonOf(reason);
  if (maxKobo !== null && (!Number.isSafeInteger(maxKobo) || maxKobo < 100_000)) throw new DealError("limit", "Set a limit of at least ₦1,000, or choose the standard rules.");
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const u = await one<{ max_deal_kobo: string | null }>(tx.db, "select max_deal_kobo from users where id = $1 for update", [userId]);
    if (!u) throw new DealError("not_found", "We can't find that person.", 404);
    await tx.db.query("update users set max_deal_kobo = $2 where id = $1", [userId, maxKobo]);
    await notify(d, tx, userId, null, "deal_limit", maxKobo === null
      ? "Your deal limit now follows NosHen's standard rules."
      : `NosHen set the most you can take in one deal to ${naira(maxKobo)}.`);
    await logAction(tx, staff.id, "set_limit", "user", userId, why, { from: u.max_deal_kobo === null ? null : N(u.max_deal_kobo), to: maxKobo });
  });
}

/** Lets the seller try the release code again after too many wrong tries (for example, the buyer misread it). */
export async function unlockReleaseCode(d: Deps, staff: StaffActor, dealId: string, reason: string) {
  const why = reasonOf(reason);
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    const r = await tx.db.query("update release_codes set locked_until = null, failed_attempts = 0 where deal_id = $1 and locked_until > now()", [dealId]);
    if (!r.rowCount) throw new DealError("state", "This deal's release code isn't locked.");
    await notify(d, tx, deal.seller_id, dealId, "code_unlocked", "You can enter the release code again. Ask the buyer to read it out slowly from their app.");
    await logAction(tx, staff.id, "unlock_release_code", "deal", dealId, why);
  });
}

/** Sends a failed payout or refund again. */
export async function retryTransfer(d: Deps, staff: StaffActor, transferId: string, reason: string) {
  const why = reasonOf(reason);
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const t = await one<{ deal_id: string; kind: string; amount_kobo: string }>(tx.db, "select deal_id, kind, amount_kobo from transfers where id = $1", [transferId]);
    if (!t?.deal_id) throw new DealError("not_found", "We can't find that transfer.", 404);
    await retryFailedTransfer(d, tx, transferId);
    await logAction(tx, staff.id, `retry_${t.kind}`, "deal", t.deal_id, why, { transfer: transferId, amount_kobo: N(t.amount_kobo) });
  });
}

/** Acts on any passed deadline for one deal now, instead of waiting for the next 15-minute check. */
export async function checkDeadlinesNow(d: Deps, staff: StaffActor, dealId: string) {
  const done = await sweep(d, dealId);
  await inTx(d.db, { type: "staff", id: staff.id }, (tx) =>
    logAction(tx, staff.id, "check_deadlines", "deal", dealId, "Checked this deal's deadlines from the staff site", { done }));
  return done;
}

/**
 * Deletes sold listings from NosHen: they leave Browse and the seller's page. Their deals and photos stay on
 * record (a listing that's been bought can't vanish from its deal's history). Only listings that are sold.
 */
export async function deleteSoldListings(d: Deps, staff: StaffActor, listingIds: string[] | "all", reason = "Sold. Taken off NosHen by staff.") {
  const why = reasonOf(reason);
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const rows = listingIds === "all"
      ? (await tx.db.query("update listings set status = 'removed' where status = 'sold' returning id")).rows
      : (await tx.db.query("update listings set status = 'removed' where status = 'sold' and id = any($1::uuid[]) returning id", [listingIds])).rows;
    if (!rows.length) throw new DealError("state", listingIds === "all" ? "There are no sold listings to delete." : "Only a sold listing can be deleted.");
    for (const r of rows as { id: string }[]) await logAction(tx, staff.id, "delete_sold_listing", "listing", r.id, why);
    return rows.length;
  });
}
