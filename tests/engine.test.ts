import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, person, verifiedSeller, liveListing, pay, payUsdt, settleAll, balances, stateOf, type TestWorld } from "./helpers";
import {
  requestDeal, sellerLimit, acceptDeal, releaseByCode, releaseCodeForBuyer, markDelivered, confirmReceived, cancelDeal, handlePartnerEvent, sendMessage, rate,
} from "@noshen/engine/deals";
import { reportProblem, decideDispute, resolveReviewHold, addEvidence } from "@noshen/engine/disputes";
import { sweep } from "@noshen/engine/sweep";
import { DealError, settingsOf } from "@noshen/engine/core";
import { feeFor, naira } from "@noshen/shared/money";
import { saveDraft, publish } from "@noshen/engine/sellers";
import { moderateListing } from "@noshen/engine/staff";
import { adminOverview, browse, staffListings, staffUsers, statesWithListings } from "@noshen/engine/queries";
import { prepareUsdtPayment } from "@noshen/engine/usdt";
import { FAKE_USDT_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import { koboForUsdt, payPlanFor, usdtAddressProblem, usdtMicroFor } from "@noshen/shared/payments";

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

describe("listings across the marketplace", () => {
  const draft = (seller: string, input: Partial<Parameters<typeof saveDraft>[4] & object>) =>
    saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "other", title: "Something", priceNaira: 20_000, condition: "good", state: "Lagos", area: "Yaba", ...input } as any);

  it("publishes clothes, shoes and hair without an ID number", async () => {
    const seller = await verifiedSeller(w, "Kunle Adeyemi");
    const dress = await draft(seller, { category: "fashion", title: "Ankara maxi dress, size 12", priceNaira: 18_000 });
    expect(await publish(w.d, seller, dress)).toBe("live");
    const shoes = await draft(seller, { category: "shoes", title: "Nike Air Force 1, size 43", priceNaira: 45_000 });
    expect(await publish(w.d, seller, shoes)).toBe("live");
    const wig = await draft(seller, { category: "hair", title: "Bone straight wig, 22 inches", priceNaira: 185_000 });
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
    saveDraft(w.d, seller, null, ["a", "b", "c"], { category: "fashion", title: "Ankara dress", priceNaira: 20_000, condition: "good", ...place } as any);

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

describe("paying with USDT", () => {
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
  const depositOf = async (dealId: string, network: string) =>
    (await w.db.query("select * from crypto_deposits where deal_id = $1 and network = $2", [dealId, network])).rows[0];

  it("works out the USDT, rounded up to the cent, and checks addresses for each network", () => {
    expect(usdtMicroFor(25_375_000, 150_000)).toBe(169_170_000); // ₦253,750 at ₦1,500 = 169.1666… → 169.17 USDT
    expect(usdtMicroFor(30_000_000, 150_000)).toBe(200_000_000);
    expect(koboForUsdt(169_170_000, 150_000)).toBe(25_375_500);
    expect(usdtMicroFor(85_000_000_000, 150_000)).toBe(566_666_670_000); // an ₦850M deal doesn't lose precision
    expect(usdtAddressProblem("solana", SOL)).toBeNull();
    expect(usdtAddressProblem("solana", EVM)).toMatch(/isn't a Solana address/);
    expect(usdtAddressProblem("base", EVM)).toBeNull();
    expect(usdtAddressProblem("ethereum", SOL)).toMatch(/starts with 0x/);
    expect(usdtAddressProblem("bsc", "0x" + "0".repeat(40))).toMatch(/can't receive/);
  });

  it("puts naira first in Nigeria and USDT first elsewhere, with what's coming", () => {
    expect(payPlanFor("NG", true)).toMatchObject({ bankFirst: true, usdt: true, soon: null });
    expect(payPlanFor("GH", true)).toMatchObject({ bankFirst: false, usdt: true, soon: "Mobile money in cedis is coming soon." });
    expect(payPlanFor("US", true)).toMatchObject({ bankFirst: false, soon: "Cards and local ways to pay in United States are coming." });
    expect(payPlanFor("GB", false)).toMatchObject({ bankFirst: true, usdt: false });
  });

  it("holds the money when the right USDT arrives in time, and refunds it as USDT to the buyer's address", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await expect(prepareUsdtPayment(w.d, buyer, dealId, "solana", EVM)).rejects.toThrow(/isn't a Solana address/);
    await prepareUsdtPayment(w.d, buyer, dealId, "solana", SOL);
    const dep = await depositOf(dealId, "solana");
    expect(dep.address).toMatch(/^TEST0/); // a pretend address no wallet accepts
    expect(Number(dep.usdt_micro)).toBe(usdtMicroFor(due, FAKE_USDT_RATE_KOBO));
    expect(dep.refund_address_last4).toBe("VFin");

    await payUsdt(w, dealId, "solana", Number(dep.usdt_micro), due);
    const deal = (await w.db.query("select state, review_hold from deals where id = $1", [dealId])).rows[0];
    expect(deal).toMatchObject({ state: "held", review_hold: false });
    const pay = (await w.db.query("select method, network, matches_buyer_name from payments where deal_id = $1", [dealId])).rows[0];
    expect(pay).toMatchObject({ method: "usdt", network: "solana", matches_buyer_name: null });

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

  it("holds too little USDT for review", async () => {
    const { buyer, dealId } = await acceptedDeal();
    await prepareUsdtPayment(w.d, buyer, dealId, "base", EVM);
    const dep = await depositOf(dealId, "base");
    const short = Number(dep.usdt_micro) - 10_000_000;
    await payUsdt(w, dealId, "base", short, koboForUsdt(short, Number(dep.rate_kobo_per_usdt)));
    const deal = (await w.db.query("select state, review_hold, review_hold_reason from deals where id = $1", [dealId])).rows[0];
    expect(deal.state).toBe("held");
    expect(deal.review_hold).toBe(true);
    expect(deal.review_hold_reason).toMatch(/^Wrong amount: received .* USDT on Base/);
  });

  it("gets a new amount only once the old one runs out, and keeps the address", async () => {
    const { buyer, dealId } = await acceptedDeal();
    await prepareUsdtPayment(w.d, buyer, dealId, "ethereum", EVM);
    const first = await depositOf(dealId, "ethereum");
    await prepareUsdtPayment(w.d, buyer, dealId, "ethereum");
    expect((await depositOf(dealId, "ethereum")).quote_expires_at.getTime()).toBe(first.quote_expires_at.getTime());
    w.clock.now = new Date(w.clock.now.getTime() + 31 * 60_000);
    try {
      await prepareUsdtPayment(w.d, buyer, dealId, "ethereum");
      const again = await depositOf(dealId, "ethereum");
      expect(again.quote_expires_at.getTime()).toBeGreaterThan(first.quote_expires_at.getTime());
      expect(again.address).toBe(first.address);
    } finally {
      w.clock.now = new Date();
    }
  });

  it("sends back a second payment for a deal already paid, on its own, and can still refund the first", async () => {
    const { buyer, dealId, due } = await acceptedDeal();
    await prepareUsdtPayment(w.d, buyer, dealId, "bsc", EVM);
    const dep = await depositOf(dealId, "bsc");
    await pay(w, dealId, due, "KOFI MENSAH"); // paid by bank transfer…
    await payUsdt(w, dealId, "bsc", Number(dep.usdt_micro), due); // …and with USDT too
    expect(await stateOf(w, dealId)).toBe("held");
    const pays = (await w.db.query("select method, sent_back from payments where deal_id = $1 order by received_at", [dealId])).rows;
    expect(pays).toEqual([{ method: "bank", sent_back: false }, { method: "usdt", sent_back: true }]);
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

  it("only takes USDT news from the crypto partner, and only from the buyer", async () => {
    const { seller, buyer, dealId } = await acceptedDeal();
    await expect(prepareUsdtPayment(w.d, seller, dealId, "solana", SOL)).rejects.toThrow(/Only the buyer/);
    await prepareUsdtPayment(w.d, buyer, dealId, "solana", SOL);
    const dep = await depositOf(dealId, "solana");
    const event = { id: "evt_" + crypto.randomUUID(), type: "crypto.received" as const,
      data: { deposit_ref: dep.provider_ref, network: "solana", amount_usdt_micro: Number(dep.usdt_micro), amount_kobo: Number(dep.amount_kobo), tx_hash: "x", received_at: new Date().toISOString() } };
    await expect(handlePartnerEvent(w.d, event)).rejects.toThrow(/can't come from the bank partner/);
    expect(await stateOf(w, dealId)).toBe("accepted");
  });
});
