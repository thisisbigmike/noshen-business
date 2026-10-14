import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSigner, getBase58Decoder, isAddress } from "@solana/kit";
import { world, person, verifiedSeller, liveListing, stateOf, type TestWorld } from "./helpers";
import { SolanaPartner, coinIn, depositRef } from "@noshen/engine/partner/solana";
import { CryptoRouter } from "@noshen/engine/partner/crypto-router";
import { FAKE_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import type { CryptoPartner, CryptoRefund, PartnerEvent, WatchedDeposit } from "@noshen/engine/partner/types";
import { acceptDeal, cancelDeal, releaseByCode, releaseCodeForBuyer, requestDeal } from "@noshen/engine/deals";
import { prepareCryptoPayment, saveRefundAddress, watchCrypto } from "@noshen/engine/stablecoins";
import { coinMicroFor, koboForCoin, type Coin, type Network } from "@noshen/shared/payments";

const b58 = getBase58Decoder();
const randomSig = () => b58.decode(crypto.getRandomValues(new Uint8Array(64)));
const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const ok = <T>(value: T) => ({ send: async () => value });

/** A stand-in for a Solana RPC: records what's sent and answers from what the test sets up. */
function fakeRpc() {
  const sent: string[] = [];
  const state = {
    sigs: [] as { signature: string; err: null | object; blockTime: bigint | null }[],
    txs: new Map<string, unknown>(),
    statuses: [] as unknown[],
  };
  const rpc = {
    getLatestBlockhash: () => ok({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100n } }),
    sendTransaction: (wire: string) => { sent.push(wire); return ok(randomSig()); },
    getSignaturesForAddress: () => ok(state.sigs),
    getTransaction: (sig: string) => ok(state.txs.get(sig) ?? null),
    getSignatureStatuses: () => ok({ value: state.statuses }),
  };
  return { rpc: rpc as never, sent, state };
}

async function partner(opts: { demo?: boolean } = {}) {
  const [usdc, usdt] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const r = fakeRpc();
  let checks = 0;
  const p = new SolanaPartner({
    rpcUrl: "http://unused", cluster: "devnet", mints: { usdc: usdc.address, usdt: usdt.address },
    walletSecret: secret(), depositSecret: "deposit-secret", demoWalletSecret: opts.demo ? secret() : undefined,
  }, async () => { checks++; }, r.rpc);
  return { p, ...r, mints: { usdc: usdc.address as string, usdt: usdt.address as string }, checks: () => checks };
}

describe("NosHen's Solana wallet", () => {
  it("gives each deal and coin its own address, the same every time, and opens its token account", async () => {
    const { p, sent, checks } = await partner();
    const a = await p.openDeposit("deal-1", "usdc", "solana");
    const again = await p.openDeposit("deal-1", "usdc", "solana");
    const other = await p.openDeposit("deal-2", "usdc", "solana");
    const usdt = await p.openDeposit("deal-1", "usdt", "solana");
    expect(a).toEqual(again);
    expect(isAddress(a.address)).toBe(true);
    expect(new Set([a.address, other.address, usdt.address]).size).toBe(3);
    expect(a.ref).toBe(depositRef("usdc", "deal-1"));
    expect(sent.length).toBe(4); // one transaction each, opening the token account (fees paid by NosHen's wallet)
    expect(checks()).toBe(4);    // and a check of the chain is booked after each
    await expect(p.openDeposit("deal-1", "usdc", "base")).rejects.toThrow(/can't take base/);
  });

  it("reads payments into a deal's address from the chain: the exact amount in time pays the deal, others convert", async () => {
    const { p, state, mints } = await partner();
    const { address } = await p.openDeposit("deal-3", "usdc", "solana");
    const due = 45_675_000;
    const micro = coinMicroFor(due, FAKE_RATE_KOBO.usdc);
    const tx = (pre: string | null, post: string) => ({
      meta: { err: null, preTokenBalances: pre === null ? [] : [{ owner: address, mint: mints.usdc, uiTokenAmount: { amount: pre } }],
        postTokenBalances: [{ owner: address, mint: mints.usdc, uiTokenAmount: { amount: post } }] },
    });
    const [s1, s2, s3] = [randomSig(), randomSig(), randomSig()];
    const now = BigInt(Math.floor(Date.now() / 1000));
    // Newest first, as the RPC gives them: a refund out, a second payment, the first payment (which opened the account).
    state.sigs = [{ signature: s3, err: null, blockTime: now }, { signature: s2, err: null, blockTime: now }, { signature: s1, err: null, blockTime: now }];
    state.txs.set(s1, tx(null, String(micro)));
    state.txs.set(s2, tx(String(micro), String(micro + 1_000_000)));
    state.txs.set(s3, tx(String(micro + 1_000_000), String(micro)));
    const dep: WatchedDeposit = { ref: depositRef("usdc", "deal-3"), coin: "usdc", network: "solana", address, amountMicro: micro,
      amountKobo: due, rateKobo: FAKE_RATE_KOBO.usdc, quoteExpiresAt: new Date(Date.now() + 60_000), cursor: null };
    const { events, cursor } = await p.watch(dep);
    expect(cursor).toBe(s3);
    expect(events.map((e) => e.type === "crypto.received" && [e.data.tx_hash, e.data.amount_micro, e.data.amount_kobo])).toEqual([
      [s1, micro, due],
      [s2, 1_000_000, koboForCoin(1_000_000, FAKE_RATE_KOBO.usdc)],
    ]);
    // Too late for the fixed amount: converted at the rate instead of paying the deal outright.
    const late = await p.watch({ ...dep, quoteExpiresAt: new Date(Date.now() - 600_000) });
    expect(late.events[0].type === "crypto.received" && late.events[0].data.amount_kobo).toBe(koboForCoin(micro, FAKE_RATE_KOBO.usdc));
  });

  it("counts only the right coin into the right address", () => {
    const meta = {
      preTokenBalances: [{ owner: "A", mint: "M", uiTokenAmount: { amount: "5" } }, { owner: "B", mint: "M", uiTokenAmount: { amount: "0" } }],
      postTokenBalances: [{ owner: "A", mint: "M", uiTokenAmount: { amount: "2" } }, { owner: "B", mint: "M", uiTokenAmount: { amount: "3" } },
        { owner: "A", mint: "OTHER", uiTokenAmount: { amount: "99" } }],
    };
    expect(coinIn(meta, "B", "M")).toBe(3);
    expect(coinIn(meta, "A", "M")).toBe(-3);
    expect(coinIn(meta, "C", "M")).toBe(0);
  });

  it("sends refunds from the deal's address, and reports them once the network settles", async () => {
    const { p, sent, state } = await partner();
    const buyer = await generateKeyPairSigner();
    const r: CryptoRefund = { transferId: "t1", amountKobo: 100, idempotencyKey: "k", coin: "usdc", network: "solana", address: buyer.address, depositRef: depositRef("usdc", "deal-4"), micro: 2_500_000 };
    await expect(p.sendRefund({ ...r, micro: undefined })).rejects.toThrow(/needs its deposit/);
    const { partnerRef } = await p.sendRefund(r);
    expect(sent.length).toBe(1);
    const [done, failed, lost, waiting] = [randomSig(), randomSig(), randomSig(), randomSig()];
    state.statuses = [{ confirmationStatus: "confirmed", err: null }, { confirmationStatus: "confirmed", err: { InstructionError: [1, "x"] } }, null, null];
    const events = await p.settled("solana", [
      { transferId: "a", partnerRef: done, sentAt: new Date() }, { transferId: "b", partnerRef: failed, sentAt: new Date() },
      { transferId: "c", partnerRef: lost, sentAt: new Date(Date.now() - 10 * 60_000) }, { transferId: "d", partnerRef: waiting, sentAt: new Date() },
    ]);
    expect(events.map((e) => [e.type, "transfer_id" in e.data ? e.data.transfer_id : null])).toEqual([
      ["transfer.succeeded", "a"], ["transfer.failed", "b"], ["transfer.failed", "c"],
    ]);
    expect(typeof partnerRef).toBe("string");
  });

  it("pays from the demo wallet only on devnet, and links to Solana Explorer on the right cluster", async () => {
    const without = await partner();
    await expect(without.p.demoPay("solana", depositRef("usdc", "deal-5"), 1_000_000)).rejects.toThrow(/only pays on devnet/);
    const withDemo = await partner({ demo: true });
    await withDemo.p.demoPay("solana", depositRef("usdc", "deal-5"), 1_000_000);
    expect(withDemo.sent.length).toBe(1); // minted to the demo wallet and paid to the deal in one transaction
    expect(withDemo.p.explorer("solana", "tx", "abc")).toBe("https://explorer.solana.com/tx/abc?cluster=devnet");
    expect(withDemo.p.explorer("base", "tx", "abc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The money engine with an on-chain partner: a stand-in for the Solana wallet behind the router.
// ---------------------------------------------------------------------------

class ChainStub implements CryptoPartner {
  readonly name = "solana-devnet";
  readonly test = true;
  readonly watches = ["solana"] as const;
  arrivals = new Map<string, PartnerEvent[]>();
  refunds: CryptoRefund[] = [];
  collected: { ref: string; micro: number }[] = [];
  mode() { return "devnet" as const; }
  async quote(amountKobo: number, coin: Coin, now: Date) {
    return { rateKobo: FAKE_RATE_KOBO[coin], micro: coinMicroFor(amountKobo, FAKE_RATE_KOBO[coin]), expiresAt: new Date(now.getTime() + 30 * 60_000) };
  }
  async openDeposit(dealId: string, coin: Coin, network: Network) {
    return { ref: depositRef(coin, dealId), address: `addr-${network}-${dealId.slice(0, 8)}` };
  }
  /** The chain has a payment of `micro` into this deposit. */
  pay(ref: string, micro: number, kobo: number) {
    const sig = randomSig();
    const list = this.arrivals.get(ref) ?? [];
    list.push({ id: `sol:${sig}`, type: "crypto.received", data: { deposit_ref: ref, coin: "usdc", network: "solana", amount_micro: micro, amount_kobo: kobo, tx_hash: sig, received_at: new Date().toISOString() } });
    this.arrivals.set(ref, list);
  }
  async watch(dep: WatchedDeposit) {
    const all = this.arrivals.get(dep.ref) ?? [];
    const from = dep.cursor ? all.findIndex((e) => e.id === dep.cursor) + 1 : 0;
    return { events: all.slice(from), cursor: all.length ? all[all.length - 1].id : dep.cursor };
  }
  async sendRefund(r: CryptoRefund) { this.refunds.push(r); return { partnerRef: `refund-${this.refunds.length}` }; }
  async settled(_n: Network, sent: { transferId: string; partnerRef: string }[]) {
    return sent.map((t): PartnerEvent => ({ id: `done:${t.partnerRef}`, type: "transfer.succeeded", data: { transfer_id: t.transferId, partner_ref: t.partnerRef } }));
  }
  async collect(_n: Network, ref: string, micro: number) { this.collected.push({ ref, micro }); return `collect-${this.collected.length}`; }
  async verifyWebhook(): Promise<PartnerEvent> { throw new Error("no webhooks"); }
}

let w: TestWorld;
let chain: ChainStub;
beforeAll(async () => {
  w = await world();
  chain = new ChainStub();
  w.d.crypto = new CryptoRouter({ solana: chain }, w.crypto);
});
afterAll(async () => { await w.db.end(); });

async function solanaDeal() {
  const seller = await verifiedSeller(w, "Ada Obi");
  const buyer = await person(w, "Chinedu Eze");
  const dealId = await requestDeal(w.d, buyer, { listingId: await liveListing(w, seller, 300_000), handover: "meetup" });
  await acceptDeal(w.d, seller, dealId);
  await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "solana");
  const dep = (await w.db.query("select provider, provider_ref, amount_micro, amount_kobo, watched_until from crypto_deposits where deal_id = $1", [dealId])).rows[0];
  return { seller, buyer, dealId, dep };
}

describe("paying on Solana, read from the chain", () => {
  it("holds the deal when the payment shows on-chain, takes it once, and collects the coin at release", async () => {
    const { seller, buyer, dealId, dep } = await solanaDeal();
    expect(dep.provider).toBe("solana-devnet");
    // Checks of this deal's address are booked over the next 45 minutes (no every-minute polling of the database).
    expect(w.timers.filter((t) => t.kind === "crypto_watch" && t.dealId === dealId).length).toBe(8);
    expect(await watchCrypto(w.d, dealId)).toEqual({ payments: 0, settled: 0 });
    chain.pay(dep.provider_ref, Number(dep.amount_micro), Number(dep.amount_kobo));
    expect((await watchCrypto(w.d, dealId)).payments).toBe(1);
    expect(await stateOf(w, dealId)).toBe("held");
    const cursor = (await w.db.query("select watched_until from crypto_deposits where deal_id = $1", [dealId])).rows[0].watched_until;
    expect(cursor).toMatch(/^sol:/);
    expect((await watchCrypto(w.d, dealId)).payments).toBe(0); // nothing new past the cursor
    await w.db.query("update crypto_deposits set watched_until = null where deal_id = $1", [dealId]);
    expect((await watchCrypto(w.d, dealId)).payments).toBe(0); // read again from the start: still taken only once
    expect((await w.db.query("select count(*)::int as n from payments where deal_id = $1", [dealId])).rows[0].n).toBe(1);

    await releaseByCode(w.d, seller, dealId, await releaseCodeForBuyer(w.d, buyer, dealId));
    expect(chain.collected).toContainEqual({ ref: dep.provider_ref, micro: Number(dep.amount_micro) });
    const ev = (await w.db.query("select payload from deal_events where deal_id = $1 and type = 'coin_collected'", [dealId])).rows[0];
    expect(ev.payload).toMatchObject({ network: "solana", micro: Number(dep.amount_micro) });
  });

  it("replaces a pretend Solana address from before the switch, and never reads pretend addresses from the chain", async () => {
    const seller = await verifiedSeller(w, "Uche Nwosu");
    const buyer = await person(w, "Halima Bello");
    const dealId = await requestDeal(w.d, buyer, { listingId: await liveListing(w, seller, 120_000), handover: "meetup" });
    await acceptDeal(w.d, seller, dealId);
    const router = w.d.crypto;
    w.d.crypto = w.crypto; // before NosHen's Solana wallet: the pretend partner served Solana too
    await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "solana");
    const before = (await w.db.query("select provider, address from crypto_deposits where deal_id = $1", [dealId])).rows[0];
    expect(before.provider).toBe("fake-crypto");
    w.d.crypto = router;
    expect(await watchCrypto(w.d, dealId)).toEqual({ payments: 0, settled: 0 }); // the pretend address isn't read
    await prepareCryptoPayment(w.d, buyer, dealId, "usdc", "solana"); // the buyer opens the pay screen again
    const after = (await w.db.query("select provider, address, provider_ref from crypto_deposits where deal_id = $1", [dealId])).rows;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ provider: "solana-devnet", provider_ref: depositRef("usdc", dealId) });
    expect(after[0].address).not.toBe(before.address);
  });

  it("refunds on-chain from the deal's address, in the coin paid, and marks it done once settled", async () => {
    const { buyer, dealId, dep } = await solanaDeal();
    chain.pay(dep.provider_ref, Number(dep.amount_micro), Number(dep.amount_kobo));
    await watchCrypto(w.d, dealId);
    await cancelDeal(w.d, buyer, dealId);
    expect(chain.refunds.length).toBe(0); // waits for the buyer's address
    const to = (await generateKeyPairSigner()).address;
    await saveRefundAddress(w.d, buyer, dealId, "usdc", "solana", to);
    const r = chain.refunds.at(-1)!;
    expect(r).toMatchObject({ network: "solana", coin: "usdc", address: to, depositRef: dep.provider_ref, micro: Number(dep.amount_micro) });
    const t = () => w.db.query("select status, partner_ref from transfers where deal_id = $1 and kind = 'refund'", [dealId]).then((x) => x.rows[0]);
    expect(await t()).toMatchObject({ status: "sent" });
    expect((await watchCrypto(w.d, dealId)).settled).toBe(1);
    expect(await t()).toMatchObject({ status: "succeeded" });
  });
});
