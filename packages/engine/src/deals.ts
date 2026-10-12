import type { Tx } from "./db";
import { inTx, one, many } from "./db";
import { feeFor, naira } from "@noshen/shared/money";
import { firstName, type Handover } from "@noshen/shared/deal";
import { when, addHours, addMinutes } from "@noshen/shared/time";
import { asBytes, decryptField, encryptField, releaseCheck, releaseCodeFor, timingSafeEqual } from "./crypto";
import type { PartnerEvent } from "./partner/types";
import type { Settings } from "./settings";
import { overLimit, sellerLimitText, type SellerLimit } from "@noshen/shared/limits";
import { coinAmount, coinName, cryptoLabel, networkOf, type Coin, type Network } from "@noshen/shared/payments";

export { overLimit, sellerLimitText, type SellerLimit };
import {
  type Deps, type DealRow, DealError, N, amountPaid, lockDeal, notify, nowOf, post, pushToUser, schedule, settingsOf, userName,
} from "./core";

// ---------------------------------------------------------------------------
// Buy request, acceptance, decline, cancel
// ---------------------------------------------------------------------------

/**
 * The most a seller can take in one deal: a limit staff set for them if there is one; otherwise no limit
 * (beyond any top price in settings) once they've passed the ID and bank checks, and a starter limit
 * (₦300,000 by default) until they have. capKobo is null when there's no limit.
 */
export async function sellerLimit(db: Tx["db"], sellerId: string, s: Settings): Promise<SellerLimit> {
  const r = await one<{ max: string | null; id_ok: boolean; bank_ok: boolean }>(db,
    `select (select max_deal_kobo from users where id = $1) as max,
            exists (select 1 from kyc_checks where user_id = $1 and result = 'verified') as id_ok,
            exists (select 1 from bank_accounts where user_id = $1 and is_default and removed_at is null) as bank_ok`, [sellerId]);
  const verified = !!r?.id_ok && !!r?.bank_ok;
  if (r?.max) return { capKobo: N(r.max), custom: true, verified };
  return { capKobo: verified ? s.deal_max_kobo : s.unverified_seller_max_kobo, custom: false, verified };
}

export async function requestDeal(d: Deps, buyerId: string, input: { listingId: string; handover: Handover; note?: string }): Promise<string> {
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const s = await settingsOf(d);
    const now = nowOf(d);
    const listing = await one(tx.db, "select l.*, u.status as seller_status from listings l join users u on u.id = l.seller_id where l.id = $1", [input.listingId]);
    if (!listing || listing.status !== "live" || listing.sold_count >= listing.quantity) throw new DealError("not_available", "This listing isn't available any more.");
    if (listing.seller_status !== "active") throw new DealError("not_available", "This listing isn't available right now.");
    if (listing.seller_id === buyerId) throw new DealError("own_listing", "This is your own listing.");
    const price = N(listing.price_kobo);
    if (price < s.deal_min_kobo || (s.deal_max_kobo !== null && price > s.deal_max_kobo))
      throw new DealError("deal_size", s.deal_max_kobo === null ? `Protected deals start at ${naira(s.deal_min_kobo)}.` : `Protected deals are between ${naira(s.deal_min_kobo)} and ${naira(s.deal_max_kobo)}.`);

    const limit = await sellerLimit(tx.db, listing.seller_id, s);
    if (overLimit(price, limit)) throw new DealError("seller_cap", sellerLimitText(limit, "buyer"));

    if (price > s.buyer_id_required_above_kobo) {
      const kyc = await one(tx.db, "select 1 from kyc_checks where user_id = $1 and result = 'verified'", [buyerId]);
      if (!kyc) throw new DealError("buyer_id_required", `For deals over ${naira(s.buyer_id_required_above_kobo)}, verify your ID first.`);
    }

    const existing = await one<{ id: string }>(
      tx.db,
      "select id from deals where listing_id = $1 and buyer_id = $2 and state in ('requested','accepted','held','disputed')",
      [input.listingId, buyerId],
    );
    if (existing) return existing.id;

    const fee = feeFor(price, s.fee);
    const deal = await one<{ id: string }>(
      tx.db,
      `insert into deals (listing_id, buyer_id, seller_id, price_kobo, fee_kobo, fee_payer, handover, request_expires_at)
       values ($1, $2, $3, $4, $5, 'buyer', $6, $7) returning id`,
      [listing.id, buyerId, listing.seller_id, price, fee, input.handover, addHours(now, s.request_ttl_hours)],
    );
    const id = deal!.id;
    if (input.note?.trim()) {
      await tx.db.query("insert into messages (deal_id, sender_id, body) values ($1, $2, $3)", [id, buyerId, input.note.trim().slice(0, 2000)]);
    }
    const buyer = firstName(await userName(tx.db, buyerId));
    await notify(d, tx, listing.seller_id, id, "request_received",
      `${buyer} wants to buy your ${listing.title} with protection. Answer by ${when(addHours(now, s.request_ttl_hours), now)}.`);
    schedule(d, tx, "request_expiry", id, addHours(now, s.request_ttl_hours));
    return id;
  });
}

export async function acceptDeal(d: Deps, sellerId: string, dealId: string) {
  return inTx(d.db, { type: "seller", id: sellerId }, async (tx) => {
    const s = await settingsOf(d);
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.seller_id !== sellerId) throw new DealError("forbidden", "Only the seller can accept this request.", 403);
    if (deal.state !== "requested") throw new DealError("state", "This request has already been answered.");
    if (deal.request_expires_at <= now) throw new DealError("expired", "This request has expired.");

    // Each deal takes one unit. A unit is taken from acceptance until the deal ends: sold, or freed again if it's
    // cancelled or refunded. Accepting the last free unit declines the other requests waiting on this listing.
    const listing = await one<{ title: string; quantity: number; sold_count: number }>(tx.db,
      "select title, quantity, sold_count from listings where id = $1 for update", [deal.listing_id]);
    const taken = await one<{ n: string }>(tx.db,
      "select count(*) as n from deals where listing_id = $1 and state in ('accepted', 'held', 'disputed') and id <> $2", [deal.listing_id, dealId]);
    const free = listing!.quantity - listing!.sold_count - N(taken?.n);
    if (free <= 0) throw new DealError("sold_out", "Every unit is already taken by another deal. Decline this request, or wait in case one falls through.");
    if (free === 1) {
      const others = await many<{ id: string; buyer_id: string }>(
        tx.db, "select id, buyer_id from deals where listing_id = $1 and state = 'requested' and id <> $2 for update", [deal.listing_id, dealId]);
      for (const o of others) {
        await tx.db.query("update deals set state = 'declined' where id = $1", [o.id]);
        await notify(d, tx, o.buyer_id, o.id, "request_declined", `The seller accepted another buyer for the ${listing!.title}${listing!.quantity > 1 ? ", the last one they had" : ""}. You paid nothing.`);
      }
    }

    const buyer = await userName(tx.db, deal.buyer_id);
    const label = `${firstName(buyer)} deal ${dealId.slice(0, 4).toUpperCase()}`;
    const col = await d.partner.openCollection(dealId, N(deal.amount_due_kobo), label);
    const due = addHours(now, s.payment_ttl_hours);
    await tx.db.query(
      `update deals set state = 'accepted', payment_due_at = $2, collection_ref = $3, collection_account_number = $4, collection_bank_name = $5 where id = $1`,
      [dealId, due, col.ref, col.accountNumber, col.bankName],
    );
    const seller = firstName(await userName(tx.db, sellerId));
    await notify(d, tx, deal.buyer_id, dealId, "request_accepted",
      `${seller} accepted. Pay ${naira(deal.amount_due_kobo)} into NosHen by ${when(due, now)}.`);
    await notify(d, tx, sellerId, dealId, "awaiting_payment",
      `Waiting for ${firstName(buyer)} to pay. Don't hand anything over until NosHen shows the money as held.`);
    schedule(d, tx, "payment_expiry", dealId, due);
  });
}

export async function declineDeal(d: Deps, sellerId: string, dealId: string) {
  return inTx(d.db, { type: "seller", id: sellerId }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    if (deal.seller_id !== sellerId) throw new DealError("forbidden", "Only the seller can decline this request.", 403);
    if (deal.state !== "requested") throw new DealError("state", "This request has already been answered.");
    await tx.db.query("update deals set state = 'declined' where id = $1", [dealId]);
    const listing = await one(tx.db, "select title from listings where id = $1", [deal.listing_id]);
    await notify(d, tx, deal.buyer_id, dealId, "request_declined", `The seller declined your request for the ${listing.title}. You paid nothing.`);
  });
}

/** Either person can cancel before the hand-over. If the money is held, the buyer gets everything back. */
export async function cancelDeal(d: Deps, userId: string, dealId: string) {
  return inTx(d.db, { type: "buyer", id: userId }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    const isBuyer = deal.buyer_id === userId;
    if (!isBuyer && deal.seller_id !== userId) throw new DealError("forbidden", "This deal isn't yours.", 403);
    await tx.db.query("select set_config('noshen.actor', $1, true)", [isBuyer ? "buyer" : "seller"]);
    const other = isBuyer ? deal.seller_id : deal.buyer_id;
    const who = firstName(await userName(tx.db, userId));
    if (deal.state === "requested" || deal.state === "accepted") {
      await tx.db.query("update deals set state = 'declined' where id = $1", [dealId]);
      await notify(d, tx, other, dealId, "deal_cancelled", `${who} cancelled the deal. Nothing was paid.`);
      return;
    }
    if (deal.state === "held") {
      if (deal.delivered_at) throw new DealError("delivered", "The item was marked delivered. Confirm you received it, or report a problem.");
      await refund(d, tx, deal, "cancelled");
      await notify(d, tx, other, dealId, "deal_cancelled", `${who} cancelled the deal before the hand-over. The buyer is refunded.`);
      return;
    }
    throw new DealError("state", "This deal can't be cancelled now.");
  });
}

// ---------------------------------------------------------------------------
// Payments from the partner
// ---------------------------------------------------------------------------

const words = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
/** True when every word of the shorter name appears in the longer one, in any order. */
export function namesMatch(a: string, b: string) {
  const [x, y] = [words(a), words(b)].sort((p, q) => p.length - q.length);
  return x.length > 0 && x.every((w) => y.includes(w));
}

/**
 * Handles a verified partner webhook exactly once (partner_events is unique on the event id). `source` says which
 * partner signed it: the crypto partner can only report USDT or USDC, and the bank partner only bank transfers.
 */
export async function handlePartnerEvent(d: Deps, event: PartnerEvent, source?: "crypto"): Promise<"processed" | "duplicate"> {
  if ((event.type === "crypto.received") !== (source === "crypto") && event.type !== "transfer.succeeded" && event.type !== "transfer.failed")
    throw new Error(`a ${event.type} event can't come from the ${source ?? "bank"} partner`);
  const from = source === "crypto" ? d.crypto?.name ?? "crypto" : d.partner.name;
  const stored = await one<{ id: string; processed_at: Date | null }>(
    d.db,
    `insert into partner_events (partner, event_id, type, payload) values ($1, $2, $3, $4)
     on conflict (partner, event_id) do update set attempts = partner_events.attempts + 1
     returning id, processed_at`,
    [from, event.id, event.type, JSON.stringify(event)],
  );
  if (stored!.processed_at) return "duplicate";
  try {
    if (event.type === "collection.received") await onCollection(d, stored!.id, event);
    else if (event.type === "crypto.received") await onCryptoReceived(d, stored!.id, event);
    else await onTransferResult(d, event);
    await d.db.query("update partner_events set processed_at = now(), error = null where id = $1", [stored!.id]);
    return "processed";
  } catch (e) {
    await d.db.query("update partner_events set error = $2 where id = $1", [stored!.id, String(e)]);
    throw e;
  }
}

async function onCollection(d: Deps, partnerEventId: string, event: Extract<PartnerEvent, { type: "collection.received" }>) {
  await inTx(d.db, { type: "partner" }, async (tx) => {
    const found = await one<{ id: string }>(tx.db, "select id from deals where collection_ref = $1", [event.data.collection_ref]);
    const senderEnc = await encryptField(d.secrets.fieldKey, event.data.sender_account);
    if (!found) {
      await tx.db.query(
        `insert into payments (deal_id, partner_event_id, amount_kobo, sender_name, sender_bank_code, sender_account_enc, matches_amount_due, matches_buyer_name, received_at)
         values (null, $1, $2, $3, $4, $5, false, null, $6)`,
        [partnerEventId, event.data.amount_kobo, event.data.sender_name, event.data.sender_bank_code, senderEnc, event.data.received_at]);
      return; // unmatched money: shows in the console's money page for a person to return
    }
    const deal = await lockDeal(tx.db, found.id);
    const buyerName = await userName(tx.db, deal.buyer_id);
    const amountOk = event.data.amount_kobo === N(deal.amount_due_kobo);
    const nameOk = namesMatch(event.data.sender_name, buyerName);
    const pay = await one<{ id: string }>(tx.db,
      `insert into payments (deal_id, partner_event_id, amount_kobo, sender_name, sender_bank_code, sender_account_enc, matches_amount_due, matches_buyer_name, received_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [deal.id, partnerEventId, event.data.amount_kobo, event.data.sender_name, event.data.sender_bank_code, senderEnc, amountOk, nameOk, event.data.received_at]);
    const hold = !amountOk
      ? `Wrong amount: received ${naira(event.data.amount_kobo)}, due ${naira(deal.amount_due_kobo)}`
      : !nameOk
        ? `Payment name doesn't match buyer: paid by ${event.data.sender_name}, buyer is ${buyerName}`
        : null;
    await paymentArrived(d, tx, deal, pay!.id, event.data.amount_kobo, hold);
  });
}

/**
 * USDT or USDC arrived at a deal's address. The crypto partner has turned it into naira for the deal (amount_kobo):
 * the deal's amount due when the buyer sent the amount asked for while it held. There's no name to check on a wallet.
 */
async function onCryptoReceived(d: Deps, partnerEventId: string, event: Extract<PartnerEvent, { type: "crypto.received" }>) {
  await inTx(d.db, { type: "partner" }, async (tx) => {
    const dep = await one<{ id: string; deal_id: string; coin: Coin; network: Network }>(tx.db,
      "select id, deal_id, coin, network from crypto_deposits where provider_ref = $1", [event.data.deposit_ref]);
    const coin = dep?.coin ?? event.data.coin;
    const network = dep?.network ?? event.data.network;
    const insert = (dealId: string | null, amountOk: boolean) => one<{ id: string }>(tx.db,
      `insert into payments (deal_id, partner_event_id, amount_kobo, matches_amount_due, matches_buyer_name, received_at,
                             method, crypto_deposit_id, coin, network, tx_hash, amount_coin_micro)
       values ($1, $2, $3, $4, null, $5, 'crypto', $6, $7, $8, $9, $10) returning id`,
      [dealId, partnerEventId, event.data.amount_kobo, amountOk, event.data.received_at, dep?.id ?? null, coin, network, event.data.tx_hash, event.data.amount_micro]);
    if (!dep) {
      await insert(null, false);
      return; // unmatched money: shows in the console's money page for a person to return
    }
    const deal = await lockDeal(tx.db, dep.deal_id);
    const amountOk = event.data.amount_kobo === N(deal.amount_due_kobo);
    const pay = await insert(deal.id, amountOk);
    const hold = amountOk ? null
      : `Wrong amount: received ${coinAmount(event.data.amount_micro, dep.coin)} on ${networkOf(dep.network).name} (${naira(event.data.amount_kobo)}), due ${naira(deal.amount_due_kobo)}`;
    await paymentArrived(d, tx, deal, pay!.id, event.data.amount_kobo, hold);
  });
}

/**
 * Money arrived for a deal, by bank transfer or stablecoin: hold it, or hold it for review, or, if the deal is no
 * longer waiting for money (it closed, or was already paid), send this payment straight back.
 */
async function paymentArrived(d: Deps, tx: Tx, deal: DealRow, paymentId: string, amountKobo: number, hold: string | null) {
  const s = await settingsOf(d);
  const now = nowOf(d);
  await post(tx.db, deal.id, "payment_received", [
    { account: "partner_cash", debit: amountKobo },
    { account: "held_funds", credit: amountKobo },
  ]);

  if (deal.state !== "accepted") {
    await post(tx.db, deal.id, "refund_due", [
      { account: "held_funds", debit: amountKobo },
      { account: "refunds_due", credit: amountKobo },
    ], deal.state === "held" || deal.state === "disputed" ? "a second payment for a deal already paid" : "payment arrived after the deal closed");
    await tx.db.query("update payments set sent_back = true where id = $1", [paymentId]);
    await createTransfer(d, tx, deal.id, "refund", amountKobo, { refundPaymentId: paymentId, sendBack: true });
    const to = await refundTarget(tx, paymentId);
    const back = to && !to.address_enc ? ` Add your ${cryptoLabel(to.coin, to.network)} address in the deal so we can send it back.` : " We're sending it back.";
    await notify(d, tx, deal.buyer_id, deal.id, "late_payment_refunded", deal.state === "held" || deal.state === "disputed"
      ? `Another payment of ${naira(amountKobo)} arrived for a deal you'd already paid.${back}`
      : `Your payment of ${naira(amountKobo)} arrived after the deal closed.${back}`);
    return;
  }

  const handoverDue = addHours(now, s.handover_window_hours);
  await tx.db.query("update deals set state = 'held', handover_due_at = $2, review_hold = $3, review_hold_reason = $4 where id = $1",
    [deal.id, handoverDue, !!hold, hold]);
  const code = await releaseCodeFor(d.secrets.releaseCode, deal.id);
  await tx.db.query("insert into release_codes (deal_id, code_hmac) values ($1, $2) on conflict (deal_id) do nothing",
    [deal.id, await releaseCheck(d.secrets.releaseCode, deal.id, code)]);

  const seller = firstName(await userName(tx.db, deal.seller_id));
  if (hold) {
    await notify(d, tx, deal.buyer_id, deal.id, "payment_review", "Your payment arrived. We're checking it and will email you. Don't meet yet.");
    await notify(d, tx, deal.seller_id, deal.id, "payment_review", "A payment arrived, and NosHen is checking it. Don't hand over yet.");
  } else {
    await notify(d, tx, deal.buyer_id, deal.id, "payment_held", `${naira(amountKobo)} is held safely. Your release code is in the app. Meet ${seller} by ${when(handoverDue, now)}.`);
    await notify(d, tx, deal.seller_id, deal.id, "payment_held", `${naira(deal.seller_share_kobo)} is held for you. Hand over by ${when(handoverDue, now)} and ask for the code.`);
  }
  schedule(d, tx, "handover_due", deal.id, handoverDue);
}

async function onTransferResult(d: Deps, event: Extract<PartnerEvent, { type: "transfer.succeeded" | "transfer.failed" }>) {
  await inTx(d.db, { type: "partner" }, async (tx) => {
    const t = await one(tx.db, "select * from transfers where id = $1 for update", [event.data.transfer_id]);
    if (!t || t.status === "succeeded" || t.status === "failed") return;
    if (event.type === "transfer.failed") {
      await tx.db.query("update transfers set status = 'failed', failure_reason = $2, partner_ref = coalesce(partner_ref, $3) where id = $1",
        [t.id, event.data.reason ?? "failed", event.data.partner_ref]);
      return; // shows in the console's failed-payouts queue
    }
    await tx.db.query("update transfers set status = 'succeeded', partner_ref = coalesce(partner_ref, $2) where id = $1", [t.id, event.data.partner_ref]);
    const amount = N(t.amount_kobo);
    if (t.kind === "payout") {
      await post(tx.db, t.deal_id, "payout_sent", [{ account: "seller_payable", debit: amount }, { account: "partner_cash", credit: amount }]);
      const deal = await lockDeal(tx.db, t.deal_id);
      if (deal.state === "released") await tx.db.query("update deals set state = 'paid_out' where id = $1", [deal.id]);
      const acct = await one(tx.db, "select bank_code, account_last4 from bank_accounts where id = $1", [t.bank_account_id]);
      await notify(d, tx, deal.seller_id, deal.id, "payout_sent", `${naira(amount)} sent to your bank account ••${acct?.account_last4 ?? ""}.`);
    } else if (t.kind === "refund") {
      await post(tx.db, t.deal_id, "refund_sent", [{ account: "refunds_due", debit: amount }, { account: "partner_cash", credit: amount }]);
      const deal = await one(tx.db, "select buyer_id from deals where id = $1", [t.deal_id]);
      const to = await refundTarget(tx, t.refund_payment_id);
      await notify(d, tx, deal.buyer_id, t.deal_id, "refund_sent", to
        ? `${naira(amount)} refunded as ${coinName(to.coin)} to your ${networkOf(to.network).name} address ending ${to.last4}.`
        : `${naira(amount)} refunded to your bank account.`);
    }
  });
}

/** Records a transfer with its idempotency key, and asks the partner to send it after commit. */
async function createTransfer(d: Deps, tx: Tx, dealId: string, kind: "payout" | "refund", amount: number,
  to: { bankAccountId?: string | null; refundPaymentId?: string | null; sendBack?: boolean }, key?: string) {
  const t = await one<{ id: string; idempotency_key: string }>(tx.db,
    `insert into transfers (deal_id, kind, amount_kobo, bank_account_id, refund_payment_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6) returning id, idempotency_key`,
    [dealId, kind, amount, to.bankAccountId ?? null, to.refundPaymentId ?? null, key ?? (to.sendBack ? `${to.refundPaymentId}:send-back` : `${dealId}:${kind}`)]);
  let destination: { bankCode: string; accountNumber: string; accountName: string };
  const coinTo = await refundTarget(tx, to.refundPaymentId);
  if (coinTo) {
    // Paid in USDT or USDC: sent back in the same coin to the buyer's own address. If they haven't given it yet,
    // the transfer waits as pending until they do (saveRefundAddress sends it).
    if (coinTo.address_enc) await sendCryptoRefund(d, tx, t!.id, coinTo);
    return;
  }
  if (to.bankAccountId) {
    const a = await one(tx.db, "select bank_code, account_number_enc, account_name from bank_accounts where id = $1", [to.bankAccountId]);
    destination = { bankCode: a.bank_code, accountNumber: await decryptField(d.secrets.fieldKey, asBytes(a.account_number_enc)), accountName: a.account_name };
  } else {
    const p = await one(tx.db, "select sender_bank_code, sender_account_enc, sender_name from payments where id = $1", [to.refundPaymentId]);
    destination = { bankCode: p.sender_bank_code ?? "", accountNumber: await decryptField(d.secrets.fieldKey, asBytes(p.sender_account_enc)), accountName: p.sender_name ?? "" };
  }
  tx.after(async () => {
    const r = await d.partner.sendTransfer({ transferId: t!.id, kind, amountKobo: amount, idempotencyKey: t!.idempotency_key, destination });
    await d.db.query("update transfers set status = case when status = 'pending' then 'sent'::transfer_status else status end, partner_ref = coalesce(partner_ref, $2) where id = $1", [t!.id, r.partnerRef]);
  });
}

/**
 * Sends a failed payout or refund again, as a new transfer; the failed one stays on record. The ledger only moves
 * when a transfer succeeds, so a retry can't count money twice. A payout goes to the seller's bank account as it
 * is now: after a failure they may have fixed it. Call inside a transaction.
 */
export async function retryFailedTransfer(d: Deps, tx: Tx, transferId: string) {
  const t = await one(tx.db, "select * from transfers where id = $1 for update", [transferId]);
  if (!t) throw new DealError("not_found", "We can't find that transfer.", 404);
  if (t.status !== "failed") throw new DealError("state", "Only a failed payout or refund can be sent again.");
  if ((t.kind !== "payout" && t.kind !== "refund") || !t.deal_id) throw new DealError("state", "Only a deal's payout or refund can be sent again here.");
  const again = await one(tx.db,
    `select 1 from transfers where deal_id = $1 and kind = $2 and status <> 'failed' and ($2 = 'payout' or refund_payment_id is not distinct from $3)`,
    [t.deal_id, t.kind, t.refund_payment_id]);
  if (again) throw new DealError("state", `This ${t.kind} has already been sent again. Check its status on the deal.`);
  let bankAccountId: string | null = t.bank_account_id;
  if (t.kind === "payout") {
    const deal = await one<{ seller_id: string }>(tx.db, "select seller_id from deals where id = $1", [t.deal_id]);
    const bank = await one<{ id: string }>(tx.db, "select id from bank_accounts where user_id = $1 and is_default and removed_at is null", [deal!.seller_id]);
    if (!bank) throw new DealError("no_bank", "The seller has no bank account to pay. Ask them to add one, then try again.");
    bankAccountId = bank.id;
  }
  const tries = await one<{ n: string }>(tx.db, "select count(*) as n from transfers where deal_id = $1 and kind = $2", [t.deal_id, t.kind]);
  await createTransfer(d, tx, t.deal_id, t.kind, N(t.amount_kobo), { bankAccountId, refundPaymentId: t.refund_payment_id },
    `${t.idempotency_key}:retry${N(tries?.n)}`);
}

type CoinRefundTarget = { coin: Coin; network: Network; address_enc: unknown | null; last4: string | null };

/**
 * Where a refund of this payment goes when it was paid in USDT or USDC: the buyer's own address on that network
 * (address_enc is null until they give it). Null for a bank payment.
 */
async function refundTarget(tx: Tx, paymentId: string | null | undefined): Promise<CoinRefundTarget | null> {
  if (!paymentId) return null;
  const r = await one<CoinRefundTarget>(tx.db,
    `select c.coin, c.network, c.refund_address_enc as address_enc, c.refund_address_last4 as last4
       from payments p join crypto_deposits c on c.id = p.crypto_deposit_id where p.id = $1 and p.method = 'crypto'`, [paymentId]);
  return r ?? null;
}

/**
 * Asks the crypto partner to send a pending refund, after commit. The transfer is claimed ('sent') inside the
 * transaction, so saving an address twice can't send it twice; if the partner call fails, it goes back to pending.
 */
async function sendCryptoRefund(d: Deps, tx: Tx, transferId: string, to: CoinRefundTarget) {
  const t = await one<{ id: string; amount_kobo: string; idempotency_key: string }>(tx.db,
    `update transfers set status = 'sent' where id = $1 and status = 'pending' and partner_ref is null returning id, amount_kobo, idempotency_key`, [transferId]);
  if (!t) return;
  const address = await decryptField(d.secrets.fieldKey, asBytes(to.address_enc));
  tx.after(async () => {
    try {
      if (!d.crypto) throw new Error(`refund ${t.id} is to a ${cryptoLabel(to.coin, to.network)} address, but no crypto partner is set up`);
      const r = await d.crypto.sendRefund({ transferId: t.id, amountKobo: N(t.amount_kobo), idempotencyKey: t.idempotency_key, coin: to.coin, network: to.network, address });
      await d.db.query("update transfers set partner_ref = coalesce(partner_ref, $2) where id = $1", [t.id, r.partnerRef]);
    } catch (e) {
      await d.db.query("update transfers set status = 'pending' where id = $1 and status = 'sent' and partner_ref is null", [t.id]);
      throw e;
    }
  });
}

/** Sends every refund that was waiting for the buyer's address on this deposit. Call once the address is saved. */
export async function sendWaitingCryptoRefunds(d: Deps, tx: Tx, depositId: string) {
  const to = await one<CoinRefundTarget>(tx.db,
    "select coin, network, refund_address_enc as address_enc, refund_address_last4 as last4 from crypto_deposits where id = $1", [depositId]);
  if (!to?.address_enc) return 0;
  const waiting = await many<{ id: string }>(tx.db,
    `select t.id from transfers t join payments p on p.id = t.refund_payment_id
      where p.crypto_deposit_id = $1 and t.kind = 'refund' and t.status = 'pending' and t.partner_ref is null for update of t`, [depositId]);
  for (const w of waiting) await sendCryptoRefund(d, tx, w.id, to);
  return waiting.length;
}

/** What to tell the buyer about where a refund goes. */
function refundWords(to: CoinRefundTarget | null, amount: number, fallback: string) {
  if (!to) return fallback;
  const where = `${coinName(to.coin)} on ${networkOf(to.network).name}`;
  return to.address_enc
    ? `${naira(amount)} is being refunded as ${coinName(to.coin)} to your ${networkOf(to.network).name} address ending ${to.last4}, at the day's rate.`
    : `${naira(amount)} is ready to refund as ${where}. Add your ${where} address in the deal so we can send it.`;
}

// ---------------------------------------------------------------------------
// Release: one path for the code, the buyer's confirmation, the delivery timer and a reviewer
// ---------------------------------------------------------------------------

/** Call with the deal already locked. Moves the money to the seller and starts the payout. */
export async function release(d: Deps, tx: Tx, deal: DealRow, by: "code" | "confirmed" | "timer" | "reviewer") {
  const allowed = by === "reviewer" ? deal.state === "disputed" : deal.state === "held";
  if (!allowed) throw new DealError("state", "This deal can't be released now.");
  if (deal.review_hold && by !== "reviewer") throw new DealError("review_hold", "NosHen is checking the payment for this deal. Don't hand over yet.");
  const paid = await amountPaid(tx.db, deal.id);
  const share = N(deal.seller_share_kobo);
  const fee = paid - share;
  await post(tx.db, deal.id, "release", [
    { account: "held_funds", debit: paid },
    { account: "seller_payable", credit: share },
    { account: "fee_revenue", credit: fee },
  ], `released by ${by}`);
  await tx.db.query("update deals set state = 'released' where id = $1", [deal.id]);
  await tx.db.query("update release_codes set used_at = now() where deal_id = $1 and used_at is null and voided_at is null", [deal.id]);

  const bank = await one<{ id: string; account_last4: string }>(tx.db,
    "select id, account_last4 from bank_accounts where user_id = $1 and is_default and removed_at is null", [deal.seller_id]);
  if (bank) await createTransfer(d, tx, deal.id, "payout", share, { bankAccountId: bank.id });
  const listing = await one(tx.db, "select title from listings where id = $1", [deal.listing_id]);
  // One more sold; the last one marks the listing sold.
  await tx.db.query(
    `update listings set sold_count = least(sold_count + 1, quantity),
            status = case when sold_count + 1 >= quantity and status = 'live' then 'sold'::listing_status else status end,
            sold_at = case when sold_count + 1 >= quantity then now() else sold_at end
      where id = $1`, [deal.listing_id]);
  const seller = firstName(await userName(tx.db, deal.seller_id));
  await notify(d, tx, deal.seller_id, deal.id, "released", `${naira(share)} released. Your payout${bank ? ` to ••${bank.account_last4}` : ""} is on its way.`);
  await notify(d, tx, deal.buyer_id, deal.id, "released", `Deal closed: ${naira(share)} released to ${seller}. The ${listing.title} is yours. Please rate ${seller}.`);
}

export type CodeResult = { ok: true } | { ok: false; message: string; locked?: boolean };

/** The seller types the buyer's code. Wrong codes count per deal; too many lock entry for a while. */
export async function releaseByCode(d: Deps, sellerId: string, dealId: string, code: string): Promise<CodeResult> {
  return inTx(d.db, { type: "seller", id: sellerId }, async (tx) => {
    const s = await settingsOf(d);
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.seller_id !== sellerId) throw new DealError("forbidden", "Only the seller enters the release code.", 403);
    if (deal.state !== "held") throw new DealError("state", "This deal isn't waiting for a release code.");
    if (deal.review_hold) return { ok: false, message: "NosHen is checking the payment for this deal. Don't hand over yet." };
    const rc = await one(tx.db, "select * from release_codes where deal_id = $1 for update", [dealId]);
    if (!rc || rc.voided_at || rc.used_at) throw new DealError("state", "This deal has no active release code.");
    if (rc.locked_until && new Date(rc.locked_until) > now)
      return { ok: false, locked: true, message: `Too many wrong codes. Try again at ${when(new Date(rc.locked_until), now)}.` };

    const clean = code.replace(/\D/g, "");
    const good = clean.length === 6 && timingSafeEqual(await releaseCheck(d.secrets.releaseCode, dealId, clean), asBytes(rc.code_hmac));
    if (!good) {
      const tries = N(rc.failed_attempts) + 1;
      const max = s.release_code.max_attempts;
      if (tries >= max) {
        const until = addMinutes(now, s.release_code.lock_minutes);
        await tx.db.query("update release_codes set failed_attempts = 0, locked_until = $2 where deal_id = $1", [dealId, until]);
        await tx.db.query("insert into deal_events (deal_id, type, actor, actor_id, payload) values ($1, 'release_code_locked', 'system', null, '{}')", [dealId]);
        return { ok: false, locked: true, message: `Too many wrong codes. Ask the buyer to check their code, then try again at ${when(until, now)}.` };
      }
      await tx.db.query("update release_codes set failed_attempts = $2 where deal_id = $1", [dealId, tries]);
      const leftN = max - tries;
      return { ok: false, message: `That code doesn’t match. ${leftN} ${leftN === 1 ? "try" : "tries"} left.` };
    }
    await release(d, tx, deal, "code");
    return { ok: true };
  });
}

export async function markDelivered(d: Deps, sellerId: string, dealId: string) {
  return inTx(d.db, { type: "seller", id: sellerId }, async (tx) => {
    const s = await settingsOf(d);
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.seller_id !== sellerId) throw new DealError("forbidden", "Only the seller can mark this delivered.", 403);
    if (deal.state !== "held" || deal.handover !== "delivery" || deal.delivered_at) throw new DealError("state", "This deal can't be marked delivered now.");
    const due = addHours(now, s.delivery_confirm_hours);
    await tx.db.query("update deals set delivered_at = $2, release_due_at = $3 where id = $1", [dealId, now, due]);
    await tx.db.query("insert into deal_events (deal_id, type, actor, actor_id, payload) values ($1, 'marked_delivered', 'seller', $2, '{}')", [dealId, sellerId]);
    await notify(d, tx, deal.buyer_id, dealId, "delivered", `Your item was marked delivered. Check it, then confirm or report a problem by ${when(due, now)}. If you do neither, the money is released.`);
    schedule(d, tx, "delivery_release", dealId, due);
  });
}

export async function confirmReceived(d: Deps, buyerId: string, dealId: string) {
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    if (deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can confirm receipt.", 403);
    if (deal.state !== "held" || !deal.delivered_at) throw new DealError("state", "This deal isn't waiting for your confirmation.");
    await release(d, tx, deal, "confirmed");
  });
}

/** Refunds the buyer in full (fee included). Call with the deal locked. */
export async function refund(d: Deps, tx: Tx, deal: DealRow, why: "cancelled" | "reviewer" | "review_hold") {
  if (deal.state !== "held" && deal.state !== "disputed") throw new DealError("state", "This deal can't be refunded now.");
  const paid = await amountPaid(tx.db, deal.id);
  await post(tx.db, deal.id, "refund_due", [{ account: "held_funds", debit: paid }, { account: "refunds_due", credit: paid }], why);
  await tx.db.query("update deals set state = 'refunded', review_hold = false, review_hold_reason = null where id = $1", [deal.id]);
  await tx.db.query("update release_codes set voided_at = now() where deal_id = $1 and used_at is null and voided_at is null", [deal.id]);
  const p = await one<{ id: string }>(tx.db, "select id from payments where deal_id = $1 and not sent_back order by received_at limit 1", [deal.id]);
  if (p && paid > 0) await createTransfer(d, tx, deal.id, "refund", paid, { refundPaymentId: p.id });
  await notify(d, tx, deal.buyer_id, deal.id, "refund_due",
    refundWords(await refundTarget(tx, p?.id), paid, `${naira(paid)} is being refunded to the account you paid from.`));
}

// ---------------------------------------------------------------------------
// Chat and ratings
// ---------------------------------------------------------------------------

const OFF_PLATFORM = /(pay|send|transfer)[^.]{0,30}(to|into)\s+my\s+(account|bank)|account\s*(number|no)|\b\d{10}\b|outside\s+noshen|direct(ly)?\s+to\s+me/i;

export async function sendMessage(d: Deps, userId: string, dealId: string, body: string) {
  const text = body.trim();
  if (!text) return;
  const deal = await one(d.db, "select buyer_id, seller_id from deals where id = $1", [dealId]);
  if (!deal || (deal.buyer_id !== userId && deal.seller_id !== userId)) throw new DealError("forbidden", "This deal isn't yours.", 403);
  const flagged = OFF_PLATFORM.test(text);
  const saved = await one<{ id: string }>(d.db, "insert into messages (deal_id, sender_id, body, flagged, flag_reason) values ($1, $2, $3, $4, $5) returning id",
    [dealId, userId, text.slice(0, 2000), flagged, flagged ? "looks like payment outside NosHen" : null]);
  // The other person sees it now if the deal is open on their screen; if not, their phone tells them.
  const other = deal.buyer_id === userId ? deal.seller_id : deal.buyer_id;
  await d.live?.changed(dealId, "message").catch(() => {});
  if (d.push && !(await d.live?.watching(dealId, other).catch(() => false))) {
    const from = firstName(await userName(d.db, userId));
    await pushToUser(d, d.push, other, { title: `Message from ${from}`, body: text.length > 140 ? `${text.slice(0, 137)}…` : text, url: `/d/${dealId}#chat`, tag: `chat-${dealId}` });
  }
  return saved!.id;
}

export async function rate(d: Deps, userId: string, dealId: string, stars: number, comment?: string) {
  const deal = await one(d.db, "select buyer_id, seller_id, state from deals where id = $1", [dealId]);
  if (!deal || (deal.buyer_id !== userId && deal.seller_id !== userId)) throw new DealError("forbidden", "This deal isn't yours.", 403);
  if (deal.state !== "released" && deal.state !== "paid_out") throw new DealError("state", "You can rate once the deal is closed.");
  if (!(stars >= 1 && stars <= 5)) throw new DealError("stars", "Pick 1 to 5 stars.");
  const ratee = deal.buyer_id === userId ? deal.seller_id : deal.buyer_id;
  await d.db.query(
    `insert into ratings (deal_id, rater_id, ratee_id, stars, comment) values ($1, $2, $3, $4, $5)
     on conflict (deal_id, rater_id) do update set stars = excluded.stars, comment = excluded.comment`,
    [dealId, userId, ratee, stars, comment?.trim().slice(0, 500) || null]);
}

export async function releaseCodeForBuyer(d: Deps, buyerId: string, dealId: string): Promise<string> {
  const deal = await one(d.db, "select buyer_id, state from deals where id = $1", [dealId]);
  if (!deal || deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can see the release code.", 403);
  if (deal.state !== "held") throw new DealError("state", "There's no release code for this deal now.");
  return releaseCodeFor(d.secrets.releaseCode, dealId);
}
