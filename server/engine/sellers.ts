import { inTx, one } from "../db";
import { encryptField, hmac } from "../crypto";
import { namesMatch } from "./deals";
import { type Deps, DealError, N, notify, settingsOf } from "./core";
import type { Condition } from "../../shared/deal";
import { categoryOf, isCategory, normaliseId, type CategoryKey } from "../../shared/categories";
import { naira } from "../../shared/money";

export async function setName(d: Deps, userId: string, fullName: string) {
  const name = fullName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.split(" ").length < 2) throw new DealError("name", "Enter your first and last name, as on your bank account.");
  await d.db.query("update users set full_name = $2 where id = $1", [userId, name.slice(0, 120)]);
}

/** NIN or BVN check through the identity provider. Only the result and verified name are kept. */
export async function verifyId(d: Deps, userId: string, type: "nin" | "bvn", number: string) {
  const user = await one(d.db, "select full_name from users where id = $1", [userId]);
  if (!user?.full_name) throw new DealError("name", "Add your full name first.");
  const r = await d.ids.check(type, number.replace(/\s/g, ""), user.full_name);
  await d.db.query(
    `insert into kyc_checks (user_id, type, provider, provider_ref, result, verified_name, failure_reason, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [userId, type, d.ids.name, r.providerRef, r.result, r.verifiedName, r.reason ?? null]);
  if (r.result !== "verified") throw new DealError("id_failed", r.reason ?? "We couldn't verify that number.");
}

export async function verifiedName(d: Deps, userId: string): Promise<string | null> {
  const k = await one(d.db, "select verified_name from kyc_checks where user_id = $1 and result = 'verified' order by checked_at desc limit 1", [userId]);
  return k?.verified_name ?? null;
}

/** Adds a payout account. It becomes the default only if the bank's name matches the verified ID name. */
export async function addBankAccount(d: Deps, userId: string, bankCode: string, accountNumber: string) {
  const idName = await verifiedName(d, userId);
  if (!idName) throw new DealError("id_first", "Verify your ID before adding a bank account.");
  const number = accountNumber.replace(/\s/g, "");
  const user = await one(d.db, "select full_name from users where id = $1", [userId]);
  let accountName: string;
  try {
    accountName = (await d.partner.resolveAccount(bankCode, number, user?.full_name)).accountName;
  } catch (e) {
    throw new DealError("bank", (e as Error).message || "We couldn't check that account.");
  }
  const match = namesMatch(accountName, idName);
  return inTx(d.db, { type: "seller", id: userId }, async (tx) => {
    if (match) await tx.db.query("update bank_accounts set is_default = false where user_id = $1 and is_default", [userId]);
    await tx.db.query(
      `insert into bank_accounts (user_id, bank_code, account_number_enc, account_number_hmac, account_last4, account_name, name_matches_id, is_default, verified_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7, now())
       on conflict (user_id, account_number_hmac) where removed_at is null
       do update set account_name = excluded.account_name, name_matches_id = excluded.name_matches_id, is_default = excluded.is_default, verified_at = now()`,
      [userId, bankCode, await encryptField(d.secrets.fieldKey, number), await hmac(d.secrets.fieldKey, `acct:${number}`), number.slice(-4), accountName, match]);
    if (!match) throw new DealError("name_mismatch", `The bank says this account belongs to ${accountName}, which doesn't match your ID name (${idName}). Use an account in your own name.`);
  }).catch((e) => { throw e; });
}

export async function sellerReady(d: Deps, userId: string) {
  const r = await one(d.db,
    `select exists (select 1 from kyc_checks where user_id = $1 and result = 'verified') as id_ok,
            exists (select 1 from bank_accounts where user_id = $1 and is_default and removed_at is null) as bank_ok`, [userId]);
  return { idOk: !!r?.id_ok, bankOk: !!r?.bank_ok, ready: !!r?.id_ok && !!r?.bank_ok };
}

export interface ListingInput {
  category: CategoryKey;
  title: string;
  description?: string;
  priceNaira: number;
  condition: Condition;
  area: string;
  imeiOrSerial?: string;
}

export async function saveDraft(d: Deps, userId: string, listingId: string | null, photoKeys: string[], input: ListingInput | null) {
  if (!listingId) {
    const r = await one<{ id: string }>(d.db,
      `insert into listings (seller_id, category, title, price_kobo, condition, area, photo_keys) values ($1, 'phone', 'Untitled listing', 100, 'good', 'Yaba', $2) returning id`,
      [userId, photoKeys]);
    listingId = r!.id;
  }
  const l = await one(d.db, "select * from listings where id = $1", [listingId]);
  if (!l || l.seller_id !== userId) throw new DealError("forbidden", "This listing isn't yours.", 403);
  if (l.status !== "draft") throw new DealError("state", "This listing is already published.");
  if (photoKeys.length) await d.db.query("update listings set photo_keys = $2 where id = $1", [listingId, photoKeys]);
  if (input) {
    const price = Math.round(input.priceNaira * 100);
    if (!isCategory(input.category)) throw new DealError("category", "Choose what you're selling.");
    const cat = categoryOf(input.category);
    if (!input.title?.trim() || input.title.trim().length < 3) throw new DealError("title", `Give it a title, like “${cat.titleExample}”.`);
    const s = await settingsOf(d);
    if (!(price >= s.deal_min_kobo && price <= s.deal_max_kobo)) throw new DealError("price", `Price between ${naira(s.deal_min_kobo)} and ${naira(s.deal_max_kobo)}.`);
    const imei = cat.id ? normaliseId(input.imeiOrSerial ?? "") : "";
    if (cat.id && (imei || cat.id.required) && !cat.id.pattern.test(imei)) throw new DealError("imei", cat.id.error);
    await d.db.query(
      `update listings set category = $2, title = $3, description = $4, price_kobo = $5, condition = $6, area = $7, imei_or_serial = $8 where id = $1`,
      [listingId, input.category, input.title.trim().slice(0, 80), input.description?.trim().slice(0, 2000) || null, price, input.condition, input.area, imei || null]);
  }
  return listingId!;
}

/** Publishes a draft. Sellers must pass the ID and bank checks first; a device already live elsewhere goes to review. */
export async function publish(d: Deps, userId: string, listingId: string): Promise<"live" | "blocked"> {
  const ready = await sellerReady(d, userId);
  if (!ready.ready) throw new DealError("seller_checks", "Verify your ID and bank account before your listing goes live.");
  return inTx(d.db, { type: "seller", id: userId }, async (tx) => {
    const l = await one(tx.db, "select * from listings where id = $1 for update", [listingId]);
    if (!l || l.seller_id !== userId) throw new DealError("forbidden", "This listing isn't yours.", 403);
    if (l.status !== "draft") return l.status;
    if ((l.photo_keys ?? []).length < 3) throw new DealError("photos", "Add at least 3 photos.");
    if (l.title === "Untitled listing") throw new DealError("details", "Add the details first.");
    const dup = l.imei_or_serial
      ? await one(tx.db, "select 1 from listings where imei_or_serial = $1 and status = 'live' and id <> $2", [l.imei_or_serial, listingId])
      : null;
    const status = dup ? "blocked" : "live";
    await tx.db.query("update listings set status = $2, published_at = now() where id = $1", [listingId, status]);
    if (dup) await notify(d, tx, userId, null, "listing_review", `We're checking your listing because the same ${categoryOf(l.category).id?.label.replace(" (optional)", "") ?? "number"} is on another live listing.`);
    return status as "live" | "blocked";
  });
}

export async function setListingStatus(d: Deps, userId: string, listingId: string, status: "paused" | "live" | "removed") {
  const l = await one(d.db, "select seller_id, status from listings where id = $1", [listingId]);
  if (!l || l.seller_id !== userId) throw new DealError("forbidden", "This listing isn't yours.", 403);
  if (!["live", "paused"].includes(l.status)) throw new DealError("state", "This listing can't be changed now.");
  await d.db.query("update listings set status = $2 where id = $1", [listingId, status]);
}

