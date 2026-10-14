import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { address, createSolanaRpc, generateKeyPairSigner, signature } from "@solana/kit";
import { SolanaPartner, depositRef } from "@noshen/engine/partner/solana";
import { FAKE_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import { koboForCoin } from "@noshen/shared/payments";

// Against real Solana devnet, with NosHen's wallet from `pnpm solana:setup`. Opt-in: SOLANA_LIVE=1 pnpm test solana.devnet
const file = new URL("../.solana-devnet.vars", import.meta.url);
const live = process.env.SOLANA_LIVE === "1" && existsSync(file);
const v: Record<string, string> = {};
if (live) for (const l of readFileSync(file, "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) v[m[1]] = m[2]; }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds = 60): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const got = await fn();
    if (got) return got;
    await wait(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(!live)("NosHen's Solana wallet on devnet (live)", () => {
  it("opens a deal's address, takes a payment, refunds part on-chain and collects the rest", { timeout: 240_000 }, async () => {
    const rpc = createSolanaRpc(v.SOLANA_RPC_URL);
    const p = new SolanaPartner({
      rpcUrl: v.SOLANA_RPC_URL, cluster: "devnet", mints: { usdc: v.SOLANA_USDC_MINT, usdt: v.SOLANA_USDT_MINT },
      walletSecret: v.SOLANA_WALLET, depositSecret: v.SOLANA_DEPOSIT_SECRET, demoWalletSecret: v.SOLANA_DEMO_WALLET,
    });
    const confirmed = (sig: string) => until(`transaction ${sig}`, async () => {
      const s = (await rpc.getSignatureStatuses([signature(sig)]).send()).value[0];
      if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err, (_, x) => typeof x === "bigint" ? String(x) : x)}`);
      return s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");
    });

    const dealId = crypto.randomUUID();
    const { ref, address: deal } = await p.openDeposit(dealId, "usdc", "solana");
    expect(ref).toBe(depositRef("usdc", dealId));
    console.log("deal address", p.explorer("solana", "address", deal));

    const micro = 2_500_000; // 2.50 test USDC
    const due = koboForCoin(micro, FAKE_RATE_KOBO.usdc);
    const paid = await p.demoPay("solana", ref, micro);
    await confirmed(paid);
    console.log("payment", p.explorer("solana", "tx", paid));

    const dep = { ref, coin: "usdc" as const, network: "solana" as const, address: deal, amountMicro: micro, amountKobo: due,
      rateKobo: FAKE_RATE_KOBO.usdc, quoteExpiresAt: new Date(Date.now() + 30 * 60_000), cursor: null as string | null };
    const seen = await until("the payment on-chain", async () => { const r = await p.watch(dep); return r.events.length ? r : null; });
    const e = seen.events[0];
    expect(e.type === "crypto.received" && [e.data.amount_micro, e.data.amount_kobo, e.data.tx_hash]).toEqual([micro, due, paid]);

    const buyer = await generateKeyPairSigner();
    const { partnerRef: refund } = await p.sendRefund({ transferId: "live-test", amountKobo: koboForCoin(1_000_000, FAKE_RATE_KOBO.usdc),
      idempotencyKey: "live", coin: "usdc", network: "solana", address: buyer.address, depositRef: ref, micro: 1_000_000 });
    const result = await until("the refund to settle", async () => {
      const ev = await p.settled("solana", [{ transferId: "live-test", partnerRef: refund, sentAt: new Date() }]);
      return ev.length ? ev[0] : null;
    });
    expect(result.type).toBe("transfer.succeeded");
    console.log("refund", p.explorer("solana", "tx", refund));

    const collected = await p.collect("solana", ref, 1_500_000);
    await confirmed(collected);
    console.log("collected at release", p.explorer("solana", "tx", collected));

    // Money going out of the address is never taken as a payment in.
    const after = await p.watch({ ...dep, cursor: seen.cursor });
    expect(after.events).toEqual([]);
    const left = await rpc.getTokenAccountsByOwner(address(deal), { mint: address(v.SOLANA_USDC_MINT) }, { encoding: "jsonParsed" }).send();
    const amount = (left.value[0]?.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount;
    expect(amount).toBe("0");
  });
});
