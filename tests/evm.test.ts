import { describe, expect, it } from "vitest";
import { decodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { EvmPartner, evmDepositRef, type EvmClient, type EvmNetwork } from "@noshen/engine/partner/evm";
import { FAKE_RATE_KOBO } from "@noshen/engine/partner/fake-crypto";
import { coinMicroFor, koboForCoin } from "@noshen/shared/payments";

const ERC20 = parseAbi(["function transfer(address to, uint256 value) returns (bool)", "function mint(address to, uint256 value)"]);
const USDC = "0x00000000000000000000000000000000000000c1" as Address;
const USDT = "0x00000000000000000000000000000000000000c2" as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** A stand-in network: records what's sent, and answers from what the test sets up. */
function fakeNetwork() {
  const sent: { from: Address; to: Address; data?: Hex; value?: bigint }[] = [];
  const state = {
    block: 10_000n,
    logs: [] as { hash: Hex; logIndex: number; value: bigint; block: bigint; to: Address }[],
    receipts: new Map<string, "success" | "reverted">(),
    balances: new Map<string, bigint>(),
    tokens: new Map<string, bigint>(),
    lastRange: null as null | [bigint, bigint],
  };
  let n = 0;
  const client: EvmClient = {
    blockNumber: async () => state.block,
    async transfersTo(_token, to, from, toBlock) {
      state.lastRange = [from, toBlock];
      return state.logs.filter((l) => l.to.toLowerCase() === to.toLowerCase() && l.block >= from && l.block <= toBlock);
    },
    blockTime: async () => new Date(),
    receipt: async (h) => state.receipts.get(h) ?? null,
    balance: async (a) => state.balances.get(a.toLowerCase()) ?? 0n,
    tokenBalance: async (_t, a) => state.tokens.get(a.toLowerCase()) ?? 0n,
    gasPrice: async () => 1_000_000_000n,
    async send(from: PrivateKeyAccount, tx) { sent.push({ from: from.address, ...tx }); return hash(++n); },
    waitFor: async () => "success",
  };
  return { client, sent, state };
}

function partner(opts: { demo?: boolean } = {}) {
  const net = fakeNetwork();
  const wallet = generatePrivateKey();
  const p = new EvmPartner({
    networks: { base: { rpcUrl: "http://unused", usdc: USDC, usdt: USDT }, bsc: { rpcUrl: "http://unused", usdc: USDC, usdt: USDT } },
    walletKey: wallet, depositSecret: "evm-deposit-secret", demoWalletKey: opts.demo ? generatePrivateKey() : undefined,
  }, async () => {}, () => net.client);
  return { p, ...net, wallet: privateKeyToAccount(wallet).address };
}

describe("NosHen's wallet on the BNB and Base test networks", () => {
  it("gives each deal and coin its own address, the same on every network, and starts reading just before it opened", async () => {
    const { p } = partner();
    const a = await p.openDeposit("deal-1", "usdc", "base");
    const b = await p.openDeposit("deal-1", "usdc", "bsc");
    const other = await p.openDeposit("deal-2", "usdc", "base");
    const usdt = await p.openDeposit("deal-1", "usdt", "base");
    expect(isAddress(a.address)).toBe(true);
    expect(a.address).toBe(b.address); // one key: a payment sent on the wrong one of these networks can still be returned
    expect(new Set([a.address, other.address, usdt.address]).size).toBe(3);
    expect(a.ref).toBe(evmDepositRef("base", "usdc", "deal-1"));
    expect(a.cursor).toBe("9950");
    await expect(p.openDeposit("deal-1", "usdc", "solana")).rejects.toThrow(/can't take solana/);
  });

  it("reads the token's transfers into a deal's address: the exact amount in time pays the deal, others convert", async () => {
    const { p, state } = partner();
    const { address } = await p.openDeposit("deal-3", "usdc", "base");
    const due = 45_675_000;
    const micro = coinMicroFor(due, FAKE_RATE_KOBO.usdc);
    state.logs = [
      { hash: hash(2), logIndex: 0, value: 1_000_000n, block: 9_990n, to: address as Address },
      { hash: hash(1), logIndex: 3, value: BigInt(micro), block: 9_970n, to: address as Address },
      { hash: hash(9), logIndex: 0, value: 5n, block: 9_990n, to: "0x0000000000000000000000000000000000000009" },
    ];
    const dep = { ref: evmDepositRef("base", "usdc", "deal-3"), coin: "usdc" as const, network: "base" as const, address, amountMicro: micro,
      amountKobo: due, rateKobo: FAKE_RATE_KOBO.usdc, quoteExpiresAt: new Date(Date.now() + 60_000), cursor: "9950" };
    const { events, cursor } = await p.watch(dep);
    expect(cursor).toBe("10000");
    expect(state.lastRange).toEqual([9_951n, 10_000n]);
    expect(events.map((e) => e.type === "crypto.received" && [e.id, e.data.amount_micro, e.data.amount_kobo])).toEqual([
      [`evm:base:${hash(1)}:3`, micro, due],
      [`evm:base:${hash(2)}:0`, 1_000_000, koboForCoin(1_000_000, FAKE_RATE_KOBO.usdc)],
    ]);
    // A long way behind: reads at most 2,000 blocks at a time.
    const far = await p.watch({ ...dep, cursor: "0" });
    expect(far.cursor).toBe("2000");
    expect((await p.watch({ ...dep, cursor: "10000" })).events).toEqual([]);
  });

  it("tops a deal's address up with gas before sending a refund from it, then reports it once settled", async () => {
    const { p, sent, state, wallet } = partner();
    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const { address } = await p.openDeposit("deal-4", "usdt", "bsc");
    const { partnerRef } = await p.sendRefund({ transferId: "t1", amountKobo: 100, idempotencyKey: "k", coin: "usdt", network: "bsc", address: buyer,
      depositRef: evmDepositRef("bsc", "usdt", "deal-4"), micro: 2_500_000 });
    expect(sent.map((s) => [s.from, s.to, s.value !== undefined])).toEqual([[wallet, address, true], [address, USDT, false]]);
    expect(decodeFunctionData({ abi: ERC20, data: sent[1].data! }).args).toEqual([buyer, 2_500_000n]);
    // With gas already there, no top-up.
    state.balances.set(address.toLowerCase(), 10n ** 18n);
    await p.sendRefund({ transferId: "t2", amountKobo: 100, idempotencyKey: "k2", coin: "usdt", network: "bsc", address: buyer,
      depositRef: evmDepositRef("bsc", "usdt", "deal-4"), micro: 1 });
    expect(sent.length).toBe(3);

    state.receipts.set(partnerRef, "success");
    state.receipts.set(hash(77), "reverted");
    const events = await p.settled("bsc", [
      { transferId: "a", partnerRef, sentAt: new Date() }, { transferId: "b", partnerRef: hash(77), sentAt: new Date() },
      { transferId: "c", partnerRef: hash(78), sentAt: new Date(Date.now() - 60 * 60_000) }, { transferId: "d", partnerRef: hash(79), sentAt: new Date() },
    ]);
    expect(events.map((e) => [e.type, "transfer_id" in e.data ? e.data.transfer_id : null])).toEqual([
      ["transfer.succeeded", "a"], ["transfer.failed", "b"], ["transfer.failed", "c"],
    ]);
  });

  it("pays from the demo wallet, minting it more test coin when it runs low, and links to the right explorer", async () => {
    const without = partner();
    await expect(without.p.demoPay("base", evmDepositRef("base", "usdc", "deal-5"), 1_000_000)).rejects.toThrow(/only pays on test networks/);
    const { p, sent, wallet } = partner({ demo: true });
    const { address } = await p.openDeposit("deal-5", "usdc", "base");
    await p.demoPay("base", evmDepositRef("base", "usdc", "deal-5"), 1_000_000);
    expect(sent[0]).toMatchObject({ from: wallet, to: USDC });                        // mint to the demo wallet
    expect(decodeFunctionData({ abi: ERC20, data: sent[0].data! }).functionName).toBe("mint");
    expect(sent[1]).toMatchObject({ from: wallet });                                  // gas for the demo wallet
    expect(decodeFunctionData({ abi: ERC20, data: sent[2].data! }).args).toEqual([address, 1_000_000n]); // the payment
    expect(p.explorer("base", "tx", "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(p.explorer("bsc", "address", "0xdef")).toBe("https://testnet.bscscan.com/address/0xdef");
    expect(p.explorer("solana", "tx", "x")).toBeNull();
    expect(p.watches.sort()).toEqual(["base", "bsc"] satisfies EvmNetwork[]);
  });
});

describe("the wallets, loaded only when first needed", () => {
  it("answers which networks are real, their names and links without loading the wallets, matching the real ones", async () => {
    const { LazyChainPartner, SOLANA_DEVNET, EVM_TESTNET } = await import("@noshen/engine/partner/lazy-chain");
    const { SolanaPartner } = await import("@noshen/engine/partner/solana");
    const { FakeCryptoPartner } = await import("@noshen/engine/partner/fake-crypto");
    const evm = { networks: { base: { rpcUrl: "http://unused", usdc: USDC, usdt: USDT } }, walletKey: generatePrivateKey(), depositSecret: "s" };
    const solana = { rpcUrl: "http://unused", cluster: "devnet" as const, mints: { usdc: "So11111111111111111111111111111111111111112", usdt: "So11111111111111111111111111111111111111112" },
      walletSecret: btoa(String.fromCharCode(...new Uint8Array(32).fill(1))), depositSecret: "s" };
    const lazy = new LazyChainPartner(new FakeCryptoPartner("x"), solana, evm, async () => {});
    expect(lazy.watches).toEqual(["solana", "base"]);
    expect([lazy.mode("solana"), lazy.mode("base"), lazy.mode("bsc")]).toEqual(["devnet", "devnet", "pretend"]);
    expect([lazy.providerFor("solana"), lazy.providerFor("base"), lazy.providerFor("bsc")]).toEqual([SOLANA_DEVNET, EVM_TESTNET, "fake-crypto"]);
    expect(new SolanaPartner(solana).name).toBe(SOLANA_DEVNET);
    expect(new EvmPartner(evm).name).toBe(EVM_TESTNET);
    expect(lazy.explorer("base", "tx", "0xabc")).toBe(new EvmPartner(evm).explorer("base", "tx", "0xabc"));
    expect(lazy.explorer("solana", "tx", "abc")).toBe(new SolanaPartner(solana).explorer("solana", "tx", "abc"));
    expect(lazy.explorer("bsc", "tx", "0xabc")).toBeNull();
  });
});
