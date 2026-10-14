import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EvmPartner, evmDepositRef, viemClient, type EvmNetwork, type EvmNetworkSettings } from "@noshen/engine/partner/evm";
import { FAKE_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import { koboForCoin } from "@noshen/shared/payments";
import type { PartnerEvent } from "@noshen/engine/partner/types";

// Against the real test networks, with NosHen's wallet from `pnpm evm:setup`. Opt-in: EVM_LIVE=1 pnpm vitest run tests/evm.testnet.test.ts
const file = new URL("../.evm-testnet.vars", import.meta.url);
const v: Record<string, string> = {};
if (existsSync(file)) for (const l of readFileSync(file, "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) v[m[1]] = m[2]; }
const networks = (v.EVM_TESTNETS ? JSON.parse(v.EVM_TESTNETS) : {}) as Partial<Record<EvmNetwork, EvmNetworkSettings>>;
const live = process.env.EVM_LIVE === "1" ? (Object.keys(networks) as EvmNetwork[]) : [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds = 120): Promise<T> {
  for (let i = 0; i < seconds / 2; i++) {
    const got = await fn();
    if (got) return got;
    await wait(2000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(!live.length)("NosHen's wallet on the EVM test networks (live)", () => {
  it.each(live)("on %s: takes a payment, refunds part, and collects the rest", { timeout: 600_000 }, async (network) => {
    const p = new EvmPartner({ networks, walletKey: v.EVM_WALLET, depositSecret: v.EVM_DEPOSIT_SECRET, demoWalletKey: v.EVM_DEMO_WALLET });
    const client = viemClient(network, networks[network]!.rpcUrl);
    const dealId = crypto.randomUUID();
    const opened = await p.openDeposit(dealId, "usdc", network);
    const ref = evmDepositRef(network, "usdc", dealId);
    console.log(network, "deal address", p.explorer(network, "address", opened.address));

    const micro = 2_500_000;
    const paid = await p.demoPay(network, ref, micro);
    expect(await client.waitFor(paid as `0x${string}`)).toBe("success");
    console.log(network, "payment", p.explorer(network, "tx", paid));

    const dep = { ref, coin: "usdc" as const, network, address: opened.address, amountMicro: micro, amountKobo: koboForCoin(micro, FAKE_RATE_KOBO.usdc),
      rateKobo: FAKE_RATE_KOBO.usdc, quoteExpiresAt: new Date(Date.now() + 30 * 60_000), cursor: opened.cursor ?? null };
    let events: PartnerEvent[] = [];
    await until("the payment on-chain", async () => {
      const r = await p.watch(dep);
      dep.cursor = r.cursor;
      events = events.concat(r.events);
      return events.length > 0;
    });
    expect(events[0].type === "crypto.received" && [events[0].data.amount_micro, events[0].data.tx_hash]).toEqual([micro, paid]);

    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const { partnerRef } = await p.sendRefund({ transferId: "live", amountKobo: 1, idempotencyKey: "live", coin: "usdc", network, address: buyer, depositRef: ref, micro: 1_000_000 });
    const settled = await until("the refund to settle", async () => (await p.settled(network, [{ transferId: "live", partnerRef, sentAt: new Date() }]))[0]);
    expect(settled.type).toBe("transfer.succeeded");
    console.log(network, "refund", p.explorer(network, "tx", partnerRef));

    const collected = await p.collect(network, ref, 1_500_000);
    expect(await client.waitFor(collected as `0x${string}`)).toBe("success");
    console.log(network, "collected at release", p.explorer(network, "tx", collected));
    expect(await client.tokenBalance(networks[network]!.usdc as `0x${string}`, opened.address as `0x${string}`)).toBe(0n);
  });
});
