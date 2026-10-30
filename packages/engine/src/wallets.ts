import { addressProblem, coinAmount, coinName, networkOf, type Coin, type Network } from "@noshen/shared/payments";
import { DealError, N, nowOf, type Deps } from "./core";
import { asBytes, decryptField, encryptField } from "./crypto";
import { inTx, many, one, type Db, type Tx } from "./db";
import { WALLET_COINS, coinOf, decimalToMicro, familyOf, type AddressFamily, type WalletEvent } from "./partner/blockradar";
import { WalletProviderError, type WalletProvider } from "./partner/types";
import { alertStaff } from "./staff-alerts";

/**
 * Everyone's NosHen wallet: fixed deposit addresses (one on Solana, one shared by Base and BNB Smart Chain) and a
 * balance in each coin on each network. NosHen holds every key through its wallet provider; people never do.
 *
 * Balances are kept here, in a double-entry ledger in millionths of a coin (wallet_entries), apart from the naira
 * ledger. The database refuses an unbalanced transaction and a balance below zero, so two withdrawals racing each
 * other can never spend the same coin twice.
 */

/** Below one coin, network fees would take most of a withdrawal. */
export const MIN_WITHDRAWAL_MICRO = 1_000_000;
/** The most one person can withdraw in 24 hours, every coin and network together. */
export const DAILY_WITHDRAWAL_MICRO = 2_000_000_000;

export interface DepositAddress {
  network: Network;
  /** The coins this address takes on this network. */
  coins: Coin[];
  address: string;
}

export interface WalletBalance {
  coin: Coin;
  network: Network;
  micro: number;
}

type Account = "custody" | "user_balance" | "withdrawals_out";
type Line = { account: Account; userId?: string; coin: Coin; network: Network; debit?: number; credit?: number };

function walletsOf(d: Deps): WalletProvider {
  if (!d.wallets) throw new DealError("wallets", "NosHen wallets aren't set up on this site yet.", 503);
  return d.wallets;
}

/** Posts one balanced wallet transaction. The database also checks the balance, and no balance below zero, at commit. */
async function post(db: Db, kind: string, userId: string | null, lines: Line[], memo?: string): Promise<string> {
  const txn = await one<{ id: string }>(db, "insert into wallet_transactions (kind, user_id, memo) values ($1, $2, $3) returning id", [kind, userId, memo ?? null]);
  for (const l of lines) {
    await db.query(
      "insert into wallet_entries (txn_id, account, user_id, coin, network, debit_micro, credit_micro) values ($1, $2, $3, $4, $5, $6, $7)",
      [txn!.id, l.account, l.account === "user_balance" ? l.userId : null, l.coin, l.network, l.debit ?? 0, l.credit ?? 0],
    );
  }
  return txn!.id;
}

/**
 * A person's deposit addresses, one for each network that's set up. Each is made the first time it's asked for and
 * never changes after that.
 */
export async function depositAddresses(d: Deps, userId: string): Promise<DepositAddress[]> {
  const w = walletsOf(d);
  const networks = w.networks();
  const have = await many<{ family: AddressFamily; address: string }>(d.db, "select family, address from wallet_addresses where user_id = $1", [userId]);
  for (const family of new Set(networks.map(familyOf))) {
    if (have.some((h) => h.family === family)) continue;
    // Made under the first network of the family that's set up: an EVM address receives on every EVM network.
    const made = await w.createAddress(networks.find((n) => familyOf(n) === family)!, `NosHen ${userId}`, { userId });
    // Two requests at once could both make one; the first saved is the person's address for good.
    await d.db.query(
      `insert into wallet_addresses (user_id, family, address, provider, provider_ref) values ($1, $2, $3, $4, $5)
       on conflict (user_id, family) do nothing`,
      [userId, family, made.address, w.name, made.providerRef],
    );
  }
  const rows = await many<{ family: AddressFamily; address: string }>(d.db, "select family, address from wallet_addresses where user_id = $1", [userId]);
  return networks.map((network) => ({ network, coins: WALLET_COINS[network], address: rows.find((r) => r.family === familyOf(network))!.address }));
}

/** What a person holds, in each coin on each network. */
export async function walletBalances(d: Deps, userId: string): Promise<WalletBalance[]> {
  const rows = await many<{ coin: Coin; network: Network; micro: string }>(
    d.db,
    `select coin, network, sum(credit_micro - debit_micro) as micro from wallet_entries
     where account = 'user_balance' and user_id = $1 group by coin, network
     having sum(credit_micro - debit_micro) <> 0 order by coin, network`,
    [userId],
  );
  return rows.map((r) => ({ coin: r.coin, network: r.network, micro: N(r.micro) }));
}

async function balanceOf(db: Db, userId: string, coin: Coin, network: Network): Promise<number> {
  const r = await one<{ micro: string }>(
    db,
    "select coalesce(sum(credit_micro - debit_micro), 0) as micro from wallet_entries where account = 'user_balance' and user_id = $1 and coin = $2 and network = $3",
    [userId, coin, network],
  );
  return N(r?.micro);
}

/** A person's deposits and withdrawals, newest first. */
export async function walletActivity(d: Deps, userId: string, limit = 30) {
  return many<{ kind: "deposit" | "withdrawal"; id: string; coin: Coin; network: Network; micro: string; status: string; tx_hash: string | null; to_last4: string | null; at: Date }>(
    d.db,
    `select * from (
       select 'deposit' as kind, id, coin, network, amount_micro as micro, 'received' as status, tx_hash, null as to_last4, received_at as at
         from wallet_deposits where user_id = $1
       union all
       select 'withdrawal', id, coin, network, amount_micro, status, tx_hash, to_address_last4, created_at
         from wallet_withdrawals where user_id = $1
     ) a order by at desc limit $2`,
    [userId, limit],
  );
}

// ---------------------------------------------------------------------------
// What the wallet provider tells NosHen

/** Records a message from the wallet provider once, then acts on it. A message seen before is ignored. */
export async function handleWalletEvent(d: Deps, ev: WalletEvent): Promise<string> {
  const w = walletsOf(d);
  return inTx(d.db, { type: "partner" }, async (tx) => {
    const fresh = await one<{ id: string }>(
      tx.db,
      `insert into wallet_events (provider, event, provider_ref, network, payload) values ($1, $2, $3, $4, $5)
       on conflict (provider, event, provider_ref) do nothing returning id`,
      [w.name, ev.event, ev.data.id, ev.network, JSON.stringify(ev.data)],
    );
    if (!fresh) return "seen before";
    let result: string;
    if (ev.event === "deposit.success") result = await creditDeposit(d, tx, ev);
    else if (ev.event === "withdraw.success") result = await settleWithdrawal(tx.db, ev);
    else if (ev.event === "withdraw.failed" || ev.event === "withdraw.cancelled") result = await failWithdrawal(tx.db, ev);
    else result = "noted";
    await tx.db.query("update wallet_events set result = $1 where id = $2", [result, fresh.id]);
    return result;
  });
}

async function creditDeposit(d: Deps, tx: Tx, ev: WalletEvent): Promise<string> {
  const t = ev.data;
  const to = t.address?.address ?? t.recipientAddress ?? "";
  // EVM addresses may arrive in either letter case; Solana's are case-sensitive.
  const addr = await one<{ id: string; user_id: string }>(
    tx.db,
    to.startsWith("0x") ? "select id, user_id from wallet_addresses where lower(address) = lower($1)" : "select id, user_id from wallet_addresses where address = $1",
    [to],
  );
  const coin = coinOf(t.asset?.symbol);
  const amount = `${t.amount ?? "?"} ${t.asset?.symbol ?? "(unknown token)"} on ${networkOf(ev.network).name}`;
  // Anything NosHen can't credit stays with the provider, untouched, until staff return it to the sender.
  const hold = async (why: string) => {
    await alertStaff(d, tx, "wallet_check", "Wallet deposit needs a look", `${amount}: ${why}. Transaction ${t.hash ?? t.id}.`, addr ? `/users/${addr.user_id}` : "/money");
    return `not credited: ${why}`;
  };
  if (!addr) return hold("sent to an address that isn't anyone's");
  if (!coin || !WALLET_COINS[ev.network].includes(coin)) return hold("NosHen doesn't take this token on this network");
  if (t.amlScreening?.status && t.amlScreening.status !== "success") return hold(`the sender failed the sanctions check (${t.amlScreening.message ?? t.amlScreening.status})`);
  const micro = decimalToMicro(t.amount ?? "0");
  if (micro <= 0) return "nothing to credit";
  const txn = await post(tx.db, "deposit", addr.user_id, [
    { account: "custody", coin, network: ev.network, debit: micro },
    { account: "user_balance", userId: addr.user_id, coin, network: ev.network, credit: micro },
  ]);
  await tx.db.query(
    `insert into wallet_deposits (provider_ref, user_id, address_id, coin, network, amount_micro, tx_hash, sender_address, txn_id, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [t.id, addr.user_id, addr.id, coin, ev.network, micro, t.hash ?? null, t.senderAddress ?? null, txn, t.createdAt ? new Date(t.createdAt) : nowOf(d)],
  );
  return `credited ${coinAmount(micro, coin)} on ${networkOf(ev.network).name}`;
}

interface WithdrawalRow {
  id: string; user_id: string; coin: Coin; network: Network; amount_micro: string; status: string; provider_ref: string | null;
}

/** The withdrawal a provider message is about: by the provider's id for it, or by NosHen's own id given as reference. */
async function withdrawalFor(db: Db, ev: WalletEvent): Promise<WithdrawalRow | null> {
  const byRef = await one<WithdrawalRow>(db, "select * from wallet_withdrawals where provider_ref = $1 for update", [ev.data.id]);
  if (byRef) return byRef;
  const ours = ev.data.reference ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(ours)) return null;
  return one<WithdrawalRow>(db, "select * from wallet_withdrawals where id = $1 for update", [ours]);
}

async function settleWithdrawal(db: Db, ev: WalletEvent): Promise<string> {
  const wd = await withdrawalFor(db, ev);
  if (!wd) return "not a withdrawal NosHen made";
  if (wd.status === "succeeded" || wd.status === "failed") return `already ${wd.status}`;
  const micro = N(wd.amount_micro);
  await post(db, "withdrawal_sent", wd.user_id, [
    { account: "withdrawals_out", coin: wd.coin, network: wd.network, debit: micro },
    { account: "custody", coin: wd.coin, network: wd.network, credit: micro },
  ]);
  await db.query(
    "update wallet_withdrawals set status = 'succeeded', provider_ref = coalesce(provider_ref, $2), tx_hash = coalesce($3, tx_hash) where id = $1",
    [wd.id, ev.data.id, ev.data.hash ?? null],
  );
  return `withdrawal ${wd.id} confirmed`;
}

async function failWithdrawal(db: Db, ev: WalletEvent): Promise<string> {
  const wd = await withdrawalFor(db, ev);
  if (!wd) return "not a withdrawal NosHen made";
  if (wd.status === "succeeded" || wd.status === "failed") return `already ${wd.status}`;
  await returnToBalance(db, wd, ev.data.reason ?? ev.event);
  await db.query("update wallet_withdrawals set provider_ref = coalesce(provider_ref, $2) where id = $1", [wd.id, ev.data.id]);
  return `withdrawal ${wd.id} failed; the coin went back to the balance`;
}

async function returnToBalance(db: Db, wd: WithdrawalRow, reason: string) {
  const micro = N(wd.amount_micro);
  await post(db, "withdrawal_returned", wd.user_id, [
    { account: "withdrawals_out", coin: wd.coin, network: wd.network, debit: micro },
    { account: "user_balance", userId: wd.user_id, coin: wd.coin, network: wd.network, credit: micro },
  ], reason.slice(0, 300));
  await db.query("update wallet_withdrawals set status = 'failed', failure_reason = $2 where id = $1", [wd.id, reason.slice(0, 300)]);
}

// ---------------------------------------------------------------------------
// Withdrawals

/**
 * Sends coin from a person's balance to an address outside NosHen. The coin leaves the balance before the provider
 * is asked, so it can't be spent twice; if the provider refuses, it comes straight back.
 */
export async function requestWithdrawal(
  d: Deps,
  userId: string,
  input: { coin: Coin; network: Network; address: string; amountMicro: number },
): Promise<{ id: string; status: string }> {
  const w = walletsOf(d);
  const { coin, network, amountMicro } = input;
  const address = input.address.trim();
  const where = networkOf(network)?.name ?? network;
  if (!w.networks().includes(network)) throw new DealError("network", `Withdrawals on ${where} aren't set up yet.`);
  if (!WALLET_COINS[network].includes(coin)) throw new DealError("coin", `${coinName(coin)} can't be sent on ${where}.`);
  const problem = addressProblem(coin, network, address);
  if (problem) throw new DealError("address", problem);
  if (!Number.isSafeInteger(amountMicro) || amountMicro < MIN_WITHDRAWAL_MICRO) {
    throw new DealError("amount", `The smallest withdrawal is ${coinAmount(MIN_WITHDRAWAL_MICRO, coin)}.`);
  }
  if (!(await one(d.db, "select 1 from kyc_checks where user_id = $1 and result = 'verified'", [userId]))) {
    throw new DealError("id", "Verify your ID before you withdraw.", 403);
  }
  if ((await balanceOf(d.db, userId, coin, network)) < amountMicro) {
    throw new DealError("balance", `You don't have that much ${coinName(coin)} on ${where}.`);
  }
  const since = new Date(nowOf(d).getTime() - 24 * 3600_000);
  const today = await one<{ s: string }>(
    d.db,
    "select coalesce(sum(amount_micro), 0) as s from wallet_withdrawals where user_id = $1 and status <> 'failed' and created_at > $2",
    [userId, since],
  );
  if (N(today?.s) + amountMicro > DAILY_WITHDRAWAL_MICRO) {
    throw new DealError("limit", `You can withdraw up to ${(DAILY_WITHDRAWAL_MICRO / 1e6).toLocaleString("en-NG")} a day. Try a smaller amount, or again tomorrow.`);
  }
  const screened = await w.screen(network, address).catch(() => null);
  if (!screened) throw new DealError("screen", "We couldn't check that address just now. Please try again in a minute.", 503);
  if (!screened.ok) throw new DealError("address", "NosHen can't send to that address.", 403);

  let id: string;
  try {
    id = await inTx(d.db, { type: "system" }, async (tx) => {
      const row = await one<{ id: string }>(
        tx.db,
        `insert into wallet_withdrawals (user_id, coin, network, amount_micro, to_address_enc, to_address_last4)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [userId, coin, network, amountMicro, await encryptField(d.secrets.fieldKey, address), address.slice(-4)],
      );
      await post(tx.db, "withdrawal", userId, [
        { account: "user_balance", userId, coin, network, debit: amountMicro },
        { account: "withdrawals_out", coin, network, credit: amountMicro },
      ]);
      return row!.id;
    });
  } catch (e: any) {
    // Another withdrawal spent the coin first: the database caught it at commit.
    if (e?.code === "23514" && /below zero/.test(String(e.message))) throw new DealError("balance", `You don't have that much ${coinName(coin)} on ${where}.`);
    throw e;
  }
  return { id, status: await sendWithdrawal(d, id) };
}

/**
 * Asks the provider to send a withdrawal that hasn't been sent yet. If the provider refuses, the coin goes back to
 * the balance. If its answer never comes, the withdrawal stays pending: it may have gone out, so staff check with the
 * provider (by the withdrawal's id, its reference there) before anyone sends it again.
 */
export async function sendWithdrawal(d: Deps, withdrawalId: string): Promise<string> {
  const w = walletsOf(d);
  const wd = await one<WithdrawalRow & { to_address_enc: Uint8Array }>(d.db, "select * from wallet_withdrawals where id = $1", [withdrawalId]);
  if (!wd) throw new DealError("withdrawal", "There's no such withdrawal.", 404);
  if (wd.status !== "pending" || wd.provider_ref) return wd.status;
  const address = await decryptField(d.secrets.fieldKey, asBytes(wd.to_address_enc));
  try {
    const sent = await w.withdraw(wd.network, { coin: wd.coin, address, amountMicro: N(wd.amount_micro), reference: wd.id, note: "NosHen withdrawal" });
    // The provider's "done" message can arrive first; then this leaves its answer alone.
    await d.db.query(
      "update wallet_withdrawals set status = 'sent', provider_ref = $2, tx_hash = coalesce($3, tx_hash) where id = $1 and status = 'pending'",
      [wd.id, sent.providerRef, sent.hash],
    );
    return "sent";
  } catch (e: any) {
    if (e instanceof WalletProviderError && e.refused) {
      await inTx(d.db, { type: "system" }, async (tx) => {
        const fresh = await one<WithdrawalRow>(tx.db, "select * from wallet_withdrawals where id = $1 and status = 'pending' for update", [wd.id]);
        if (fresh) await returnToBalance(tx.db, fresh, e.message);
      });
      return "failed";
    }
    await inTx(d.db, { type: "system" }, async (tx) => {
      await tx.db.query("update wallet_withdrawals set failure_reason = $2 where id = $1", [wd.id, `No answer from the wallet provider; check there before sending again. ${String(e?.message ?? e)}`.slice(0, 300)]);
      await alertStaff(d, tx, "wallet_check", "Withdrawal needs a look",
        `${coinAmount(N(wd.amount_micro), wd.coin)} on ${networkOf(wd.network).name}: the wallet provider didn't answer. Check whether it went out before sending again.`, `/users/${wd.user_id}`);
    });
    return "pending";
  }
}
