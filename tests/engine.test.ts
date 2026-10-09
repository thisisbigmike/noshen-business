import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, person, verifiedSeller, liveListing, pay, settleAll, balances, stateOf, type TestWorld } from "./helpers";
import {
  requestDeal, acceptDeal, releaseByCode, releaseCodeForBuyer, markDelivered, confirmReceived, cancelDeal, handlePartnerEvent, sendMessage, rate,
} from "../server/engine/deals";
import { reportProblem, decideDispute, resolveReviewHold, addEvidence } from "../server/engine/disputes";
import { sweep } from "../server/engine/sweep";
import { DealError } from "../server/engine/core";
import { feeFor, naira } from "../shared/money";

let w: TestWorld;
let staffId: string;
beforeAll(async () => {
  w = await world();
  staffId = (await w.db.query("insert into staff (email, name, role) values ('rev@noshen.test', 'Rev', 'reviewer') returning id")).rows[0].id;
});
afterAll(async () => { await w.db.end(); });

async function heldDeal(price = 250_000, handover: "meetup" | "delivery" = "meetup", payer?: string) {
  const seller = await verifiedSeller(w, "Tunde Bakare");
  const buyer = await person(w, "Chioma Obi");
  const listing = await liveListing(w, seller, price);
  const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover });
  await acceptDeal(w.d, seller, dealId);
  const due = Number((await w.db.query("select amount_due_kobo from deals where id = $1", [dealId])).rows[0].amount_due_kobo);
  await pay(w, dealId, due, payer ?? "CHIOMA OBI");
  return { seller, buyer, listing, dealId, due };
}

describe("fees", () => {
  it("charges 1.5% between ₦500 and ₦7,500", () => {
    expect(feeFor(45_000_000)).toBe(675_000);       // ₦450,000 → ₦6,750
    expect(feeFor(2_000_000)).toBe(50_000);         // ₦20,000 → ₦500 minimum
    expect(feeFor(200_000_000)).toBe(750_000);      // ₦2,000,000 → ₦7,500 maximum
    expect(naira(45_675_000)).toBe("₦456,750");
  });
});

describe("a meet-up deal from request to payout", () => {
  it("holds the money, releases on the right code, pays out, and balances the ledger", async () => {
    const { seller, buyer, dealId, due } = await heldDeal(250_000);
    expect(due).toBe(25_375_000);
    expect(await stateOf(w, dealId)).toBe("held");

    const wrong = await releaseByCode(w.d, seller, dealId, "000000");
    expect(wrong).toEqual({ ok: false, message: "That code doesn’t match. 4 tries left." });

    const code = await releaseCodeForBuyer(w.d, buyer, dealId);
    await expect(releaseCodeForBuyer(w.d, seller, dealId)).rejects.toThrow(DealError);
    expect(await releaseByCode(w.d, seller, dealId, code)).toEqual({ ok: true });
    expect(await stateOf(w, dealId)).toBe("released");

    await settleAll(w);
    expect(await stateOf(w, dealId)).toBe("paid_out");
    const b = await balances(w, dealId);
    expect(b.held_funds ?? 0).toBe(0);
    expect(b.seller_payable ?? 0).toBe(0);
    expect(b.fee_revenue).toBe(-375_000);
    expect(b.partner_cash).toBe(375_000); // the fee stays with the partner until swept
    const check = (await w.db.query("select * from held_funds_check")).rows[0];
    expect(Number(check.ledger_held_kobo)).toBe(Number(check.open_deals_kobo));

    await rate(w.d, buyer, dealId, 5, "Smooth");
    expect((await w.db.query("select listing_id from deals where id = $1", [dealId])).rows.length).toBe(1);
  });

  it("stores a repeated webhook once", async () => {
    const seller = await verifiedSeller(w, "Kunle Adeyemi");
    const buyer = await person(w, "Femi Ade");
    const listing = await liveListing(w, seller, 100_000);
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
    await acceptDeal(w.d, seller, dealId);
    const { event } = await pay(w, dealId, 10_150_000, "FEMI ADE");
    expect(await handlePartnerEvent(w.d, event)).toBe("duplicate");
    const n = (await w.db.query("select count(*) from payments where deal_id = $1", [dealId])).rows[0].count;
    expect(Number(n)).toBe(1);
  });
});

describe("protections", () => {
  it("locks code entry after 5 wrong tries", async () => {
    const { seller, dealId } = await heldDeal(120_000);
    for (let i = 0; i < 4; i++) await releaseByCode(w.d, seller, dealId, "111111");
    const fifth = await releaseByCode(w.d, seller, dealId, "111111");
    expect(fifth.ok).toBe(false);
    expect((fifth as any).locked).toBe(true);
    const after = await releaseByCode(w.d, seller, dealId, "222222");
    expect((after as any).locked).toBe(true);
  });

  it("holds a payment from someone else's account for review", async () => {
    const { seller, buyer, dealId } = await heldDeal(150_000, "meetup", "ADEBAYO JOHNSON");
    const deal = (await w.db.query("select review_hold, review_hold_reason from deals where id = $1", [dealId])).rows[0];
    expect(deal.review_hold).toBe(true);
    expect(deal.review_hold_reason).toContain("ADEBAYO JOHNSON");
    const code = await releaseCodeForBuyer(w.d, buyer, dealId);
    expect((await releaseByCode(w.d, seller, dealId, code)).ok).toBe(false);
    await resolveReviewHold(w.d, staffId, dealId, "clear", "Uncle paid; buyer confirmed by phone");
    expect((await releaseByCode(w.d, seller, dealId, code)).ok).toBe(true);
    const audit = (await w.db.query("select action from staff_actions where target_id = $1", [dealId])).rows;
    expect(audit.map((a: any) => a.action)).toContain("clear_review_hold");
  });

  it("caps a new seller's deals at ₦300,000", async () => {
    const seller = await verifiedSeller(w, "New Seller");
    const buyer = await person(w, "Big Buyer");
    const listing = await liveListing(w, seller, 400_000);
    await expect(requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" })).rejects.toThrow("can't take deals above ₦300,000");
  });

  it("flags chat messages that ask for payment outside NosHen", async () => {
    const { seller, dealId } = await heldDeal(90_000);
    await sendMessage(w.d, seller, dealId, "Pay to my account and I'll bring a case, ₦8,000.");
    const m = (await w.db.query("select flagged from messages where deal_id = $1 order by id desc limit 1", [dealId])).rows[0];
    expect(m.flagged).toBe(true);
  });
});

describe("disputes", () => {
  it("freezes the money and refunds the buyer in full when the reviewer decides so", async () => {
    const { buyer, seller, dealId, due } = await heldDeal(285_000, "delivery");
    await markDelivered(w.d, seller, dealId);
    await reportProblem(w.d, buyer, dealId, { reason: "not_as_described", description: "Battery won't charge" });
    expect(await stateOf(w, dealId)).toBe("disputed");
    await addEvidence(w.d, seller, dealId, { note: "It charged before I sent it" });
    const disputeId = (await w.db.query("select id from disputes where deal_id = $1", [dealId])).rows[0].id;
    await expect(decideDispute(w.d, staffId, disputeId, "refund_buyer", "no")).rejects.toThrow("Write a reason");
    await decideDispute(w.d, staffId, disputeId, "refund_buyer", "Battery fault shown in buyer's photos; listing said battery good");
    expect(await stateOf(w, dealId)).toBe("refunded");
    await settleAll(w);
    const t = (await w.db.query("select kind, amount_kobo, status from transfers where deal_id = $1", [dealId])).rows[0];
    expect(t).toMatchObject({ kind: "refund", status: "succeeded" });
    expect(Number(t.amount_kobo)).toBe(due);
    const b = await balances(w, dealId);
    expect(b.held_funds ?? 0).toBe(0);
    expect(b.refunds_due ?? 0).toBe(0);
    expect(b.partner_cash ?? 0).toBe(0);
  });
});

describe("timers", () => {
  it("releases a delivered deal 24 hours later if the buyer says nothing", async () => {
    const { seller, dealId } = await heldDeal(80_000, "delivery");
    await markDelivered(w.d, seller, dealId);
    expect(w.timers.some((t) => t.kind === "delivery_release" && t.dealId === dealId)).toBe(true);
    expect(await sweep(w.d, dealId)).toEqual([]);
    w.clock.now = new Date(Date.now() + 25 * 3600_000);
    const done = await sweep(w.d, dealId);
    w.clock.now = new Date();
    expect(done).toContain(`released after delivery ${dealId}`);
    expect(await stateOf(w, dealId)).toBe("released");
  });

  it("expires a request the seller doesn't answer in 12 hours", async () => {
    const seller = await verifiedSeller(w, "Slow Seller");
    const buyer = await person(w, "Waiting Buyer");
    const listing = await liveListing(w, seller, 60_000);
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
    w.clock.now = new Date(Date.now() + 13 * 3600_000);
    await sweep(w.d, dealId);
    await expect(acceptDeal(w.d, seller, dealId)).rejects.toThrow();
    w.clock.now = new Date();
    expect(await stateOf(w, dealId)).toBe("declined");
  });

  it("lets either side cancel before hand-over, refunding the buyer", async () => {
    const { buyer, dealId, due } = await heldDeal(70_000);
    await cancelDeal(w.d, buyer, dealId);
    expect(await stateOf(w, dealId)).toBe("refunded");
    await settleAll(w);
    const t = (await w.db.query("select amount_kobo, status from transfers where deal_id = $1", [dealId])).rows[0];
    expect(Number(t.amount_kobo)).toBe(due);
  });

  it("confirms receipt after delivery", async () => {
    const { buyer, seller, dealId } = await heldDeal(50_000, "delivery");
    await expect(confirmReceived(w.d, buyer, dealId)).rejects.toThrow();
    await markDelivered(w.d, seller, dealId);
    await confirmReceived(w.d, buyer, dealId);
    expect(await stateOf(w, dealId)).toBe("released");
  });
});
