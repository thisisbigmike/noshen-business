import { inTx, one } from "./db";
import { DealError, N, lockDeal, nowOf, type Deps } from "./core";
import { asBytes, decryptField, encryptField } from "./crypto";
import { addressProblem, isCoin, isNetwork, last4, type Coin, type Network } from "@noshen/shared/payments";

/** What the crypto pay screen shows: where to send, how much, and until when that amount holds. */
export interface CryptoPayment {
  coin: Coin;
  network: Network;
  address: string;
  micro: number;
  rateKobo: number;
  amountKobo: number;
  expiresAt: Date;
  refundLast4: string;
}

/** Roughly what a naira amount comes to in each coin, for the list of ways to pay. Null without a crypto partner. */
export async function cryptoQuotes(d: Deps, amountKobo: number) {
  if (!d.crypto) return null;
  const now = nowOf(d);
  const [usdt, usdc] = await Promise.all([d.crypto.quote(amountKobo, "usdt", now), d.crypto.quote(amountKobo, "usdc", now)]);
  return { usdt: { micro: usdt.micro, rateKobo: usdt.rateKobo }, usdc: { micro: usdc.micro, rateKobo: usdc.rateKobo }, test: d.crypto.test };
}

/**
 * The buyer's payment in a coin on a network, if they've started one, and the refund address they used last time
 * on that network (to fill in the form: the same address takes USDT and USDC).
 */
export async function cryptoPaymentFor(d: Deps, buyerId: string, dealId: string, coin: Coin, network: Network) {
  const dep = await one(d.db,
    `select c.* from crypto_deposits c join deals x on x.id = c.deal_id where c.deal_id = $1 and c.coin = $2 and c.network = $3 and x.buyer_id = $4`,
    [dealId, coin, network, buyerId]);
  const last = await one<{ refund_address_enc: unknown }>(d.db,
    `select c.refund_address_enc from crypto_deposits c join deals x on x.id = c.deal_id
      where x.buyer_id = $1 and c.network = $2 order by c.updated_at desc limit 1`, [buyerId, network]);
  const refundAddress = last ? await decryptField(d.secrets.fieldKey, asBytes(last.refund_address_enc)) : null;
  const payment: CryptoPayment | null = dep ? {
    coin, network, address: dep.address, micro: N(dep.amount_micro), rateKobo: N(dep.rate_kobo),
    amountKobo: N(dep.amount_kobo), expiresAt: new Date(dep.quote_expires_at), refundLast4: dep.refund_address_last4,
  } : null;
  return { payment, refundAddress };
}

/**
 * Gets a deal ready for a coin on a network: an address from the crypto partner, and the amount, fixed for
 * 30 minutes. With refundAddress, saves where refunds go (needed before the first address is shown). Without it,
 * gets a new amount once the old one has run out.
 */
export async function prepareCryptoPayment(d: Deps, buyerId: string, dealId: string, coin: string, network: string, refundAddress?: string) {
  if (!d.crypto) throw new DealError("no_crypto", "Paying with USDT or USDC isn't available yet. Pay by bank transfer instead.");
  if (!isCoin(coin)) throw new DealError("coin", "Choose USDT or USDC.");
  if (!isNetwork(network)) throw new DealError("network", "Choose Solana, BNB Smart Chain, Base or Ethereum.");
  const partner = d.crypto;
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const now = nowOf(d);
    const deal = await lockDeal(tx.db, dealId);
    if (deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can pay into this deal.", 403);
    if (deal.state !== "accepted") throw new DealError("state", "This deal isn't waiting for a payment.");
    if (deal.payment_due_at && new Date(deal.payment_due_at) <= now) throw new DealError("expired", "The time to pay for this deal has run out.");

    const dep = await one(tx.db, "select * from crypto_deposits where deal_id = $1 and coin = $2 and network = $3 for update", [dealId, coin, network]);
    let refundEnc: Uint8Array | null = null;
    let refund4: string | null = null;
    if (refundAddress !== undefined) {
      const a = refundAddress.trim();
      const problem = addressProblem(coin, network, a);
      if (problem) throw new DealError("refund_address", problem);
      refundEnc = await encryptField(d.secrets.fieldKey, a);
      refund4 = last4(a);
    } else if (!dep) {
      throw new DealError("refund_address", "Add your address for refunds first.");
    }

    const due = N(deal.amount_due_kobo);
    const stale = !dep || new Date(dep.quote_expires_at) <= now || N(dep.amount_kobo) !== due;
    const q = stale ? await partner.quote(due, coin, now) : null;
    if (!dep) {
      const opened = await partner.openDeposit(dealId, coin, network);
      await tx.db.query(
        `insert into crypto_deposits (deal_id, coin, network, provider, provider_ref, address, amount_kobo, amount_micro, rate_kobo, quote_expires_at, refund_address_enc, refund_address_last4)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [dealId, coin, network, partner.name, opened.ref, opened.address, due, q!.micro, q!.rateKobo, q!.expiresAt, refundEnc, refund4]);
      return;
    }
    await tx.db.query(
      `update crypto_deposits set
         refund_address_enc = coalesce($2, refund_address_enc), refund_address_last4 = coalesce($3, refund_address_last4),
         amount_kobo = coalesce($4, amount_kobo), amount_micro = coalesce($5, amount_micro),
         rate_kobo = coalesce($6, rate_kobo), quote_expires_at = coalesce($7, quote_expires_at)
       where id = $1`,
      [dep.id, refundEnc, refund4, q ? due : null, q?.micro ?? null, q?.rateKobo ?? null, q?.expiresAt ?? null]);
  });
}
