import { inTx, many, one } from "./db";
import { sendWaitingCryptoRefunds } from "./deals";
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
  refundLast4: string | null;   // null until the buyer gives an address for refunds
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
 * on that network (to fill in the form).
 */
export async function cryptoPaymentFor(d: Deps, buyerId: string, dealId: string, coin: Coin, network: Network) {
  const dep = await one(d.db,
    `select c.* from crypto_deposits c join deals x on x.id = c.deal_id where c.deal_id = $1 and c.coin = $2 and c.network = $3 and x.buyer_id = $4`,
    [dealId, coin, network, buyerId]);
  const refundAddress = await lastAddress(d, buyerId, network);
  const payment: CryptoPayment | null = dep ? {
    coin, network, address: dep.address, micro: N(dep.amount_micro), rateKobo: N(dep.rate_kobo),
    amountKobo: N(dep.amount_kobo), expiresAt: new Date(dep.quote_expires_at), refundLast4: dep.refund_address_last4,
  } : null;
  return { payment, refundAddress };
}

/**
 * Gets a deal ready for a coin on a network: an address from the crypto partner and the amount, fixed for
 * 30 minutes. Opened the first time the buyer picks that coin and network; nothing to fill in first. With refresh,
 * gets a new amount once the old one has run out (never silently: the buyer asks for it).
 */
export async function prepareCryptoPayment(d: Deps, buyerId: string, dealId: string, coin: string, network: string, opts: { refresh?: boolean } = {}) {
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
    const due = N(deal.amount_due_kobo);
    if (!dep) {
      const q = await partner.quote(due, coin, now);
      const opened = await partner.openDeposit(dealId, coin, network);
      await tx.db.query(
        `insert into crypto_deposits (deal_id, coin, network, provider, provider_ref, address, amount_kobo, amount_micro, rate_kobo, quote_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [dealId, coin, network, partner.name, opened.ref, opened.address, due, q.micro, q.rateKobo, q.expiresAt]);
      return;
    }
    const stale = new Date(dep.quote_expires_at) <= now || N(dep.amount_kobo) !== due;
    if (!opts.refresh || !stale) return;
    const q = await partner.quote(due, coin, now);
    await tx.db.query("update crypto_deposits set amount_kobo = $2, amount_micro = $3, rate_kobo = $4, quote_expires_at = $5 where id = $1",
      [dep.id, due, q.micro, q.rateKobo, q.expiresAt]);
  });
}

/**
 * Saves the buyer's own address on a network, for refunds of what they paid (or may pay) with that coin there.
 * Any refund that was waiting for it goes out straight away. Works before paying and after a deal has closed.
 */
export async function saveRefundAddress(d: Deps, buyerId: string, dealId: string, coin: string, network: string, address: string) {
  if (!isCoin(coin) || !isNetwork(network)) throw new DealError("network", "Choose a coin and network.");
  const a = address.trim();
  const problem = addressProblem(coin, network, a);
  if (problem) throw new DealError("refund_address", problem);
  return inTx(d.db, { type: "buyer", id: buyerId }, async (tx) => {
    const deal = await lockDeal(tx.db, dealId);
    if (deal.buyer_id !== buyerId) throw new DealError("forbidden", "Only the buyer can say where refunds go.", 403);
    const dep = await one<{ id: string }>(tx.db, "select id from crypto_deposits where deal_id = $1 and coin = $2 and network = $3 for update", [dealId, coin, network]);
    if (!dep) throw new DealError("no_payment", "There's no payment in that coin on that network for this deal.");
    await tx.db.query("update crypto_deposits set refund_address_enc = $2, refund_address_last4 = $3 where id = $1",
      [dep.id, await encryptField(d.secrets.fieldKey, a), last4(a)]);
    return sendWaitingCryptoRefunds(d, tx, dep.id);
  });
}

/** Refunds of this deal that wait for the buyer's address, and the address they last used on that network (to fill in). */
export async function refundsWaitingForAddress(d: Deps, buyerId: string, dealId: string) {
  const rows = await many<{ coin: Coin; network: Network; amount_kobo: string }>(d.db,
    `select c.coin, c.network, sum(t.amount_kobo) as amount_kobo
       from transfers t join payments p on p.id = t.refund_payment_id join crypto_deposits c on c.id = p.crypto_deposit_id
       join deals x on x.id = t.deal_id
      where t.deal_id = $1 and x.buyer_id = $2 and t.kind = 'refund' and t.status = 'pending' and c.refund_address_enc is null
      group by c.coin, c.network`, [dealId, buyerId]);
  return Promise.all(rows.map(async (r) => ({ coin: r.coin, network: r.network, amountKobo: N(r.amount_kobo), lastAddress: await lastAddress(d, buyerId, r.network) })));
}

/** The refund address this buyer last gave on a network, on any deal: the same address takes USDT and USDC. */
export async function lastAddress(d: Deps, buyerId: string, network: Network): Promise<string | null> {
  const last = await one<{ refund_address_enc: unknown }>(d.db,
    `select c.refund_address_enc from crypto_deposits c join deals x on x.id = c.deal_id
      where x.buyer_id = $1 and c.network = $2 and c.refund_address_enc is not null order by c.updated_at desc limit 1`, [buyerId, network]);
  return last ? decryptField(d.secrets.fieldKey, asBytes(last.refund_address_enc)) : null;
}
