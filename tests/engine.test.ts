import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { world, person, verifiedSeller, liveListing, pay, payCrypto, settleAll, balances, stateOf, sendIt, type TestWorld } from "./helpers";
import {
  requestDeal, sellerLimit, acceptDeal, releaseByCode, releaseCodeForBuyer, markDelivered, markSent, confirmReceived, cancelDeal, handlePartnerEvent, sendMessage, rate, explainHold,
  markStageDone, releaseNextStage,
} from "@noshen/engine/deals";
import { reportProblem, decideDispute, resolveReviewHold, addEvidence } from "@noshen/engine/disputes";
import { sweep } from "@noshen/engine/sweep";
import { DealError, settingsOf } from "@noshen/engine/core";
import { one } from "@noshen/engine/db";
import { addHandle, checkSeller, decideHandle, handlesToCheck, removeHandle, submitHandle, verifiedHandles } from "@noshen/engine/handles";
import { feeFor, naira } from "@noshen/shared/money";
import { saveDraft, publish, setDelivery, setVisibility, setProfilePhoto } from "@noshen/engine/sellers";
import { sizeLabel } from "@noshen/shared/sizes";
import { moderateListing, setAccountStatus, setDealLimit, unlockReleaseCode, retryTransfer, checkDeadlinesNow, deleteSoldListings, staffRefund, staffRelease, giveMoreTime, openDisputeForBuyer, staffCancel, noteToBoth, removeProfilePhoto } from "@noshen/engine/staff";
import { adminOverview, browse, staffListings, staffUsers, statesWithListings, staffDeals, staffDeal, staffPerson, staffCounts, auditLog, listingView, sellerShop, sellerSummary } from "@noshen/engine/queries";
import { cryptoQuotes, prepareCryptoPayment, refundsWaitingForAddress, saveRefundAddress } from "@noshen/engine/stablecoins";
import { FAKE_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import { addressProblem, coinAmount, coinMicroFor, koboForCoin, payPlanFor } from "@noshen/shared/payments";

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
  // Delivery within Lagos costs ₦3,000, to other states ₦8,000.
  const listing = await liveListing(w, seller, price, undefined, handover === "delivery" ? { deliveryLocalKobo: 300_000, deliveryOtherKobo: 800_000 } : {});
  const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover, deliveryState: handover === "delivery" ? "Lagos" : undefined });
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

describe("listings across the marketplace", () => {
  const draft = (seller: string, input: Partial<Parameters<typeof saveDraft>[4] & object>) =>
    saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "other", title: "Something", priceNaira: 20_000, condition: "good", state: "Lagos", area: "Yaba", ...input } as any);

  it("publishes clothes, shoes and hair without an ID number", async () => {
    const seller = await verifiedSeller(w, "Kunle Adeyemi");
    const dress = await draft(seller, { category: "fashion", title: "Ankara maxi dress", priceNaira: 18_000, sizeSystem: "uk", size: "12" });
    expect(await publish(w.d, seller, dress)).toBe("live");
    const shoes = await draft(seller, { category: "shoes", title: "Nike Air Force 1", priceNaira: 45_000, sizeSystem: "eu", size: "43" });
    expect(await publish(w.d, seller, shoes)).toBe("live");
    const wig = await draft(seller, { category: "hair", title: "Bone straight wig", priceNaira: 185_000, sizeSystem: "inches", size: "22 inches" });
    expect(await publish(w.d, seller, wig)).toBe("live");
  });

  it("needs a chassis number for a car, has a ₦5,000 minimum and no top price", async () => {
    const seller = await verifiedSeller(w, "Kunle Adeyemi");
    await expect(draft(seller, { category: "vehicle", title: "Toyota Corolla 2014", priceNaira: 9_800_000 })).rejects.toThrow(/chassis number/);
    const car = await draft(seller, { category: "vehicle", title: "Toyota Corolla 2014", priceNaira: 9_800_000, imeiOrSerial: "2t1b urhe0ec 123456" });
    expect(await publish(w.d, seller, car)).toBe("live");
    const stored = (await w.db.query("select imei_or_serial from listings where id = $1", [car])).rows[0].imei_or_serial;
    expect(stored).toBe("2T1BURHE0EC123456");
    const lexus = await draft(seller, { category: "vehicle", title: "Lexus RX 2020", priceNaira: 85_000_000, imeiOrSerial: "JTJHZ1234567" });
    expect(await publish(w.d, seller, lexus)).toBe("live");
    await expect(draft(seller, { category: "home", title: "Too many zeros", priceNaira: 1e17 })).rejects.toThrow(/too large/);
    await expect(draft(seller, { category: "fashion", title: "Socks", priceNaira: 2_000 })).rejects.toThrow(/₦5,000/);
  });

  it("refuses a live car listing without a chassis number at the database too", async () => {
    const seller = await verifiedSeller(w, "Kunle Adeyemi");
    await expect(w.db.query(
      `insert into listings (seller_id, category, title, price_kobo, condition, area, state, photo_keys, status) values ($1, 'vehicle', 'No papers', 500000000, 'good', 'Ikeja', 'Lagos', '{a,b,c}', 'live')`, [seller],
    )).rejects.toThrow(/listings_vehicle_chassis/);
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

  it("emails both people about each change, only after it's saved", async () => {
    const before = w.mail.sent.length;
    const { seller, dealId } = await heldDeal(60_000);
    const mine = w.mail.sent.slice(before);
    expect(mine.some((m) => /wants to buy/.test(m.text))).toBe(true);
    expect(mine.some((m) => /held safely/.test(m.text) && m.text.includes(`/d/${dealId}`))).toBe(true);
    expect(mine.every((m) => !/\b\d{6}\b/.test(m.subject))).toBe(true); // never a code in a deal email
    const rows = (await w.db.query("select channel, status from notifications where deal_id = $1", [dealId])).rows;
    expect(rows.filter((r: any) => r.channel === "email").every((r: any) => r.status === "sent")).toBe(true);
    expect(seller).toBeTruthy();
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

  it("limits sellers who haven't verified to ₦300,000; verified sellers have no limit", async () => {
    const s = await settingsOf(w.d);
    const buyer = await person(w, "Big Buyer");
    // An unverified seller can't publish through the app, so put their listing live directly.
    const unverified = await person(w, "Unverified Seller");
    const risky = (await w.db.query(
      "insert into listings (seller_id, category, title, price_kobo, condition, area, state, photo_keys, status, published_at) values ($1, 'fashion', 'Designer bag', 40000000, 'good', 'Yaba', 'Lagos', '{a,b,c}', 'live', now()) returning id",
      [unverified])).rows[0].id;
    expect(await sellerLimit(w.db, unverified, s)).toEqual({ capKobo: 30_000_000, custom: false, verified: false });
    await expect(requestDeal(w.d, buyer, { listingId: risky, handover: "meetup" })).rejects.toThrow("hasn't finished NosHen's ID and bank checks");

    const verified = await verifiedSeller(w, "Verified Seller");
    expect(await sellerLimit(w.db, verified, s)).toEqual({ capKobo: null, custom: false, verified: true });
    const pricey = await liveListing(w, verified, 400_000, "Phone over ₦300k");
    expect(await requestDeal(w.d, buyer, { listingId: pricey, handover: "meetup" })).toBeTruthy();
  });

  it("lets staff set a limit on one seller, whatever their checks", async () => {
    const s = await settingsOf(w.d);
    const seller = await verifiedSeller(w, "Limited Seller");
    const buyer = await person(w, "Another Buyer");
    await w.db.query("update users set max_deal_kobo = 50000000 where id = $1", [seller]);
    expect(await sellerLimit(w.db, seller, s)).toEqual({ capKobo: 50_000_000, custom: true, verified: true });
    const over = await liveListing(w, seller, 600_000, "Over the staff limit");
    await expect(requestDeal(w.d, buyer, { listingId: over, handover: "meetup" })).rejects.toThrow("can take deals up to ₦500,000");
    const under = await liveListing(w, seller, 450_000, "Under the staff limit");
    expect(await requestDeal(w.d, buyer, { listingId: under, handover: "meetup" })).toBeTruthy();
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
    await sendIt(w, seller, dealId);
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
    await sendIt(w, seller, dealId);
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
    await sendIt(w, seller, dealId);
    await markDelivered(w.d, seller, dealId);
    await confirmReceived(w.d, buyer, dealId);
    expect(await stateOf(w, dealId)).toBe("released");
  });
});

describe("delivery prices and packing proof", () => {
  const PRICE = 100_000; // ₦100,000
  /** A seller who delivers within Lagos for ₦3,000 and to other states for ₦8,000, unless told otherwise. */
  async function deliveryListing(prices: { deliveryLocalKobo?: number | null; deliveryOtherKobo?: number | null } = { deliveryLocalKobo: 300_000, deliveryOtherKobo: 800_000 }) {
    const seller = await verifiedSeller(w, "Funke Delivers");
    const listing = await liveListing(w, seller, PRICE, "Samsung A54, 128GB", prices);
    return { seller, listing };
  }
  async function paidDelivery(to: string) {
    const { seller, listing } = await deliveryListing();
    const buyer = await person(w, "Emeka Okafor");
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "delivery", deliveryState: to });
    await acceptDeal(w.d, seller, dealId);
    const deal = (await w.db.query("select amount_due_kobo, seller_share_kobo, delivery_kobo, fee_kobo from deals where id = $1", [dealId])).rows[0];
    await pay(w, dealId, Number(deal.amount_due_kobo), "EMEKA OKAFOR");
    return { seller, buyer, dealId, deal };
  }

  it("charges the seller's price for the buyer's zone, and pays it to the seller with the price", async () => {
    const { seller, buyer, dealId, deal } = await paidDelivery("FCT");
    const price = PRICE * 100;
    const fee = feeFor(price);
    expect(Number(deal.delivery_kobo)).toBe(800_000);
    expect(Number(deal.fee_kobo)).toBe(fee); // NosHen's fee is on the price only
    expect(Number(deal.amount_due_kobo)).toBe(price + fee + 800_000);
    expect(Number(deal.seller_share_kobo)).toBe(price + 800_000);

    // To another state, the tracking or waybill number is required.
    await expect(markSent(w.d, seller, dealId, { courier: "GIG Logistics", photoKeys: ["p/1.jpg", "p/2.jpg"] })).rejects.toThrow(/tracking or waybill/);
    await sendIt(w, seller, dealId, "GIG-4471902");
    await markDelivered(w.d, seller, dealId);
    await confirmReceived(w.d, buyer, dealId);
    await settleAll(w);
    const payout = (await w.db.query("select amount_kobo from transfers where deal_id = $1 and kind = 'payout'", [dealId])).rows[0];
    expect(Number(payout.amount_kobo)).toBe(price + 800_000);
    const b = await balances(w, dealId);
    expect(b.held_funds ?? 0).toBe(0);
    expect(b.fee_revenue).toBe(-fee);
  });

  it("charges the within-the-state price to a buyer in the same state, and free means free", async () => {
    const { dealId, deal } = await paidDelivery("Lagos");
    expect(Number(deal.delivery_kobo)).toBe(300_000);
    expect(await stateOf(w, dealId)).toBe("held");
    const { listing } = await deliveryListing({ deliveryLocalKobo: 0, deliveryOtherKobo: null });
    const buyer = await person(w, "Free Delivery");
    const free = await requestDeal(w.d, buyer, { listingId: listing, handover: "delivery", deliveryState: "Lagos" });
    expect(Number((await w.db.query("select delivery_kobo from deals where id = $1", [free])).rows[0].delivery_kobo)).toBe(0);
  });

  it("refuses delivery the seller doesn't offer, or without a state", async () => {
    const { listing: meetOnly } = await deliveryListing({});
    const buyer = await person(w, "Wants Delivery");
    await expect(requestDeal(w.d, buyer, { listingId: meetOnly, handover: "delivery", deliveryState: "Lagos" })).rejects.toThrow(/doesn't deliver this item/);
    const { listing: lagosOnly } = await deliveryListing({ deliveryLocalKobo: 250_000, deliveryOtherKobo: null });
    await expect(requestDeal(w.d, buyer, { listingId: lagosOnly, handover: "delivery", deliveryState: "Kano" })).rejects.toThrow(/doesn't deliver to Kano/);
    await expect(requestDeal(w.d, buyer, { listingId: lagosOnly, handover: "delivery" })).rejects.toThrow(/Choose the state/);
    // Meet-up never carries a delivery fee.
    const meet = await requestDeal(w.d, buyer, { listingId: lagosOnly, handover: "meetup", deliveryState: "Lagos" });
    expect((await w.db.query("select delivery_kobo, delivery_state from deals where id = $1", [meet])).rows[0]).toEqual({ delivery_kobo: "0", delivery_state: null });
  });

  it("refunds the delivery fee too when the seller never sends it", async () => {
    const { buyer, dealId, deal } = await paidDelivery("Oyo");
    await cancelDeal(w.d, buyer, dealId);
    await settleAll(w);
    const refund = (await w.db.query("select amount_kobo from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows[0];
    expect(Number(refund.amount_kobo)).toBe(Number(deal.amount_due_kobo));
  });

  it("needs packing photos to send, and can't be cancelled once sent", async () => {
    const { seller, buyer, dealId } = await paidDelivery("Lagos");
    await expect(markDelivered(w.d, seller, dealId)).rejects.toThrow(/Mark it sent first/);
    await expect(markSent(w.d, seller, dealId, { courier: "Dispatch rider", photoKeys: ["p/1.jpg"] })).rejects.toThrow(/at least 2 photos/);
    await expect(markSent(w.d, seller, dealId, { courier: "", photoKeys: ["p/1.jpg", "p/2.jpg"] })).rejects.toThrow(/who is delivering/);
    await expect(markSent(w.d, buyer, dealId, { courier: "Dispatch rider", photoKeys: ["p/1.jpg", "p/2.jpg"] })).rejects.toThrow(/Only the seller/);
    // Within the state, a dispatch rider without a tracking number is fine.
    await sendIt(w, seller, dealId);
    const sent = (await w.db.query("select sent_at, courier, tracking_ref, packing_photo_keys from deals where id = $1", [dealId])).rows[0];
    expect(sent).toMatchObject({ courier: "Dispatch rider", tracking_ref: null });
    expect(sent.packing_photo_keys).toHaveLength(2);
    expect(w.timers.some((t) => t.kind === "arrival_check" && t.dealId === dealId)).toBe(true);
    await expect(sendIt(w, seller, dealId)).rejects.toThrow(/can't be marked sent/);
    await expect(cancelDeal(w.d, buyer, dealId)).rejects.toThrow(/on its way/);
    await expect(cancelDeal(w.d, seller, dealId)).rejects.toThrow(/You've sent the item/);
    // The buyer can confirm as soon as it arrives, before the seller marks it delivered.
    await confirmReceived(w.d, buyer, dealId);
    expect(await stateOf(w, dealId)).toBe("released");
  });

  it("asks both people, once, when a delivery takes longer than usual, and doesn't call it overdue", async () => {
    const { seller, dealId } = await paidDelivery("Lagos");
    await sendIt(w, seller, dealId);
    w.clock.now = new Date(Date.now() + 40 * 3600_000);
    expect(await sweep(w.d, dealId)).toEqual([]);
    w.clock.now = new Date(Date.now() + 80 * 3600_000); // past 48 hours on the way, and past the 72-hour hand-over deadline
    expect(await sweep(w.d, dealId)).toEqual([`arrival check ${dealId}`]);
    expect(await sweep(w.d, dealId)).toEqual([]);
    w.clock.now = new Date();
    const sent = (await w.db.query("select template from notifications where deal_id = $1 and channel = 'in_app'", [dealId])).rows.map((r: any) => r.template);
    expect(sent.filter((t: string) => t === "arrival_check")).toHaveLength(2);
    expect(sent).not.toContain("handover_overdue");
    const alert = (await w.db.query("select kind, title from staff_alerts where url = $1", [`/deals/${dealId}`])).rows;
    expect(alert.some((a: any) => a.kind === "delivery_late")).toBe(true);
  });

  it("lets a seller change delivery prices on a live listing without changing deals already made", async () => {
    const { seller, listing } = await deliveryListing();
    const first = await requestDeal(w.d, await person(w, "First Buyer"), { listingId: listing, handover: "delivery", deliveryState: "Lagos" });
    await expect(setDelivery(w.d, seller, listing, { localKobo: -1, otherKobo: null })).rejects.toThrow(/0 for free/);
    await expect(setDelivery(w.d, seller, listing, { localKobo: 60_000_000, otherKobo: null })).rejects.toThrow(/up to ₦500,000/);
    await expect(setDelivery(w.d, seller, listing, { localKobo: NaN, otherKobo: null })).rejects.toThrow(/0 for free/);
    await expect(setDelivery(w.d, await person(w, "Not The Seller"), listing, { localKobo: 0, otherKobo: null })).rejects.toThrow(/isn't yours/);
    await setDelivery(w.d, seller, listing, { localKobo: 500_000, otherKobo: null });
    const second = await requestDeal(w.d, await person(w, "Second Buyer"), { listingId: listing, handover: "delivery", deliveryState: "Lagos" });
    const fees = (await w.db.query("select id, delivery_kobo from deals where id = any($1)", [[first, second]])).rows;
    expect(Number(fees.find((r: any) => r.id === first).delivery_kobo)).toBe(300_000);
    expect(Number(fees.find((r: any) => r.id === second).delivery_kobo)).toBe(500_000);
  });
});

describe("staff console", () => {
  it("removes a listing with a reason the seller sees, and logs it", async () => {
    const seller = await verifiedSeller(w, "Removed Seller");
    const listing = await liveListing(w, seller, 40_000, "Replica designer bag");
    await expect(moderateListing(w.d, staffId, listing, "remove", "no")).rejects.toThrow("Write a reason");
    await moderateListing(w.d, staffId, listing, "remove", "Counterfeit designer goods are prohibited");
    expect((await w.db.query("select status from listings where id = $1", [listing])).rows[0].status).toBe("removed");
    const note = (await w.db.query("select params from notifications where user_id = $1 and template = 'listing_removed' and channel = 'in_app'", [seller])).rows[0];
    expect(note.params.text).toContain("Counterfeit designer goods are prohibited");
    const log = (await w.db.query("select action from staff_actions where target_id = $1", [listing])).rows;
    expect(log.map((r) => r.action)).toEqual(["remove_listing"]);
    await expect(moderateListing(w.d, staffId, listing, "remove", "Again, to be sure")).rejects.toThrow("Only live");
  });

  it("approves a listing held for checks, and only that", async () => {
    const seller = await verifiedSeller(w, "Held Seller");
    const listing = await liveListing(w, seller, 40_000, "Held phone");
    await expect(moderateListing(w.d, staffId, listing, "approve", "Looks fine to me")).rejects.toThrow("Only listings held");
    await w.db.query("update listings set status = 'blocked' where id = $1", [listing]);
    await moderateListing(w.d, staffId, listing, "approve", "IMEI checked, not reported stolen");
    expect((await w.db.query("select status from listings where id = $1", [listing])).rows[0].status).toBe("live");
  });

  it("counts the dashboard numbers and finds people and listings", async () => {
    const o = await adminOverview(w.db);
    expect(o.days).toHaveLength(14);
    expect(o.liveListings).toBeGreaterThan(0);
    expect(o.byCategory.reduce((a, c) => a + c.n, 0)).toBe(o.liveListings);
    const people = await staffUsers(w.db, "held sell");
    expect(people.map((u: any) => u.full_name)).toContain("Held Seller");
    const found = await staffListings(w.db, { q: "replica", status: "removed" });
    expect(found.rows.map((r: any) => r.title)).toEqual(["Replica designer bag"]);
    expect(found.counts.removed).toBeGreaterThan(0);
  });
});

describe("anywhere in Nigeria", () => {
  const draft = (seller: string, place: { state: string; area: string }) =>
    saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "fashion", title: "Ankara dress", priceNaira: 20_000, condition: "good", sizeSystem: "letter", size: "M", ...place } as any);

  it("lists in any state, including Abuja, and finds it by state or by searching the area", async () => {
    const seller = await verifiedSeller(w, "Amina Bello");
    const kano = await draft(seller, { state: "Kano", area: "Nassarawa GRA" });
    await publish(w.d, seller, kano);
    const abuja = await draft(seller, { state: "FCT", area: "  Wuse   2 " });
    await publish(w.d, seller, abuja);
    expect((await w.db.query("select area, state from listings where id = $1", [abuja])).rows[0]).toEqual({ area: "Wuse 2", state: "FCT" });
    expect((await browse(w.db, { state: "Kano" })).map((l: any) => l.id)).toContain(kano);
    expect((await browse(w.db, { state: "Kano" })).map((l: any) => l.id)).not.toContain(abuja);
    expect((await browse(w.db, { q: "wuse" })).map((l: any) => l.id)).toContain(abuja);
    expect((await statesWithListings(w.db)).map((s) => s.state)).toEqual(expect.arrayContaining(["Kano", "FCT"]));
  });

  it("needs a size for shoes and clothes, of the right kind, and keeps it", async () => {
    const seller = await verifiedSeller(w, "Size Seller");
    const base = { title: "Air Max 90", priceNaira: 40_000, condition: "good" as const, state: "Lagos", area: "Yaba" };
    await expect(saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, category: "shoes" })).rejects.toThrow(/Choose the shoe size/);
    await expect(saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, category: "shoes", sizeSystem: "eu", size: "9.5" })).rejects.toThrow(/from the list/);
    const id = await saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, category: "shoes", sizeSystem: "uk", size: "9.5" });
    await publish(w.d, seller, id);
    const l = (await w.db.query("select size_system, size from listings where id = $1", [id])).rows[0];
    expect(l).toEqual({ size_system: "uk", size: "9.5" });
    expect(sizeLabel("shoes", l.size_system, l.size)).toBe("UK 9.5");
    expect(sizeLabel("fashion", "letter", "M")).toBe("M");
    expect(sizeLabel("fashion", "waist", "32 in")).toBe("Waist 32 in");
    // A phone has no size: anything sent is ignored.
    const phone = await saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, category: "phone", imeiOrSerial: "352918112999991", sizeSystem: "eu", size: "42" });
    expect((await w.db.query("select size from listings where id = $1", [phone])).rows[0].size).toBeNull();
  });

  it("filters Browse by price, condition, size and verified sellers", async () => {
    const seller = await verifiedSeller(w, "Filter Seller");
    const unverified = await person(w, "New Seller");
    const base = { title: "Filter test sneakers", condition: "good" as const, state: "Lagos", area: "Yaba", category: "shoes" as const };
    const a = await saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, priceNaira: 30_000, sizeSystem: "eu", size: "42" });
    await publish(w.d, seller, a);
    const b = await saveDraft(w.d, seller, null, ["a", "b", "c"], { ...base, priceNaira: 90_000, condition: "new", sizeSystem: "eu", size: "44" });
    await publish(w.d, seller, b);
    const c = await saveDraft(w.d, unverified, null, ["a", "b", "c"], { ...base, priceNaira: 40_000, sizeSystem: "uk", size: "8" });
    await w.db.query("update listings set status = 'live', published_at = now() where id = $1", [c]);
    const ids = async (f: Parameters<typeof browse>[1]) => (await browse(w.db, { q: "Filter test", ...f })).map((l: any) => l.id).sort();
    expect(await ids({ maxKobo: 5_000_000 })).toEqual([a, c].sort());
    expect(await ids({ minKobo: 5_000_000 })).toEqual([b]);
    expect(await ids({ conditions: ["new"] })).toEqual([b]);
    expect(await ids({ sizeSystem: "eu", sizes: ["42", "44"] })).toEqual([a, b].sort());
    expect(await ids({ verifiedOnly: true })).toEqual([a, b].sort());
  });

  it("refuses a made-up state, a missing area, and a street address", async () => {
    const seller = await verifiedSeller(w, "Wrong Place");
    await expect(draft(seller, { state: "Atlantis", area: "Yaba" })).rejects.toThrow("Choose the state");
    await expect(draft(seller, { state: "Oyo", area: " " })).rejects.toThrow("Add your area");
    await expect(draft(seller, { state: "Oyo", area: "12 Ring Road" })).rejects.toThrow("street address");
  });

  it("won't publish a listing without a state, even straight in the database", async () => {
    const seller = await verifiedSeller(w, "No State");
    await expect(w.db.query(
      "insert into listings (seller_id, category, title, price_kobo, condition, area, photo_keys, status) values ($1, 'fashion', 'Hat', 2000000, 'good', 'Yaba', '{a,b,c}', 'live')", [seller],
    )).rejects.toThrow(/listings_state_when_published/);
  });
});

describe("paying with USDT or USDC", () => {
  const SOL = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";

  async function acceptedDeal(price = 250_000) {
    const seller = await verifiedSeller(w, "Tunde Bakare");
    const buyer = await person(w, "Kofi Mensah");
    const listing = await liveListing(w, seller, price);
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
    await acceptDeal(w.d, seller, dealId);
    const due = Number((await w.db.query("select amount_due_kobo from deals where id = $1", [dealId])).rows[0].amount_due_kobo);
    return { seller, buyer, dealId, due };
  }
  const depositOf = async (dealId: string, coin: string, network: string) =>
    (await w.db.query("select * from crypto_deposits where deal_id = $1 and coin = $2 and network = $3", [dealId, coin, network])).rows[0];

  it("works out the coin amount, rounded up to the cent, and checks addresses for each network", () => {
    expect(coinMicroFor(25_375_000, 150_000)).toBe(169_170_000); // ₦253,750 at ₦1,500 = 169.1666… → 169.17
    expect(coinMicroFor(30_000_000, 150_000)).toBe(200_000_000);
    expect(koboForCoin(169_170_000, 150_000)).toBe(25_375_500);
    expect(coinMicroFor(85_000_000_000, 150_000)).toBe(566_666_670_000); // an ₦850M deal doesn't lose precision
    expect(coinAmount(169_170_000, "usdc")).toBe("169.17 USDC");
    expect(addressProblem("usdt", "solana", SOL)).toBeNull();
    expect(addressProblem("usdc", "solana", EVM)).toMatch(/isn't a Solana address/);
    expect(addressProblem("usdc", "base", EVM)).toBeNull();
    expect(addressProblem("usdt", "bsc", SOL)).toMatch(/starts with 0x/);
    expect(addressProblem("usdt", "bsc", "0x" + "0".repeat(40))).toMatch(/can't receive/);
    expect(addressProblem("usdc", "base", "")).toMatch(/your USDC address on Base/);
  });

  it("puts naira first in Nigeria and stablecoins first elsewhere, with what's coming", () => {
    expect(payPlanFor("NG", true)).toMatchObject({ bankFirst: true, crypto: true, soon: null });
    expect(payPlanFor("GH", true)).toMatchObject({ bankFirst: false, crypto: true, soon: "Mobile money in cedis is coming soon." });
    expect(payPlanFor("US", true)).toMatchObject({ bankFirst: false, soon: "Cards and local ways to pay in United States are coming." });
    expect(payPlanFor("GB", false)).toMatchObject({ bankFirst: true, crypto: false });
  });

  it("quotes the deal in both coins", async () => {
    const q = await cryptoQuotes(w.d, 18_777_500);
    expect(q).toMatchObject({ usdt: { micro: 125_190_000, rateKobo: 150_000 }, usdc: { micro: coinMicroFor(18_777_500, FAKE_RATE_KOBO.usdc), rateKobo: 149_800 }, test: true });
  });

  it("holds the money when the right USDT arrives in time, and refunds it as USDT to the buyer's address", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "solana");
    await expect(saveRefundAddress(w.d, buyer, dealId, "usdt", "solana", EVM)).rejects.toThrow(/isn't a Solana address/);
    await saveRefundAddress(w.d, buyer, dealId, "usdt", "solana", SOL);
    const dep = await depositOf(dealId, "usdt", "solana");
    expect(dep.address).toMatch(/^TEST0/); // a pretend address no wallet accepts
    expect(Number(dep.amount_micro)).toBe(coinMicroFor(due, FAKE_RATE_KOBO.usdt));
    expect(dep.refund_address_last4).toBe("VFin");

    await payCrypto(w, dealId, "usdt", "solana", Number(dep.amount_micro), due);
    const deal = (await w.db.query("select state, review_hold from deals where id = $1", [dealId])).rows[0];
    expect(deal).toMatchObject({ state: "held", review_hold: false });
    const pay = (await w.db.query("select method, coin, network, matches_buyer_name from payments where deal_id = $1", [dealId])).rows[0];
    expect(pay).toMatchObject({ method: "crypto", coin: "usdt", network: "solana", matches_buyer_name: null });

    await cancelDeal(w.d, buyer, dealId);
    await settleAll(w);
    expect(await stateOf(w, dealId)).toBe("refunded");
    const t = (await w.db.query("select status, partner_ref from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows[0];
    expect(t.status).toBe("succeeded");
    expect(t.partner_ref).toMatch(/^fake_cx_/); // sent by the crypto partner, not the bank
    const told = (await w.db.query("select params->>'text' as text from notifications where deal_id = $1 and template = 'refund_sent' and channel = 'in_app'", [dealId])).rows[0];
    expect(told.text).toMatch(/refunded as USDT to your Solana address ending VFin/);
    const b = await balances(w, dealId);
    expect(b.held_funds ?? 0).toBe(0);
    expect(b.refunds_due ?? 0).toBe(0);
  });

  it("takes USDC too, with its own address and amount, and refunds it as USDC", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "base");
    await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "base");
    await saveRefundAddress(w.d, buyer, dealId, "usdc", "base", EVM);
    const [t, c] = [await depositOf(dealId, "usdt", "base"), await depositOf(dealId, "usdc", "base")];
    expect(c.address).not.toBe(t.address);
    expect(Number(c.amount_micro)).toBe(coinMicroFor(due, FAKE_RATE_KOBO.usdc));
    await payCrypto(w, dealId, "usdc", "base", Number(c.amount_micro), due);
    expect(await stateOf(w, dealId)).toBe("held");
    await cancelDeal(w.d, buyer, dealId);
    const told = (await w.db.query("select params->>'text' as text from notifications where deal_id = $1 and template = 'refund_due' and channel = 'in_app'", [dealId])).rows[0];
    expect(told.text).toMatch(/refunded as USDC to your Base address ending 9EE7/);
    await settleAll(w);
  });

  it("gives the deal's address with nothing to fill in, and holds a refund until the buyer says where", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "base");
    const dep = await depositOf(dealId, "usdc", "base");
    expect(dep.address).toMatch(/^0xTEST/);
    expect(dep.refund_address_enc).toBeNull();
    await payCrypto(w, dealId, "usdc", "base", Number(dep.amount_micro), due);
    expect(await stateOf(w, dealId)).toBe("held");

    await cancelDeal(w.d, buyer, dealId);
    await settleAll(w);
    const waitingT = (await w.db.query("select status, partner_ref from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows[0];
    expect(waitingT).toEqual({ status: "pending", partner_ref: null }); // nothing sent: there's nowhere to send it yet
    const asked = (await w.db.query("select params->>'text' as text from notifications where deal_id = $1 and template = 'refund_due' and channel = 'in_app'", [dealId])).rows[0];
    expect(asked.text).toMatch(/ready to refund as USDC on Base\. Add your USDC on Base address in the deal/);
    expect(await refundsWaitingForAddress(w.d, buyer, dealId)).toMatchObject([{ coin: "usdc", network: "base", amountKobo: due }]);

    expect(await saveRefundAddress(w.d, buyer, dealId, "usdc", "base", EVM)).toBe(1);
    expect(await saveRefundAddress(w.d, buyer, dealId, "usdc", "base", EVM)).toBe(0); // saving again sends nothing twice
    await settleAll(w);
    const sentT = (await w.db.query("select status, partner_ref from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows;
    expect(sentT).toHaveLength(1);
    expect(sentT[0].status).toBe("succeeded");
    expect(await refundsWaitingForAddress(w.d, buyer, dealId)).toEqual([]);
    const b = await balances(w, dealId);
    expect(b.refunds_due ?? 0).toBe(0);
  });

  it("holds too little for review", async () => {
    const { buyer, dealId } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "base");
    const dep = await depositOf(dealId, "usdc", "base");
    const short = Number(dep.amount_micro) - 10_000_000;
    await payCrypto(w, dealId, "usdc", "base", short, koboForCoin(short, Number(dep.rate_kobo)));
    const deal = (await w.db.query("select state, review_hold, review_hold_reason from deals where id = $1", [dealId])).rows[0];
    expect(deal.state).toBe("held");
    expect(deal.review_hold).toBe(true);
    expect(deal.review_hold_reason).toMatch(/^Wrong amount: received .* USDC on Base/);
  });

  it("gets a new amount only once the old one runs out, and keeps the address", async () => {
    const { buyer, dealId } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "bsc");
    const first = await depositOf(dealId, "usdt", "bsc");
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "bsc", { refresh: true });
    expect((await depositOf(dealId, "usdt", "bsc")).quote_expires_at.getTime()).toBe(first.quote_expires_at.getTime());
    w.clock.now = new Date(w.clock.now.getTime() + 31 * 60_000);
    try {
      await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "bsc"); // opening the page again never changes the amount
      expect((await depositOf(dealId, "usdt", "bsc")).quote_expires_at.getTime()).toBe(first.quote_expires_at.getTime());
      await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "bsc", { refresh: true });
      const again = await depositOf(dealId, "usdt", "bsc");
      expect(again.quote_expires_at.getTime()).toBeGreaterThan(first.quote_expires_at.getTime());
      expect(again.address).toBe(first.address);
    } finally {
      w.clock.now = new Date();
    }
  });

  it("sends back a second payment for a deal already paid, on its own, and can still refund the first", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "bsc");
    await saveRefundAddress(w.d, buyer, dealId, "usdt", "bsc", EVM);
    const dep = await depositOf(dealId, "usdt", "bsc");
    await pay(w, dealId, due, "KOFI MENSAH"); // paid by bank transfer…
    await payCrypto(w, dealId, "usdt", "bsc", Number(dep.amount_micro), due); // …and with USDT too
    expect(await stateOf(w, dealId)).toBe("held");
    const pays = (await w.db.query("select method, sent_back from payments where deal_id = $1 order by received_at", [dealId])).rows;
    expect(pays).toEqual([{ method: "bank", sent_back: false }, { method: "crypto", sent_back: true }]);
    const check = (await w.db.query("select * from held_funds_check")).rows[0];
    expect(Number(check.ledger_held_kobo)).toBe(Number(check.open_deals_kobo));

    await cancelDeal(w.d, buyer, dealId);
    await settleAll(w);
    const refunds = (await w.db.query("select amount_kobo, status from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows;
    expect(refunds.map((r: any) => [Number(r.amount_kobo), r.status])).toEqual([[due, "succeeded"], [due, "succeeded"]]);
    const b = await balances(w, dealId);
    expect(b.held_funds ?? 0).toBe(0);
    expect(b.refunds_due ?? 0).toBe(0);
  });

  it("only takes crypto news from the crypto partner, and only from the buyer", async () => {
    const { seller, buyer, dealId } = await acceptedDeal();
    await expect(prepareCryptoPayment(w.d, seller, dealId, "usdt", "solana")).rejects.toThrow(/Only the buyer/);
    await expect(prepareCryptoPayment(w.d, buyer, dealId, "dai", "solana")).rejects.toThrow(/USDT or USDC/);
    await prepareCryptoPayment(w.d, buyer, dealId, "usdt", "solana");
    await expect(saveRefundAddress(w.d, seller, dealId, "usdt", "solana", SOL)).rejects.toThrow(/Only the buyer/);
    const dep = await depositOf(dealId, "usdt", "solana");
    const event = { id: "evt_" + crypto.randomUUID(), type: "crypto.received" as const,
      data: { deposit_ref: dep.provider_ref, coin: "usdt", network: "solana", amount_micro: Number(dep.amount_micro), amount_kobo: Number(dep.amount_kobo), tx_hash: "x", received_at: new Date().toISOString() } };
    await expect(handlePartnerEvent(w.d, event)).rejects.toThrow(/can't come from the bank partner/);
    expect(await stateOf(w, dealId)).toBe("accepted");
  });
});

describe("staff site actions", () => {
  const reviewer = () => ({ id: staffId, role: "reviewer" as const });

  it("freezes a seller: their listings leave Browse and can't be bought; unfreezing brings them back", async () => {
    const seller = await verifiedSeller(w, "Femi Ade");
    const buyer = await person(w, "Ngozi Eze");
    const listing = await liveListing(w, seller, 120_000, "Freeze test phone");
    await expect(setAccountStatus(w.d, reviewer(), seller, "frozen", "no")).rejects.toThrow(/at least 5 characters/);
    await setAccountStatus(w.d, reviewer(), seller, "frozen", "Reports of fake listings");
    expect((await browse(w.db, { q: "Freeze test phone" })).length).toBe(0);
    expect((await listingView(w.db, listing))!.listing.status).toBe("paused");
    await expect(requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" })).rejects.toThrow(/isn't available right now/);
    await expect(setAccountStatus(w.d, reviewer(), seller, "banned", "Confirmed fraud ring")).rejects.toThrow(/Only an admin/);
    await setAccountStatus(w.d, reviewer(), seller, "active", "Checked: listings are real");
    expect((await browse(w.db, { q: "Freeze test phone" })).length).toBe(1);
    const p = await staffPerson(w.db, seller);
    expect(p!.actions.map((a: any) => a.action)).toEqual(["reactivate_user", "freeze_user"]);
    const told = (await w.db.query("select params->>'text' as t from notifications where user_id = $1 and template = 'account_paused' and channel = 'in_app'", [seller])).rows[0];
    expect(told.t).not.toMatch(/fake listings/); // the reason stays with staff
  });

  it("sets and clears a seller's deal limit", async () => {
    const seller = await verifiedSeller(w, "Limit Test");
    await expect(setDealLimit(w.d, reviewer(), seller, 50, "Too small a limit")).rejects.toThrow(/at least ₦1,000/);
    await setDealLimit(w.d, reviewer(), seller, 50_000_000, "New seller with big items");
    expect((await sellerLimit(w.db, seller, await settingsOf(w.d))).capKobo).toBe(50_000_000);
    await setDealLimit(w.d, reviewer(), seller, null, "Back to normal after checks");
    expect((await sellerLimit(w.db, seller, await settingsOf(w.d))).capKobo).toBeNull(); // verified: no limit
  });

  it("unlocks a locked release code", async () => {
    const { seller, dealId } = await heldDeal();
    for (let i = 0; i < 5; i++) await releaseByCode(w.d, seller, dealId, "000000");
    expect((await staffCounts(w.db)).locked).toBeGreaterThan(0);
    expect((await staffDeals(w.db, { flag: "locked" })).rows.some((r: any) => r.id === dealId)).toBe(true);
    await unlockReleaseCode(w.d, reviewer(), dealId, "Buyer was reading an old code");
    const rc = (await w.db.query("select locked_until, failed_attempts from release_codes where deal_id = $1", [dealId])).rows[0];
    expect(rc).toEqual({ locked_until: null, failed_attempts: 0 });
    await expect(unlockReleaseCode(w.d, reviewer(), dealId, "Again for no reason")).rejects.toThrow(/isn't locked/);
    expect((await auditLog(w.db, { target: dealId })).rows[0].action).toBe("unlock_release_code");
  });

  it("sends a failed payout again, to the seller's bank account as it is now", async () => {
    const { seller, buyer, dealId } = await heldDeal();
    await releaseByCode(w.d, seller, dealId, await releaseCodeForBuyer(w.d, buyer, dealId));
    const first = (await w.db.query("select id from transfers where deal_id = $1 and kind = 'payout'", [dealId])).rows[0].id;
    w.settled.length = 0; // the bank rejects it instead
    await handlePartnerEvent(w.d, { id: "evt_fail_" + first, type: "transfer.failed", data: { transfer_id: first, partner_ref: "x", reason: "Account closed" } });
    expect((await staffDeals(w.db, { flag: "failed" })).rows.some((r: any) => r.id === dealId)).toBe(true);
    await retryTransfer(w.d, reviewer(), first, "Seller added a new account");
    await settleAll(w);
    const ts = (await w.db.query("select status from transfers where deal_id = $1 and kind = 'payout' order by created_at", [dealId])).rows.map((r: any) => r.status);
    expect(ts).toEqual(["failed", "succeeded"]);
    expect(await stateOf(w, dealId)).toBe("paid_out");
    const b = await balances(w, dealId);
    expect(b.seller_payable ?? 0).toBe(0); // paid once, not twice
    await expect(retryTransfer(w.d, reviewer(), first, "Try once more please")).rejects.toThrow(/already been sent again/);
    const v = await staffDeal(w.db, dealId);
    expect(v!.actions[0].action).toBe("retry_payout");
  });

  const told = async (userId: string, template: string) =>
    (await w.db.query("select params->>'text' as t from notifications where user_id = $1 and template = $2 and channel = 'in_app' order by id desc", [userId, template])).rows[0]?.t as string | undefined;

  it("refunds the buyer of a held deal in full, telling the seller why", async () => {
    const { seller, buyer, dealId, due } = await heldDeal();
    await expect(staffRefund(w.d, reviewer(), dealId, "no")).rejects.toThrow(/at least 5 characters/);
    await staffRefund(w.d, reviewer(), dealId, "Seller says the phone was stolen");
    await settleAll(w);
    expect(await stateOf(w, dealId)).toBe("refunded");
    const t = (await w.db.query("select amount_kobo, status from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows;
    expect(t.map((r: any) => [Number(r.amount_kobo), r.status])).toEqual([[due, "succeeded"]]);
    expect(await told(seller, "staff_refund")).toMatch(/phone was stolen/);
    expect(await told(buyer, "refund_due")).toBeTruthy();
    await expect(staffRefund(w.d, reviewer(), dealId, "Once more by mistake")).rejects.toThrow(/Only a deal whose money is held/);
    expect((await auditLog(w.db, { target: dealId, action: "refund_buyer" })).rows).toHaveLength(1);
  });

  it("lets only an admin release outside a dispute, and never past a review hold", async () => {
    const admin = { id: (await w.db.query("insert into staff (email, name, role) values ('ada-release@noshen.test', 'Ada', 'admin') returning id")).rows[0].id, role: "admin" as const };
    const { buyer, dealId } = await heldDeal();
    await expect(staffRelease(w.d, reviewer(), dealId, "Buyer phoned: has the item")).rejects.toThrow(/Only an admin/);
    const flagged = await heldDeal(250_000, "meetup", "SOMEBODY ELSE");
    await expect(staffRelease(w.d, admin, flagged.dealId, "Buyer phoned: has the item")).rejects.toThrow(/Clear the hold first/);
    await staffRelease(w.d, admin, dealId, "Buyer phoned: has the item, app won't open");
    await settleAll(w);
    expect(await stateOf(w, dealId)).toBe("paid_out");
    expect(await told(buyer, "staff_release")).toMatch(/app won't open/);
    expect((await auditLog(w.db, { target: dealId, action: "release_to_seller" })).rows).toHaveLength(1);
  });

  it("gives more time: added to the deadline, or to now once it has passed", async () => {
    const { buyer, seller, dealId } = await heldDeal();
    const before = new Date((await w.db.query("select handover_due_at from deals where id = $1", [dealId])).rows[0].handover_due_at).getTime();
    const due = await giveMoreTime(w.d, reviewer(), dealId, 1, "They agreed to meet on Saturday");
    expect(due.getTime() - before).toBe(24 * 3_600_000);
    await w.db.query("update deals set handover_due_at = now() - interval '5 hours' where id = $1", [dealId]);
    const later = await giveMoreTime(w.d, reviewer(), dealId, 2, "Seller travelling, back Monday");
    expect(Math.abs(later.getTime() - (Date.now() + 48 * 3_600_000))).toBeLessThan(60_000);
    expect(await told(buyer, "more_time")).toMatch(/hand-over/);
    expect(await told(seller, "more_time")).toMatch(/hand-over/);
    await expect(giveMoreTime(w.d, reviewer(), dealId, 7, "A whole week please")).rejects.toThrow(/1, 2 or 3 days/);
  });

  it("opens a dispute for the buyer, freezing the money; the refund then waits for the decision", async () => {
    const { buyer, dealId } = await heldDeal();
    await openDisputeForBuyer(w.d, reviewer(), dealId, "not_working", "Buyer phoned: screen dead after one day");
    expect(await stateOf(w, dealId)).toBe("disputed");
    const x = (await w.db.query("select opened_by, reason, description from disputes where deal_id = $1", [dealId])).rows[0];
    expect(x).toEqual({ opened_by: buyer, reason: "not_working", description: "Buyer phoned: screen dead after one day" });
    expect(await told(buyer, "problem_reported")).toMatch(/NosHen opened a dispute for you/);
    await expect(openDisputeForBuyer(w.d, reviewer(), dealId, "other", "Second report by phone")).rejects.toThrow(/already has a dispute/);
    await expect(staffRefund(w.d, reviewer(), dealId, "Refund it straight away")).rejects.toThrow(/Decide it from the dispute/);
  });

  it("cancels a deal before payment, and sends both a note", async () => {
    const seller = await verifiedSeller(w, "Kemi Lawal");
    const buyer = await person(w, "Ibrahim Musa");
    const dealId = await requestDeal(w.d, buyer, { listingId: await liveListing(w, seller, 90_000, "Cancel test fan"), handover: "meetup" });
    await noteToBoth(w.d, reviewer(), dealId, "Please keep all payments inside NosHen.");
    expect(await told(buyer, "staff_note")).toBe("Message from NosHen: Please keep all payments inside NosHen.");
    expect(await told(seller, "staff_note")).toBe("Message from NosHen: Please keep all payments inside NosHen.");
    await staffCancel(w.d, reviewer(), dealId, "Seller asked us to cancel: item damaged");
    expect(await stateOf(w, dealId)).toBe("declined");
    expect(await told(buyer, "staff_cancel")).toMatch(/item damaged/);
    const held = await heldDeal();
    await expect(staffCancel(w.d, reviewer(), held.dealId, "Cancel this one too")).rejects.toThrow(/refund the buyer instead/);
  });

  it("checks one deal's deadlines on request", async () => {
    const { dealId } = await heldDeal();
    const done = await checkDeadlinesNow(w.d, reviewer(), dealId);
    expect(done).toEqual([]);
    expect((await auditLog(w.db, { target: dealId, action: "check_deadlines" })).rows).toHaveLength(1);
  });
});

describe("units: selling more than one of the same thing", () => {
  it("sells one per deal, says how many are left, and is sold when the last one goes", async () => {
    const seller = await verifiedSeller(w, "Units Seller");
    const id = await saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "beauty", title: "Units test perfume", priceNaira: 25_000, condition: "new", state: "Lagos", area: "Ikeja", quantity: 2 });
    await publish(w.d, seller, id);
    await expect(saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "beauty", title: "Too many", priceNaira: 25_000, condition: "new", state: "Lagos", area: "Ikeja", quantity: 1000 })).rejects.toThrow(/between 1 and 999/);

    const [b1, b2, b3] = [await person(w, "Ada One"), await person(w, "Bola Two"), await person(w, "Chidi Three")];
    const d1 = await requestDeal(w.d, b1, { listingId: id, handover: "meetup" });
    const d2 = await requestDeal(w.d, b2, { listingId: id, handover: "meetup" });
    const d3 = await requestDeal(w.d, b3, { listingId: id, handover: "meetup" });
    await acceptDeal(w.d, seller, d1);
    expect(await stateOf(w, d2)).toBe("requested"); // one unit still free: the others keep waiting
    await acceptDeal(w.d, seller, d2);
    expect(await stateOf(w, d3)).toBe("declined"); // the last unit is taken: the rest are told
    const due = async (dealId: string) => Number((await w.db.query("select amount_due_kobo from deals where id = $1", [dealId])).rows[0].amount_due_kobo);

    for (const [deal, buyer, name] of [[d1, b1, "ADA ONE"], [d2, b2, "BOLA TWO"]] as const) {
      await pay(w, deal, await due(deal), name);
      await releaseByCode(w.d, seller, deal, await releaseCodeForBuyer(w.d, buyer, deal));
      const l = (await w.db.query("select status, sold_count from listings where id = $1", [id])).rows[0];
      expect(l).toEqual(deal === d1 ? { status: "live", sold_count: 1 } : { status: "sold", sold_count: 2 });
    }
    const shown = (await browse(w.db, { q: "Units test perfume" }))[0];
    expect(shown).toMatchObject({ status: "sold", quantity: 2, sold_count: 2 }); // still in Browse, marked sold
    const b4 = await person(w, "Dayo Four");
    await expect(requestDeal(w.d, b4, { listingId: id, handover: "meetup" })).rejects.toThrow(/isn't available/);

    await expect(deleteSoldListings(w.d, { id: staffId, role: "reviewer" }, [id])).resolves.toBe(1);
    expect((await w.db.query("select status from listings where id = $1", [id])).rows[0].status).toBe("removed");
    expect(await browse(w.db, { q: "Units test perfume" })).toEqual([]);
    await expect(deleteSoldListings(w.d, { id: staffId, role: "reviewer" }, [id])).rejects.toThrow(/Only a sold listing/);
  });
});

describe("a payment from someone else's account", () => {
  it("is held; the buyer can say who paid, and the reviewer sees it", async () => {
    const { buyer, dealId } = await heldDeal(250_000, "meetup", "ADEBAYO JOHNSON");
    const deal = (await w.db.query("select review_hold, review_hold_reason from deals where id = $1", [dealId])).rows[0];
    expect(deal.review_hold).toBe(true);
    await expect(explainHold(w.d, buyer, dealId, "someone_i_know", "")).rejects.toThrow(/Say who paid/);
    await explainHold(w.d, buyer, dealId, "someone_i_know", "My brother, Adebayo Johnson");
    const after = (await w.db.query("select hold_payer, hold_note from deals where id = $1", [dealId])).rows[0];
    expect(after).toEqual({ hold_payer: "someone_i_know", hold_note: "My brother, Adebayo Johnson" });
    await explainHold(w.d, buyer, dealId, "unknown", ""); // they can change their answer
    expect((await w.db.query("select hold_payer from deals where id = $1", [dealId])).rows[0].hold_payer).toBe("unknown");
    await cancelDeal(w.d, buyer, dealId); // or back out: refunded to the account it came from
    expect(await stateOf(w, dealId)).toBe("refunded");
    await expect(explainHold(w.d, buyer, dealId, "unknown", "")).rejects.toThrow(/isn't being checked/);
    await settleAll(w);
  });

  it("isn't held when the sender's name matches the buyer's ID-checked name", async () => {
    const seller = await verifiedSeller(w, "Tunde Bakare");
    const buyer = await person(w, "Rex John");
    await w.db.query("insert into kyc_checks (user_id, type, provider, provider_ref, result, verified_name, checked_at) values ($1, 'nin', 'fake', 'x', 'verified', 'UGOCHUKWU REX JOHN', now())", [buyer]);
    const listing = await liveListing(w, seller, 100_000);
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
    await acceptDeal(w.d, seller, dealId);
    const due = Number((await w.db.query("select amount_due_kobo from deals where id = $1", [dealId])).rows[0].amount_due_kobo);
    await pay(w, dealId, due, "UGOCHUKWU REX JOHN");
    expect((await w.db.query("select state, review_hold from deals where id = $1", [dealId])).rows[0]).toEqual({ state: "held", review_hold: false });
  });
});

describe("staff alerts", () => {
  it("queues an alert when a payment needs checking or a dispute is opened, and sends each once to staff devices", async () => {
    const { flushStaffAlerts } = await import("@noshen/engine/staff-alerts");
    const { newVapidKeys, b64u } = await import("@noshen/engine/push");
    await w.db.query("delete from staff_alerts");
    const { dealId } = await heldDeal(250_000, "meetup", "SOMEONE ELSE ENTIRELY");
    const { buyer, dealId: d2 } = await heldDeal();
    await reportProblem(w.d, buyer, d2, { reason: "not_as_described", description: "Screen is cracked" });
    const alerts = (await w.db.query("select kind, title, url from staff_alerts where sent_at is null order by id")).rows;
    expect(alerts.map((a: any) => a.kind)).toEqual(["review_hold", "dispute"]);
    expect(alerts[0].url).toBe(`/holds/${dealId}`);
    expect(alerts[1].title).toMatch(/^New dispute: /);

    // One staff device; the push service is stubbed.
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    await w.db.query("insert into staff_push_subscriptions (staff_id, endpoint, p256dh, auth) values ($1, 'https://push.example/staff-1', $2, $3)",
      [staffId, b64u.encode(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))), b64u.encode(new Uint8Array(16))]);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return new Response(null, { status: 201 }); });
    try {
      const keys = await newVapidKeys();
      const d = { ...w.d, push: { ...keys, subject: "https://noshen.example" } };
      expect(await flushStaffAlerts(d)).toBe(2);
      expect(calls).toEqual(["https://push.example/staff-1", "https://push.example/staff-1"]);
      expect(await flushStaffAlerts(d)).toBe(0); // each alert goes once
    } finally {
      vi.unstubAllGlobals();
      await w.db.query("delete from staff_push_subscriptions");
    }
  });
});

describe("waitlist", () => {
  it("takes an email for a country NosHen hasn't opened in, once, and counts it", async () => {
    const { joinWaitlist, waitlistCounts } = await import("@noshen/engine/waitlist");
    const email = `wait${Date.now()}@example.com`;
    await joinWaitlist(w.d, email, "KE", "pcm");
    await joinWaitlist(w.d, ` ${email.toUpperCase()} `, "KE"); // the same person again: nothing changes
    await expect(joinWaitlist(w.d, email, "NG")).rejects.toThrow(/coming to/);
    await expect(joinWaitlist(w.d, email, "US")).rejects.toThrow(/coming to/);
    await expect(joinWaitlist(w.d, "not-an-email", "GH")).rejects.toThrow(/@/);
    const rows = (await w.db.query("select country, lang from waitlist where email = $1", [email])).rows;
    expect(rows).toEqual([{ country: "KE", lang: "pcm" }]);
    expect((await waitlistCounts(w.db)).find((c) => c.country === "KE")!.n).toBeGreaterThanOrEqual(1);
  });
});

describe("services paid in stages", () => {
  const PRICE = 200_000; // ₦200,000 for the job
  async function job(stages = [{ title: "Work starts", percent: 30 }, { title: "Work finished", percent: 70 }]) {
    const seller = await verifiedSeller(w, "Bisi Fixes");
    const buyer = await person(w, "Ngozi Stage");
    const listing = await saveDraft(w.d, seller, null, ["a", "b", "c"], {
      category: "services", title: "Kitchen cabinets, built and fitted", priceNaira: PRICE, condition: undefined as any, state: "Lagos", area: "Surulere", stages,
    });
    await publish(w.d, seller, listing);
    const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "delivery", deliveryState: "Kano" });
    await acceptDeal(w.d, seller, dealId);
    const due = Number((await w.db.query("select amount_due_kobo from deals where id = $1", [dealId])).rows[0].amount_due_kobo);
    await pay(w, dealId, due, "NGOZI STAGE");
    return { seller, buyer, dealId, due };
  }
  const held = async (dealId: string) => Number((await w.db.query(
    "select coalesce(sum(credit_kobo - debit_kobo), 0) as n from ledger_entries where account = 'held_funds' and deal_id = $1", [dealId])).rows[0].n);
  const checkHeld = async () => {
    const r = (await w.db.query("select ledger_held_kobo, open_deals_kobo from held_funds_check")).rows[0];
    expect(Number(r.ledger_held_kobo)).toBe(Number(r.open_deals_kobo));
  };

  it("splits the price and fee into the stages, and the request is a job: no delivery", async () => {
    const { dealId } = await job();
    const deal = (await w.db.query("select kind, handover, delivery_kobo, fee_kobo, price_kobo from deals where id = $1", [dealId])).rows[0];
    expect(deal).toMatchObject({ kind: "service", handover: "meetup", delivery_kobo: "0" });
    const stages = (await w.db.query("select n, title, share_kobo, fee_kobo from deal_stages where deal_id = $1 order by n", [dealId])).rows;
    expect(stages.map((s: any) => s.title)).toEqual(["Work starts", "Work finished"]);
    expect(stages.reduce((n: number, s: any) => n + Number(s.share_kobo), 0)).toBe(Number(deal.price_kobo));
    expect(stages.reduce((n: number, s: any) => n + Number(s.fee_kobo), 0)).toBe(Number(deal.fee_kobo));
    expect(Number(stages[0].share_kobo)).toBe(PRICE * 100 * 0.3);
  });

  it("releases a stage at a time, pays each, then closes the deal on the last one", async () => {
    const { seller, buyer, dealId, due } = await job();
    await markStageDone(w.d, seller, dealId);
    await expect(markStageDone(w.d, seller, dealId)).rejects.toThrow(/already marked done/);
    await releaseNextStage(w.d, buyer, dealId);
    const s1 = (await w.db.query("select share_kobo, fee_kobo, released_by from deal_stages where deal_id = $1 and n = 1", [dealId])).rows[0];
    expect(s1.released_by).toBe("buyer");
    expect(await stateOf(w, dealId)).toBe("held");
    expect(await held(dealId)).toBe(due - Number(s1.share_kobo) - Number(s1.fee_kobo));
    await checkHeld();
    await expect(cancelDeal(w.d, buyer, dealId)).rejects.toThrow(/already released/);
    await releaseNextStage(w.d, buyer, dealId);
    expect(await stateOf(w, dealId)).toBe("released");
    expect(await held(dealId)).toBe(0);
    await settleAll(w);
    expect(await stateOf(w, dealId)).toBe("paid_out");
    const payouts = (await w.db.query("select stage, amount_kobo from transfers where deal_id = $1 and kind = 'payout' order by stage", [dealId])).rows;
    expect(payouts.map((p: any) => p.stage)).toEqual([1, 2]);
    expect(payouts.reduce((n: number, p: any) => n + Number(p.amount_kobo), 0)).toBe(PRICE * 100);
    const b = await balances(w, dealId);
    expect(b.seller_payable ?? 0).toBe(0);
    expect(-(b.fee_revenue ?? 0)).toBe(due - PRICE * 100);
    await checkHeld();
  });

  it("refunds only what's still held when a dispute is decided for the buyer", async () => {
    const { buyer, dealId, due } = await job();
    await releaseNextStage(w.d, buyer, dealId);
    const left = await held(dealId);
    expect(left).toBeLessThan(due);
    await reportProblem(w.d, buyer, dealId, { reason: "not_as_described", description: "The doors don't close" });
    const disputeId = (await w.db.query("select id from disputes where deal_id = $1", [dealId])).rows[0].id;
    await decideDispute(w.d, staffId, disputeId, "refund_buyer", "Photos show the doors don't close; the second stage wasn't done");
    expect(await stateOf(w, dealId)).toBe("refunded");
    await settleAll(w);
    const refund = (await w.db.query("select amount_kobo from transfers where deal_id = $1 and kind = 'refund'", [dealId])).rows[0];
    expect(Number(refund.amount_kobo)).toBe(left);
    expect(await held(dealId)).toBe(0);
    await checkHeld();
  });

  it("releases a stage by itself when it was marked done and nobody acted in time", async () => {
    const { seller, dealId } = await job([{ title: "Deposit", percent: 50 }, { title: "Fitting", percent: 25 }, { title: "Finished", percent: 25 }]);
    await markStageDone(w.d, seller, dealId);
    expect(w.timers.some((t) => t.kind === "stage_release" && t.dealId === dealId)).toBe(true);
    expect(await sweep(w.d, dealId)).toEqual([]);
    w.clock.now = new Date(Date.now() + 73 * 3600_000);
    expect(await sweep(w.d, dealId)).toContain(`stage released ${dealId}`);
    w.clock.now = new Date();
    const r = (await w.db.query("select n, released_by from deal_stages where deal_id = $1 and released_at is not null", [dealId])).rows;
    expect(r).toEqual([{ n: 1, released_by: "timer" }]);
    expect(await stateOf(w, dealId)).toBe("held");
  });

  it("lets staff give the buyer more time to check a stage marked done", async () => {
    const { seller, dealId } = await job();
    await markStageDone(w.d, seller, dealId);
    const before = (await w.db.query("select release_due_at from deal_stages where deal_id = $1 and n = 1", [dealId])).rows[0].release_due_at as Date;
    const due = await giveMoreTime(w.d, { id: staffId, role: "reviewer" as const }, dealId, 2, "Buyer is travelling and asked to check on Monday");
    expect(due.getTime() - before.getTime()).toBe(48 * 3600_000);
    const after = (await w.db.query("select release_due_at from deal_stages where deal_id = $1 and n = 1", [dealId])).rows[0].release_due_at as Date;
    expect(after.getTime()).toBe(due.getTime());
    expect(Number((await w.db.query("select count(*) as n from staff_actions where target_id = $1 and action = 'give_more_time'", [dealId])).rows[0].n)).toBe(1);
  });

  it("needs stages that add up to 100%", async () => {
    const seller = await verifiedSeller(w, "Bad Stages");
    await expect(saveDraft(w.d, seller, null, ["a", "b", "c"], {
      category: "services", title: "Painting", priceNaira: 50_000, condition: undefined as any, state: "Lagos", area: "Yaba",
      stages: [{ title: "Start", percent: 30 }, { title: "End", percent: 60 }],
    })).rejects.toThrow(/add up to 90%/);
  });
});

describe("checkout links", () => {
  it("keeps a link-only listing out of Browse and the shop, and accepts its buyers at once", async () => {
    const seller = await verifiedSeller(w, "Ada Links");
    const buyer = await person(w, "Kemi Link");
    const id = await saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "fashion", title: "Ankara two-piece, made to order", priceNaira: 30_000, condition: "new", state: "Lagos", area: "Ikeja", sizeSystem: "letter", size: "M" });
    await publish(w.d, seller, id, "link");
    expect((await one(w.db, "select visibility from listings where id = $1", [id])).visibility).toBe("link");
    expect((await browse(w.db, { q: "ankara" })).map((l: any) => l.id)).not.toContain(id);
    expect((await sellerShop(w.db, seller))!.listings.map((l: any) => l.id)).not.toContain(id);
    // Anyone with the link can still open it and buy.
    expect((await listingView(w.db, id))!.listing.status).toBe("live");
    const dealId = await requestDeal(w.d, buyer, { listingId: id, handover: "meetup" });
    expect(await stateOf(w, dealId)).toBe("accepted");

    // Shown on NosHen: in Browse and the shop, and buyers wait for the seller to accept again.
    await setVisibility(w.d, seller, id, "public");
    expect((await browse(w.db, { q: "ankara" })).map((l: any) => l.id)).toContain(id);
    expect((await sellerShop(w.db, seller))!.listings.map((l: any) => l.id)).toContain(id);
    const other = await person(w, "Tolu Public");
    expect(await stateOf(w, await requestDeal(w.d, other, { listingId: id, handover: "meetup" }))).toBe("requested");
    await expect(setVisibility(w.d, buyer, id, "link")).rejects.toThrow(/isn't yours/);
  });
});

describe("a seller's track record", () => {
  it("counts deals, problem-free deals, purchases and how fast they answer", async () => {
    const seller = await verifiedSeller(w, "Record Keeper");
    const fresh = await sellerSummary(w.db, seller);
    expect(fresh).toMatchObject({ completedDeals: 0, purchases: 0, disputesLost: 0, problemFree: null, replyMinutes: null });
    // One deal closed well, one lost in a dispute.
    for (const outcome of ["released", "refunded"] as const) {
      const buyer = await person(w, `Buyer ${outcome}`);
      const listing = await liveListing(w, seller, 100_000, `Phone for ${outcome}`);
      const dealId = await requestDeal(w.d, buyer, { listingId: listing, handover: "meetup" });
      await acceptDeal(w.d, seller, dealId);
      const due = Number((await one(w.db, "select amount_due_kobo from deals where id = $1", [dealId])).amount_due_kobo);
      await pay(w, dealId, due, `BUYER ${outcome.toUpperCase()}`);
      if (outcome === "released") await releaseByCode(w.d, seller, dealId, await releaseCodeForBuyer(w.d, buyer, dealId));
      else {
        await reportProblem(w.d, buyer, dealId, { reason: "not_as_described", description: "Screen is cracked" });
        const disputeId = (await one(w.db, "select id from disputes where deal_id = $1", [dealId])).id;
        await decideDispute(w.d, staffId, disputeId, "refund_buyer", "The photos show a cracked screen the listing didn't mention");
      }
    }
    const r = await sellerSummary(w.db, seller);
    expect(r).toMatchObject({ completedDeals: 1, disputesLost: 1, problemFree: 50 });
    // Browse cards carry the same record, for the trust badge.
    const card = (await browse(w.db, { q: "Phone for released" })).find((l: any) => l.title === "Phone for released");
    expect(card?.seller).toEqual({ level: "building", deals: 1 });
    expect(card).not.toHaveProperty("seller_id");
    expect(r.replyMinutes).toBeGreaterThanOrEqual(1);
    expect(new Date(r.memberSince).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("check a seller", () => {
  const staff = () => ({ id: staffId, role: "reviewer" as const });

  it("shows a handle only once staff have seen the seller's code, and finds it however it's typed", async () => {
    const seller = await verifiedSeller(w, "Ada Styles");
    const h = await addHandle(w.d, seller, "instagram", "@Ada.Styles");
    expect(h).toMatchObject({ platform: "instagram", handle: "ada.styles", status: "added" });
    expect(h.code).toMatch(/^NOSHEN-[A-Z2-9]{4}$/);
    expect((await addHandle(w.d, seller, "instagram", "https://www.instagram.com/ada.styles/?igsh=abc")).id).toBe(h.id);
    // Not findable until it's checked.
    expect((await checkSeller(w.db, "@ada.styles")).matches).toEqual([]);
    await submitHandle(w.d, seller, h.id);
    expect(Number((await one(w.db, "select count(*) as n from staff_alerts where kind = 'handle_check'")).n)).toBeGreaterThan(0);
    expect((await handlesToCheck(w.db)).map((r: any) => r.id)).toContain(h.id);
    await decideHandle(w.d, staff(), h.id, true, "Code in the bio on 19 Oct");
    for (const q of ["@ada.styles", "Ada.Styles", "instagram.com/ada.styles", "https://www.instagram.com/ada.styles/"]) {
      const r = await checkSeller(w.db, q);
      expect(r.matches.map((m) => m.seller.id)).toEqual([seller]);
    }
    // The same name on another platform is someone else's until verified there.
    expect((await checkSeller(w.db, "tiktok.com/@ada.styles")).matches).toEqual([]);
    expect(await verifiedHandles(w.db, seller)).toEqual([{ platform: "instagram", handle: "ada.styles" }]);
    expect(Number((await one(w.db, "select count(*) as n from staff_actions where action = 'verify_handle' and target_id = $1", [seller])).n)).toBe(1);
  });

  it("keeps a verified handle to its seller, and turns away other claims to it", async () => {
    const owner = await verifiedSeller(w, "Real Vendor");
    const copycat = await verifiedSeller(w, "Copy Cat");
    const fake = await addHandle(w.d, copycat, "x", "realvendor");
    const real = await addHandle(w.d, owner, "x", "@realvendor");
    await submitHandle(w.d, owner, real.id);
    await decideHandle(w.d, staff(), real.id, true, "Code in the bio");
    expect((await one(w.db, "select status, reject_reason from social_handles where id = $1", [fake.id]))).toEqual({ status: "rejected", reject_reason: "Verified for another seller." });
    await expect(addHandle(w.d, copycat, "x", "realvendor")).rejects.toThrow(/already verified for another/);
    expect((await checkSeller(w.db, "@realvendor")).matches.map((m) => m.seller.id)).toEqual([owner]);
  });

  it("tells the seller why when the code isn't there, and lets them send it again", async () => {
    const seller = await verifiedSeller(w, "Try Again");
    const h = await addHandle(w.d, seller, "tiktok", "tryagain.ng");
    await submitHandle(w.d, seller, h.id);
    await decideHandle(w.d, staff(), h.id, false, "The code isn't in the bio.");
    const note = await one(w.db, "select params from notifications where user_id = $1 and template = 'handle_rejected' order by created_at desc limit 1", [seller]);
    expect(note.params.text).toContain("The code isn't in the bio.");
    await submitHandle(w.d, seller, h.id);
    expect((await one(w.db, "select status from social_handles where id = $1", [h.id])).status).toBe("submitted");
  });

  it("needs an ID check and a real handle, and hides sellers who can't sell", async () => {
    const noId = await person(w, "No Id Yet");
    await expect(addHandle(w.d, noId, "instagram", "noid.yet")).rejects.toThrow(/Verify your ID/);
    const seller = await verifiedSeller(w, "Frozen Shop");
    await expect(addHandle(w.d, seller, "x", "this_is_far_too_long_for_x")).rejects.toThrow(/doesn't look like/);
    await expect(addHandle(w.d, seller, "instagram", "tiktok.com/@frozen")).rejects.toThrow(/TikTok link/);
    const h = await addHandle(w.d, seller, "facebook", "frozen.shop");
    await submitHandle(w.d, seller, h.id);
    await decideHandle(w.d, staff(), h.id, true, "Code in the bio");
    expect((await checkSeller(w.db, "frozen.shop")).matches).toHaveLength(1);
    await w.db.query("update users set status = 'frozen' where id = $1", [seller]);
    expect((await checkSeller(w.db, "frozen.shop")).matches).toEqual([]);
    expect((await checkSeller(w.db, "not a handle!")).query).toBeNull();
    await removeHandle(w.d, seller, h.id);
    await expect(removeHandle(w.d, noId, h.id)).rejects.toThrow(/isn't yours/);
  });
});

describe("profile pictures", () => {
  it("sets, replaces and removes a photo, and shows it with the person's track record", async () => {
    const u = await verifiedSeller(w, "Photo Person");
    const a = `avatars/${u}/${crypto.randomUUID()}.webp`;
    const b = `avatars/${u}/${crypto.randomUUID()}.webp`;
    expect(await setProfilePhoto(w.d, u, a)).toBeNull();
    expect((await sellerSummary(w.db, u)).photo).toBe(a);
    expect(await setProfilePhoto(w.d, u, b)).toBe(a);
    const other = await person(w, "Someone Else");
    await expect(setProfilePhoto(w.d, other, b)).rejects.toThrow(/isn't yours/);
    expect(await setProfilePhoto(w.d, u, null)).toBe(b);
    expect((await sellerSummary(w.db, u)).photo).toBeNull();
  });

  it("lets staff take a photo down, telling the person why", async () => {
    const u = await verifiedSeller(w, "Borrowed Face");
    const key = `avatars/${u}/${crypto.randomUUID()}.jpg`;
    await setProfilePhoto(w.d, u, key);
    const reviewer = { id: staffId, role: "reviewer" as const };
    expect(await removeProfilePhoto(w.d, reviewer, u, "It's a bank's logo, not theirs")).toBe(key);
    expect((await sellerSummary(w.db, u)).photo).toBeNull();
    const note = await one(w.db, "select params from notifications where user_id = $1 and template = 'photo_removed'", [u]);
    expect(note.params.text).toContain("a bank's logo");
    expect(Number((await one(w.db, "select count(*) as n from staff_actions where action = 'remove_profile_photo' and target_id = $1", [u])).n)).toBe(1);
    await expect(removeProfilePhoto(w.d, reviewer, u, "Again, for the test")).rejects.toThrow(/no profile picture/);
  });
});
