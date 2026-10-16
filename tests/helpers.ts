import pg from "pg";
import { FakePartner } from "@noshen/engine/partner/fake";
import { FakeCryptoPartner } from "@noshen/engine/partner/fake-crypto";
import type { PartnerEvent } from "@noshen/engine/partner/types";
import { ConsoleEmail } from "@noshen/engine/email";
import { FakeIdProvider } from "@noshen/engine/idcheck";
import type { Deps, TimerKind } from "@noshen/engine/core";
import { handlePartnerEvent } from "@noshen/engine/deals";
import { saveDraft, publish, setName, verifyId, addBankAccount, type ListingInput } from "@noshen/engine/sellers";
import { markSent } from "@noshen/engine/deals";
import { testDatabaseUrl } from "./global-setup";

export interface TestWorld {
  d: Deps;
  db: pg.Client;
  settled: PartnerEvent[];
  timers: { kind: TimerKind; at: Date; dealId?: string }[];
  mail: ConsoleEmail;
  partner: FakePartner;
  crypto: FakeCryptoPartner;
  clock: { now: Date };
}

export async function world(): Promise<TestWorld> {
  const db = new pg.Client({ connectionString: process.env.NOSHEN_TEST_DB ?? testDatabaseUrl() });
  await db.connect();
  const settled: PartnerEvent[] = [];
  const timers: TestWorld["timers"] = [];
  const partner = new FakePartner("test-partner-secret", "Test Bank", async (e) => { settled.push(e); });
  const crypto = new FakeCryptoPartner("test-partner-secret", async (e) => { settled.push(e); });
  const mail = new ConsoleEmail();
  mail.send = async (m) => { mail.sent.push(m); };
  const clock = { now: new Date() };
  const d: Deps = {
    db, partner, crypto, mail, ids: new FakeIdProvider(),
    timers: { schedule: async (t) => { timers.push(t); } },
    secrets: { releaseCode: "test-release-secret", fieldKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) },
    appUrl: "http://test",
    now: () => clock.now,
  };
  return { d, db, settled, timers, mail, partner, crypto, clock };
}

let phoneSeq = 10_000_000 + Math.floor(Math.random() * 80_000_000);
export async function person(w: TestWorld, fullName: string) {
  const email = `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}${phoneSeq++}@example.com`;
  const r = await w.db.query("insert into users (email, full_name) values ($1, $2) returning id", [email, fullName]);
  return r.rows[0].id as string;
}

export async function verifiedSeller(w: TestWorld, fullName: string) {
  const id = await person(w, fullName);
  await setName(w.d, id, fullName);
  await verifyId(w.d, id, "nin", "12345678901");
  await addBankAccount(w.d, id, "058", "0123456789");
  return id;
}

// Random per test file: files run at the same time, and NosHen holds back a listing whose IMEI is already listed.
let imeiSeq = 352918000000000 + Math.floor(Math.random() * 9_000) * 100_000;
export async function liveListing(w: TestWorld, sellerId: string, priceNaira = 250_000, title = "iPhone 12, 128GB", extra: Partial<ListingInput> = {}) {
  const id = await saveDraft(w.d, sellerId, null, ["a", "b", "c"], {
    category: "phone", title, priceNaira, condition: "good", state: "Lagos", area: "Yaba", imeiOrSerial: String(imeiSeq++), ...extra,
  });
  await publish(w.d, sellerId, id);
  return id;
}

/** The partner telling us money arrived in a deal's account, signed like a real webhook. */
export async function pay(w: TestWorld, dealId: string, amountKobo: number, senderName: string) {
  const deal = (await w.db.query("select collection_ref from deals where id = $1", [dealId])).rows[0];
  const event: PartnerEvent = {
    id: "evt_" + crypto.randomUUID(), type: "collection.received",
    data: { collection_ref: deal.collection_ref, amount_kobo: amountKobo, sender_name: senderName, sender_bank_code: "044", sender_account: "0987654321", received_at: new Date().toISOString() },
  };
  const body = JSON.stringify(event);
  const verified = await w.partner.verifyWebhook(body, new Headers({ "x-fake-signature": await w.partner.sign(body) }));
  return { event, result: await handlePartnerEvent(w.d, verified) };
}

/** The crypto partner telling us USDT or USDC arrived at a deal's address, signed like its real webhook. */
export async function payCrypto(w: TestWorld, dealId: string, coin: string, network: string, micro: number, amountKobo: number) {
  const dep = (await w.db.query("select provider_ref from crypto_deposits where deal_id = $1 and coin = $2 and network = $3", [dealId, coin, network])).rows[0];
  const event: PartnerEvent = {
    id: "evt_" + crypto.randomUUID(), type: "crypto.received",
    data: { deposit_ref: dep.provider_ref, coin, network, amount_micro: micro, amount_kobo: amountKobo, tx_hash: "0x" + "ab".repeat(32), received_at: new Date().toISOString() },
  };
  const body = JSON.stringify(event);
  const verified = await w.crypto.verifyWebhook(body, new Headers({ "x-fake-crypto-signature": await w.crypto.sign(body) }));
  return handlePartnerEvent(w.d, verified, "crypto");
}

export async function settleAll(w: TestWorld) {
  while (w.settled.length) await handlePartnerEvent(w.d, w.settled.shift()!);
}

export async function balances(w: TestWorld, dealId: string) {
  const rows = (await w.db.query("select account, balance_kobo from account_balances where deal_id = $1", [dealId])).rows;
  return Object.fromEntries(rows.map((r: any) => [r.account, Number(r.balance_kobo)]));
}

export const stateOf = async (w: TestWorld, dealId: string) => (await w.db.query("select state from deals where id = $1", [dealId])).rows[0].state;

/** The seller sends a delivery with packing photos (stored already) and who's delivering it. */
export const sendIt = (w: TestWorld, sellerId: string, dealId: string, trackingRef?: string) =>
  markSent(w.d, sellerId, dealId, { courier: "Dispatch rider", trackingRef, photoKeys: [`packing/${dealId}/1.jpg`, `packing/${dealId}/2.jpg`] });
