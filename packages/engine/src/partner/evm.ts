import {
  createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseAbiItem, toHex, type Address, type Chain, type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia, bscTestnet } from "viem/chains";
import { QUOTE_MINUTES, coinMicroFor, koboForCoin, testExplorerLink, type Coin, type Network } from "@noshen/shared/payments";
import { addMinutes } from "@noshen/shared/time";
import { hmac } from "../crypto";
import { FAKE_RATE_KOBO } from "./fake-crypto";
import type { CryptoMode, CryptoPartner, CryptoRefund, PartnerEvent, WatchedDeposit } from "./types";

/** The Ethereum-style networks NosHen pays on, and the test network each one runs on for now. */
export type EvmNetwork = "bsc" | "base";
const CHAINS: Record<EvmNetwork, Chain> = { bsc: bscTestnet, base: baseSepolia };
export const isEvmNetwork = (n: string): n is EvmNetwork => n in CHAINS;

const ERC20 = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mint(address to, uint256 value)",
]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Gas for one token transfer, with room to spare. */
const TRANSFER_GAS = 70_000n;
/** How far back a new deal address is read the first time (its payment comes after it's opened). */
const FIRST_LOOK = 50n;
/** The most blocks read in one go (public RPCs limit log searches). */
const MAX_RANGE = 2_000n;
/** The secp256k1 group order: a private key must be below it. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface EvmNetworkSettings { rpcUrl: string; usdc: string; usdt: string }

export interface EvmConfig {
  /** The test networks set up so far (pnpm evm:setup), each with an RPC and NosHen's test USDC and USDT there. */
  networks: Partial<Record<EvmNetwork, EvmNetworkSettings>>;
  /** NosHen's wallet (a private key, 0x…): pays gas, mints the test tokens, receives released coin. The same on every network. */
  walletKey: string;
  /** Turns a deal into its own address. A secret like the wallet. */
  depositSecret: string;
  /** Test networks only: the wallet behind "Send from NosHen's demo wallet". */
  demoWalletKey?: string;
}

/** What NosHen asks of a network: a viem client in production, a stand-in in tests. */
export interface EvmClient {
  blockNumber(): Promise<bigint>;
  /** Transfers of a token into an address between two blocks (inclusive). */
  transfersTo(token: Address, to: Address, fromBlock: bigint, toBlock: bigint): Promise<{ hash: Hex; logIndex: number; value: bigint; block: bigint }[]>;
  blockTime(block: bigint): Promise<Date>;
  /** A sent transaction's result, or null while it isn't in a block. */
  receipt(hash: Hex): Promise<"success" | "reverted" | null>;
  balance(address: Address): Promise<bigint>;
  tokenBalance(token: Address, owner: Address): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  send(from: PrivateKeyAccount, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex>;
  /** Waits for a transaction to be in a block. */
  waitFor(hash: Hex): Promise<"success" | "reverted">;
}

export function viemClient(network: EvmNetwork, rpcUrl: string): EvmClient {
  const chain = CHAINS[network];
  const transport = http(rpcUrl, { retryCount: 2 });
  const pub = createPublicClient({ chain, transport });
  return {
    blockNumber: () => pub.getBlockNumber(),
    async transfersTo(token, to, fromBlock, toBlock) {
      const logs = await pub.getLogs({ address: token, event: TRANSFER, args: { to }, fromBlock, toBlock });
      return logs.map((l) => ({ hash: l.transactionHash!, logIndex: l.logIndex ?? 0, value: l.args.value ?? 0n, block: l.blockNumber! }));
    },
    async blockTime(block) { return new Date(Number((await pub.getBlock({ blockNumber: block })).timestamp) * 1000); },
    async receipt(hash) {
      try { return (await pub.getTransactionReceipt({ hash })).status; } catch { return null; }
    },
    balance: (address) => pub.getBalance({ address }),
    tokenBalance: (token, owner) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [owner] }),
    gasPrice: () => pub.getGasPrice(),
    send: (from, tx) => createWalletClient({ account: from, chain, transport }).sendTransaction({ ...tx, chain }),
    async waitFor(hash) { return (await pub.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1_500 })).status; },
  };
}

/** A deposit's reference: which network and coin, for which deal. */
export const evmDepositRef = (network: EvmNetwork, coin: Coin, dealId: string) => `evm:${network}:${coin}:${dealId}`;
function parseRef(ref: string): { network: EvmNetwork; coin: Coin; dealId: string } {
  const [kind, network, coin, dealId] = ref.split(":");
  if (kind !== "evm" || !isEvmNetwork(network) || (coin !== "usdt" && coin !== "usdc") || !dealId) throw new Error(`not an EVM deposit: ${ref}`);
  return { network, coin, dealId };
}

/**
 * NosHen's own wallet on BNB Smart Chain and Base (their test networks for now), in place of a crypto
 * partner: the same idea as the Solana wallet. Each deal gets its own address (a key made from the deposit secret
 * and the deal, the same address on every network), the buyer pays it directly, and NosHen reads the token's
 * transfer events to see the payment. Refunds and the move into NosHen's wallet at release are sent from the
 * deal's address; these networks have no separate fee payer, so NosHen's wallet first tops the address up with a
 * little gas (ETH or BNB) when it needs it.
 */
export class EvmPartner implements CryptoPartner {
  readonly name = "evm-testnet";
  readonly test = true;
  readonly watches: EvmNetwork[];
  private clients = new Map<EvmNetwork, EvmClient>();
  private wallet: PrivateKeyAccount;
  private demo?: PrivateKeyAccount;

  constructor(private cfg: EvmConfig, private afterSend: () => Promise<unknown> = async () => {},
    private makeClient: (network: EvmNetwork, rpcUrl: string) => EvmClient = viemClient) {
    this.watches = (Object.keys(cfg.networks) as EvmNetwork[]).filter(isEvmNetwork);
    this.wallet = privateKeyToAccount(cfg.walletKey as Hex);
    if (cfg.demoWalletKey) this.demo = privateKeyToAccount(cfg.demoWalletKey as Hex);
  }

  get watchingProviders() { return [this.name]; }
  providerFor() { return this.name; }
  mode(): CryptoMode { return "devnet"; }

  async quote(amountKobo: number, coin: Coin, now: Date) {
    const rateKobo = FAKE_RATE_KOBO[coin];
    return { rateKobo, micro: coinMicroFor(amountKobo, rateKobo), expiresAt: addMinutes(now, QUOTE_MINUTES) };
  }

  private client(network: EvmNetwork) {
    const s = this.cfg.networks[network];
    if (!s) throw new Error(`NosHen's wallet isn't set up on ${network}`);
    let c = this.clients.get(network);
    if (!c) { c = this.makeClient(network, s.rpcUrl); this.clients.set(network, c); }
    return c;
  }
  private token(network: EvmNetwork, coin: Coin) { return this.cfg.networks[network]![coin] as Address; }

  /** The key behind one deal's address for one coin (the same on every network). */
  async depositAccount(dealId: string, coin: Coin) {
    let seed = await hmac(this.cfg.depositSecret, `noshen:evm-deposit:v1:${coin}:${dealId}`);
    // Almost every 32 bytes is a valid key; in the vanishingly rare case it isn't, hash again.
    while (BigInt(toHex(seed)) === 0n || BigInt(toHex(seed)) >= N) seed = await hmac(this.cfg.depositSecret, toHex(seed));
    return privateKeyToAccount(toHex(seed));
  }

  async openDeposit(dealId: string, coin: Coin, network: Network) {
    if (!isEvmNetwork(network) || !this.cfg.networks[network]) throw new Error(`NosHen's wallet can't take ${network}.`);
    const owner = await this.depositAccount(dealId, coin);
    // Start reading just before now: the payment comes after the address is opened.
    const latest = await this.client(network).blockNumber().catch(() => null);
    const cursor = latest === null ? null : String(latest > FIRST_LOOK ? latest - FIRST_LOOK : 0n);
    return { ref: evmDepositRef(network, coin, dealId), address: owner.address as string, provider: this.name, cursor };
  }

  async watch(dep: WatchedDeposit) {
    if (!isEvmNetwork(dep.network)) return { events: [], cursor: dep.cursor };
    const c = this.client(dep.network);
    const latest = await c.blockNumber();
    const from = dep.cursor ? BigInt(dep.cursor) + 1n : (latest > FIRST_LOOK ? latest - FIRST_LOOK : 0n);
    if (from > latest) return { events: [], cursor: dep.cursor };
    const to = from + MAX_RANGE - 1n < latest ? from + MAX_RANGE - 1n : latest;
    const logs = await c.transfersTo(this.token(dep.network, dep.coin), dep.address as Address, from, to);
    const times = new Map<bigint, Date>();
    const events: PartnerEvent[] = [];
    for (const l of logs.sort((a, b) => Number(a.block - b.block) || a.logIndex - b.logIndex)) {
      const received = Number(l.value);
      if (received <= 0) continue;
      if (!times.has(l.block)) times.set(l.block, await c.blockTime(l.block));
      const at = times.get(l.block)!;
      const kobo = received === dep.amountMicro && at <= dep.quoteExpiresAt ? dep.amountKobo : koboForCoin(received, dep.rateKobo);
      events.push({
        id: `evm:${dep.network}:${l.hash}:${l.logIndex}`, type: "crypto.received",
        data: { deposit_ref: dep.ref, coin: dep.coin, network: dep.network, amount_micro: received, amount_kobo: kobo, tx_hash: l.hash, received_at: at.toISOString() },
      });
    }
    return { events, cursor: String(to) };
  }

  /** Makes sure an address can pay for `transfers` token transfers: tops it up from NosHen's wallet and waits if not. */
  private async ensureGas(c: EvmClient, address: Address, transfers = 1n) {
    const need = (await c.gasPrice()) * TRANSFER_GAS * transfers * 2n;
    const has = await c.balance(address);
    if (has >= need) return;
    const topUp = await c.send(this.wallet, { to: address, value: need * 2n - has });
    if (await c.waitFor(topUp) !== "success") throw new Error(`couldn't top up gas for ${address}`);
  }

  /** Sends a deposit's coin somewhere (a refund, or into NosHen's wallet at release). Returns the transaction. */
  private async sendFromDeposit(ref: string, to: Address, micro: number) {
    const { network, coin, dealId } = parseRef(ref);
    const c = this.client(network);
    const from = await this.depositAccount(dealId, coin);
    await this.ensureGas(c, from.address);
    const hash = await c.send(from, { to: this.token(network, coin), data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [to, BigInt(micro)] }) });
    await this.afterSend().catch(() => {});
    return hash;
  }

  async sendRefund(r: CryptoRefund) {
    if (!r.depositRef || !r.micro) throw new Error(`refund ${r.transferId} needs its deposit and amount`);
    return { partnerRef: await this.sendFromDeposit(r.depositRef, r.address as Address, r.micro) };
  }

  async collect(_network: Network, ref: string, micro: number) {
    return this.sendFromDeposit(ref, this.wallet.address, micro);
  }

  async settled(network: Network, sent: { transferId: string; partnerRef: string; sentAt: Date }[]) {
    if (!isEvmNetwork(network) || !sent.length) return [];
    const c = this.client(network);
    const events: PartnerEvent[] = [];
    for (const t of sent) {
      const status = await c.receipt(t.partnerRef as Hex);
      // A transaction the network never took (dropped from the queue) won't ever be in a block.
      const lost = status === null && Date.now() - t.sentAt.getTime() > 15 * 60_000;
      if (status === "reverted" || lost) {
        events.push({ id: `evm-failed:${t.partnerRef}`, type: "transfer.failed", data: { transfer_id: t.transferId, partner_ref: t.partnerRef, reason: lost ? "The network didn't take the transaction." : "The transaction failed on-chain." } });
      } else if (status === "success") {
        events.push({ id: `evm-done:${t.partnerRef}`, type: "transfer.succeeded", data: { transfer_id: t.transferId, partner_ref: t.partnerRef } });
      }
    }
    return events;
  }

  async demoPay(network: Network, ref: string, micro: number) {
    if (!this.demo) throw new Error("The demo wallet only pays on test networks.");
    const { network: net, coin, dealId } = parseRef(ref);
    if (net !== network) throw new Error("wrong network for this deposit");
    const c = this.client(net);
    const token = this.token(net, coin);
    const deposit = await this.depositAccount(dealId, coin);
    // The demo wallet holds a stock of test coin (NosHen's wallet mints more when it runs low) and its own gas.
    if (await c.tokenBalance(token, this.demo.address) < BigInt(micro)) {
      const mint = await c.send(this.wallet, { to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [this.demo.address, BigInt(micro) + 1_000_000_000_000n] }) });
      if (await c.waitFor(mint) !== "success") throw new Error("couldn't mint test coin for the demo wallet");
    }
    await this.ensureGas(c, this.demo.address, 5n);
    const hash = await c.send(this.demo, { to: token, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [deposit.address, BigInt(micro)] }) });
    await this.afterSend().catch(() => {});
    return hash;
  }

  explorer(network: Network, kind: "address" | "tx", id: string) {
    return isEvmNetwork(network) ? testExplorerLink(network, kind, id) : null;
  }

  async verifyWebhook(): Promise<PartnerEvent> {
    throw new Error("NosHen's EVM wallet reads the chain; it takes no webhooks.");
  }
}
