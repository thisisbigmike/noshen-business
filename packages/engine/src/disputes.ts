import { inTx, one } from "./db";
import { naira } from "@noshen/shared/money";
import { firstName, DISPUTE_REASONS, type DisputeReason } from "@noshen/shared/deal";
import { when, addHours } from "@noshen/shared/time";
import { type Deps, DealError, N, amountPaid, lockDeal, notify, nowOf, schedule, settingsOf, userName } from "./core";
import { refund, release } from "./deals";
import { alertStaff } from "./staff-alerts";

import { disputeReasonLabel as reasonLabel } from "@noshen/shared/deal";

/** The buyer reports a problem before release: the money freezes at once. */
export async function reportProblem(d: Deps, buyerId: string, dealId: string, input: { reason: DisputeReason; description?: string; photoKeys?: string[] }) {
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const s = await settingsOf(d);
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can report a problem.", 403);
    if (deal.state !== "held") throw new DealError("state", "You can report a problem while the money is held.");
    if (!DISPUTE_REASONS.some(([k]) => k === input.reason)) throw new DealError("reason", "Pick what's wrong.");
    const evidenceDue = addHours(now, s.evidence_window_hours);
    const decisionDue = addHours(now, s.dispute_decision_hours);
    await tx.db.query("update deals set state = 'disputed' where id = $1", [dealId]);
    const disp = await one<{ id: string }>(tx.db,
      `insert into disputes (deal_id, opened_by, reason, description, evidence_due_at, decision_due_at) values ($1, $2, $3, $4, $5, $6) returning id`,
      [dealId, buyerId, input.reason, input.description?.trim().slice(0, 2000) || null, evidenceDue, decisionDue]);
    for (const key of input.photoKeys ?? []) {
      await tx.db.query("insert into evidence (dispute_id, uploader_id, file_key) values ($1, $2, $3)", [disp!.id, buyerId, key]);
    }
    const buyer = firstName(await userName(tx.db, buyerId));
    await notify(d, tx, buyerId, dealId, "problem_reported",
      `Report received. The money stays held. Add photos or notes by ${when(evidenceDue, now)}. A reviewer decides by ${when(decisionDue, now)}.`);
    await notify(d, tx, deal.seller_id, dealId, "problem_reported",
      `${buyer} reported a problem: ${reasonLabel(input.reason)}. Add photos or notes by ${when(evidenceDue, now)}. A reviewer decides by ${when(decisionDue, now)}.`);
    schedule(d, tx, "evidence_close", dealId, evidenceDue);
    const item = await one<{ title: string }>(tx.db, "select title from listings where id = $1", [deal.listing_id]);
    await alertStaff(d, tx, "dispute", `New dispute: ${item?.title ?? "a deal"}`,
      `${reasonLabel(input.reason)}. ${naira(await amountPaid(tx.db, dealId))} frozen. Decide by ${when(decisionDue, now)}.`, `/disputes/${disp!.id}`);
    return disp!.id;
  });
}

export async function addEvidence(d: Deps, userId: string, dealId: string, input: { note?: string; fileKey?: string }) {
  const now = nowOf(d);
  const row = await one(d.db,
    `select x.id, x.state, x.evidence_due_at, d.buyer_id, d.seller_id from disputes x join deals d on d.id = x.deal_id where x.deal_id = $1`, [dealId]);
  if (!row) throw new DealError("not_found", "There's no problem reported on this deal.", 404);
  if (row.buyer_id !== userId && row.seller_id !== userId) throw new DealError("forbidden", "This deal isn't yours.", 403);
  if (row.state !== "collecting_evidence" || new Date(row.evidence_due_at) <= now) throw new DealError("closed", "The time for adding evidence has passed.");
  if (!input.note?.trim() && !input.fileKey) throw new DealError("empty", "Add a note or a photo.");
  await d.db.query("insert into evidence (dispute_id, uploader_id, file_key, note) values ($1, $2, $3, $4)",
    [row.id, userId, input.fileKey ?? null, input.note?.trim().slice(0, 2000) || null]);
}

/** A reviewer decides where the held money goes. Final, and recorded with the reason. */
export async function decideDispute(d: Deps, staffId: string, disputeId: string, decision: "refund_buyer" | "release_to_seller", reason: string) {
  if (reason.trim().length < 5) throw new DealError("reason", "Write a reason. Both people will see it.");
  return inTx(d.db, { type: "staff", id: staffId }, async (tx) => {
    const disp = await one(tx.db, "select * from disputes where id = $1 for update", [disputeId]);
    if (!disp) throw new DealError("not_found", "Dispute not found.", 404);
    if (disp.state === "decided") throw new DealError("decided", "This dispute has already been decided.");
    const deal = await lockDeal(tx.db, disp.deal_id);
    if (decision === "refund_buyer") await refund(d, tx, deal, "reviewer");
    else await release(d, tx, deal, "reviewer");
    await tx.db.query(
      "update disputes set state = 'decided', decision = $2, decided_by = $3, decision_reason = $4, decided_at = now() where id = $1",
      [disputeId, decision, staffId, reason.trim()]);
    await tx.db.query(
      "insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, 'decide_dispute', 'dispute', $2, $3, $4)",
      [staffId, disputeId, reason.trim(), JSON.stringify({ decision, deal_id: deal.id })]);
    const paid = await amountPaid(tx.db, deal.id);
    const outcome = decision === "refund_buyer" ? `${naira(paid)} refunded to the buyer` : `${naira(deal.seller_share_kobo)} released to the seller`;
    for (const u of [deal.buyer_id, deal.seller_id]) {
      await notify(d, tx, u, deal.id, "decision_made", `Decision: ${outcome}. Reason: ${reason.trim()}`);
    }
  });
}

/** Clears a review hold (the deal continues) or refunds the payment and closes the deal. */
export async function resolveReviewHold(d: Deps, staffId: string, dealId: string, action: "clear" | "refund", reason: string) {
  if (reason.trim().length < 5) throw new DealError("reason", "Write a reason. It's saved to the audit log.");
  return inTx(d.db, { type: "staff", id: staffId }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    if (!deal.review_hold) throw new DealError("state", "This deal isn't held for review.");
    if (action === "clear") {
      await tx.db.query("update deals set review_hold = false, review_hold_reason = null where id = $1", [dealId]);
      const now = nowOf(d);
      await notify(d, tx, deal.buyer_id, dealId, "hold_cleared", `Your payment is confirmed and held. Meet the seller by ${deal.handover_due_at ? when(deal.handover_due_at, now) : "the deadline"}.`);
      await notify(d, tx, deal.seller_id, dealId, "hold_cleared", `The payment is confirmed. ${naira(deal.seller_share_kobo)} is held for you. Hand over and ask for the code.`);
    } else {
      await refund(d, tx, deal, "review_hold");
      await notify(d, tx, deal.seller_id, dealId, "hold_refunded", "The payment couldn't be confirmed and was sent back. The deal is closed.");
    }
    await tx.db.query(
      "insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, $2, 'deal', $3, $4, $5)",
      [staffId, action === "clear" ? "clear_review_hold" : "refund_review_hold", dealId, reason.trim(), JSON.stringify({ hold: deal.review_hold_reason })]);
  });
}

