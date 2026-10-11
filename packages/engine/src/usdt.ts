import { inTx, one } from "./db";
import { DealError, N, lockDeal, nowOf, type Deps } from "./core";
import { asBytes, decryptField, encryptField } from "./crypto";
import { isNetwork, last4, usdtAddressProblem, type UsdtNetwork } from "@noshen/shared/payments";

/** What the USDT pay screen shows: where to send, how much, and until when that amount holds. */
export interface UsdtPayment {
  network: UsdtNetwork;
  address: string;
  usdtMicro: number;
  rateKoboPerUsdt: number;
  amountKobo: number;
  expiresAt: Date;
  refundLast4: string;
}

/**
 * The buyer's USDT payment on one network, if they've started one, and the refund address they used last time
 * on that network (to fill in the form).
 */
export async function usdtPaymentFor(d: Deps, buyerId: string, dealId: string, network: UsdtNetwork) {
  const dep = await one(d.db,
    `select c.* from crypto_deposits c join deals x on x.id = c.deal_id where c.deal_id = $1 and c.network = $2 and x.buyer_id = $3`,
    [dealId, network, buyerId]);
  const last = await one<{ refund_address_enc: unknown }>(d.db,
    `select c.refund_address_enc from crypto_deposits c join deals x on x.id = c.deal_id
      where x.buyer_id = $1 and c.network = $2 order by c.updated_at desc limit 1`, [buyerId, network]);
  const refundAddress = last ? await decryptField(d.secrets.fieldKey, asBytes(last.refund_address_enc)) : null;
  const payment: UsdtPayment | null = dep ? {
    network, address: dep.address, usdtMicro: N(dep.usdt_micro), rateKoboPerUsdt: N(dep.rate_kobo_per_usdt),
    amountKobo: N(dep.amount_kobo), expiresAt: new Date(dep.quote_expires_at), refundLast4: dep.refund_address_last4,
  } : null;
  return { payment, refundAddress };
}

/**
 * Gets a deal ready for USDT on a network: an address from the crypto partner, and the USDT amount, fixed for
 * 30 minutes. With refundAddress, saves where refunds go (needed before the first address is shown). Without it,
 * gets a new amount once the old one has run out.
 */
export async function prepareUsdtPayment(d: Deps, buyerId: string, dealId: string, network: string, refundAddress?: string) {
  if (!d.crypto) throw new DealError("no_usdt", "Paying with USDT isn't available yet. Pay by bank transfer instead.");
  if (!isNetwork(network)) throw new DealError("network", "Choose Solana, BNB Smart Chain, Base or Ethereum.");
  const crypto = d.crypto;
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can pay into this deal.", 403);
    if (deal.state !== "accepted") throw new DealError("state", "This deal isn't waiting for a payment.");
    if (deal.payment_due_at && new Date(deal.payment_due_at) <= now) throw new DealError("expired", "The time to pay for this deal has run out.");

    const dep = await one(tx.db, "select * from crypto_deposits where deal_id = $1 and network = $2 for update", [dealId, network]);
    let refundEnc: Uint8Array | null = null;
    let refund4: string | null = null;
    if (refundAddress !== undefined) {
      const a = refundAddress.trim();
      const problem = usdtAddressProblem(network, a);
      if (problem) throw new DealError("refund_address", problem);
      refundEnc = await encryptField(d.secrets.fieldKey, a);
      refund4 = last4(a);
    } else if (!dep) {
      throw new DealError("refund_address", "Add your address for refunds first.");
    }

    const due = N(deal.amount_due_kobo);
    const stale = !dep || new Date(dep.quote_expires_at) <= now || N(dep.amount_kobo) !== due;
    const q = stale ? await crypto.quote(due, now) : null;
    if (!dep) {
      const opened = await crypto.openDeposit(dealId, network);
      await tx.db.query(
        `insert into crypto_deposits (deal_id, network, provider, provider_ref, address, amount_kobo, usdt_micro, rate_kobo_per_usdt, quote_expires_at, refund_address_enc, refund_address_last4)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [dealId, network, crypto.name, opened.ref, opened.address, due, q!.usdtMicro, q!.rateKoboPerUsdt, q!.expiresAt, refundEnc, refund4]);
      return;
    }
    await tx.db.query(
      `update crypto_deposits set
         refund_address_enc = coalesce($2, refund_address_enc), refund_address_last4 = coalesce($3, refund_address_last4),
         amount_kobo = coalesce($4, amount_kobo), usdt_micro = coalesce($5, usdt_micro),
         rate_kobo_per_usdt = coalesce($6, rate_kobo_per_usdt), quote_expires_at = coalesce($7, quote_expires_at)
       where id = $1`,
      [dep.id, refundEnc, refund4, q ? due : null, q?.usdtMicro ?? null, q?.rateKoboPerUsdt ?? null, q?.expiresAt ?? null]);
  });
}
