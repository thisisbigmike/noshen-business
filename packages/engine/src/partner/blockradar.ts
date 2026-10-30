import type { Coin, Network } from "@noshen/shared/payments";
import { hmac, timingSafeEqual } from "../crypto";
import { WalletProviderError, WebhookSignatureError, type WalletProvider } from "./types";

/**
 * Blockradar, NosHen's wallet provider: it holds the keys, gives every account fixed deposit addresses, sweeps what
 * arrives into NosHen's master wallet on each network, and sends withdrawals from it. NosHen keeps each person's
 * balance in its own ledger (wallets.ts); Blockradar only moves the coin.
 *
 * Each network has its own master wallet with its own API key, and that key also signs the webhooks the wallet sends.
 * Docs: https://docs.blockradar.co
 */

/** The networks NosHen's wallets run on: every network NosHen takes. */
export type WalletNetwork = Network;
export const WALLET_NETWORKS: WalletNetwork[] = ["solana", "base", "bsc"];

/** The coins each network takes: what its issuer (or, on BNB, Binance) actually issues there. */
export const WALLET_COINS: Record<WalletNetwork, Coin[]> = { solana: ["usdc", "usdt"], base: ["usdc"], bsc: ["usdt", "usdc"] };

/** One EVM address receives on Base and BNB Smart Chain alike; Solana has its own. */
export type AddressFamily = "solana" | "evm";
export const familyOf = (n: WalletNetwork): AddressFamily => (n === "solana" ? "solana" : "evm");

export interface BlockradarConfig {
  /** Each network's master wallet and its API key. A network that isn't set up is left out. */
  wallets: Partial<Record<WalletNetwork, { walletId: string; apiKey: string }>>;
  baseUrl?: string;
}

/** A transaction as Blockradar describes it in webhooks and API answers (only the fields NosHen reads). */
export interface BlockradarTransaction {
  id: string;
  hash?: string | null;
  amount?: string | null;
  status?: string;
  reference?: string | null;
  senderAddress?: string | null;
  recipientAddress?: string | null;
  reason?: string | null;
  createdAt?: string;
  asset?: { id?: string; symbol?: string; decimals?: number } | null;
  address?: { id?: string; address?: string } | null;
  wallet?: { id?: string } | null;
  amlScreening?: { provider?: string; status?: string; message?: string } | null;
}

/** A webhook whose signature checked out, and the network whose master wallet sent it. */
export interface WalletEvent {
  network: WalletNetwork;
  event: string; // "deposit.success", "withdraw.failed", ...
  data: BlockradarTransaction;
}

export class BlockradarError extends WalletProviderError {}

const TIMEOUT_MS = 20_000;

export class Blockradar implements WalletProvider {
  readonly name = "blockradar";
  private readonly baseUrl: string;
  // The master wallet's id for each coin, which a withdrawal names. Looked up once per network.
  private assets = new Map<WalletNetwork, Promise<Map<string, string>>>();

  constructor(private cfg: BlockradarConfig, private fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.baseUrl = (cfg.baseUrl ?? "https://api.blockradar.co/v1").replace(/\/$/, "");
  }

  /** The networks whose master wallets are set up. */
  networks(): WalletNetwork[] {
    return WALLET_NETWORKS.filter((n) => this.cfg.wallets[n]);
  }

  /** A new fixed address for one person, made under a network's master wallet. An EVM one serves every EVM network. */
  async createAddress(network: WalletNetwork, name: string, metadata: Record<string, string>) {
    const a = await this.walletCall<{ id: string; address: string }>(network, "POST", "/addresses", { name, metadata, showPrivateKey: false });
    return { providerRef: a.id, address: a.address };
  }

  /**
   * Sends coin from the network's master wallet. `reference` is NosHen's id for the withdrawal, so the answer and
   * the webhooks that follow can be matched to it even if this call's answer is lost.
   */
  async withdraw(network: WalletNetwork, w: { coin: Coin; address: string; amountMicro: number; reference: string; note?: string }) {
    const assetId = await this.assetId(network, w.coin);
    const t = await this.walletCall<BlockradarTransaction>(network, "POST", "/withdraw", {
      assetId, address: w.address, amount: microToDecimal(w.amountMicro), reference: w.reference, note: w.note,
    });
    return { providerRef: t.id, hash: t.hash ?? null };
  }

  /** Checks an address against the OFAC, FBI, Tether and Circle blocklists. */
  async screen(network: WalletNetwork, address: string): Promise<{ ok: boolean }> {
    const key = this.cfg.wallets[network]?.apiKey;
    if (!key) throw new BlockradarError(`${network} isn't set up`, true);
    const blockchain = { solana: "solana", base: "base", bsc: "bnb-smart-chain" }[network];
    const r = await this.request<{ isBlacklisted?: boolean }>(key, "GET", `/aml/lookup?address=${encodeURIComponent(address)}&blockchain=${blockchain}`);
    return { ok: r.isBlacklisted === false };
  }

  /**
   * Checks a webhook against each master wallet's key and returns the event with the network that sent it. A body
   * signed with one wallet's key but naming another wallet is refused.
   */
  async verifyWebhook(raw: string, signature: string | null): Promise<WalletEvent> {
    const given = hexBytes(signature ?? "");
    if (!given) throw new WebhookSignatureError("missing or malformed x-blockradar-signature");
    let body: { event?: unknown; data?: BlockradarTransaction };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new WebhookSignatureError("the body isn't JSON");
    }
    // Blockradar signs the JSON it sends; its own examples re-serialise the parsed body, so both forms are accepted.
    const forms = [...new Set([raw, JSON.stringify(body)])];
    for (const network of this.networks()) {
      const w = this.cfg.wallets[network]!;
      for (const form of forms) {
        if (!timingSafeEqual(await hmac(w.apiKey, form, "SHA-512"), given)) continue;
        const walletId = body.data?.wallet?.id;
        if (walletId && walletId !== w.walletId) throw new WebhookSignatureError(`signed by the ${network} wallet but about another wallet`);
        if (typeof body.event !== "string" || !body.data?.id) throw new WebhookSignatureError("no event or transaction in the body");
        return { network, event: body.event, data: body.data };
      }
    }
    throw new WebhookSignatureError("x-blockradar-signature doesn't match any wallet");
  }

  private async assetId(network: WalletNetwork, coin: Coin): Promise<string> {
    let ids = this.assets.get(network);
    if (!ids) {
      ids = this.walletCall<{ asset?: { id?: string; symbol?: string } }[]>(network, "GET", "/assets").then((list) =>
        new Map(list.flatMap((a) => (a.asset?.id && a.asset.symbol ? [[a.asset.symbol.toLowerCase(), a.asset.id] as const] : []))),
      );
      ids.catch(() => this.assets.delete(network));
      this.assets.set(network, ids);
    }
    const id = (await ids).get(coin);
    if (!id) throw new BlockradarError(`the ${network} master wallet has no ${coin.toUpperCase()} asset`, true);
    return id;
  }

  private walletCall<T>(network: WalletNetwork, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const w = this.cfg.wallets[network];
    if (!w) throw new BlockradarError(`${network} isn't set up`, true);
    return this.request<T>(w.apiKey, method, `/wallets/${w.walletId}${path}`, body);
  }

  private async request<T>(apiKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e: any) {
      throw new BlockradarError(`Blockradar ${method} ${path}: no answer (${e?.message ?? e})`, false);
    }
    const json: any = await res.json().catch(() => ({}));
    // A server error leaves it unknown whether the request took effect; any other refusal means it didn't.
    if (!res.ok) throw new BlockradarError(`Blockradar ${method} ${path}: ${res.status} ${json?.message ?? ""}`.trim(), res.status < 500);
    return json.data as T;
  }
}

/** "12.5" coins as millionths (12_500_000). Places past the sixth (BNB's tokens have 18) are dropped, never rounded up. */
export function decimalToMicro(amount: string): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new BlockradarError(`not an amount: "${amount}"`, true);
  const micro = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").slice(0, 6).padEnd(6, "0"));
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new BlockradarError(`amount too large: "${amount}"`, true);
  return Number(micro);
}

/** Millionths of a coin as the decimal string Blockradar takes: 12_500_000 is "12.5". */
export function microToDecimal(micro: number): string {
  if (!Number.isSafeInteger(micro) || micro < 0) throw new BlockradarError(`not an amount: ${micro}`, true);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${Math.floor(micro / 1_000_000)}.${frac}` : String(micro / 1_000_000);
}

/** The NosHen coin for a token symbol, or null for anything NosHen doesn't take. */
export function coinOf(symbol: string | undefined): Coin | null {
  const s = symbol?.toLowerCase();
  return s === "usdt" || s === "usdc" ? s : null;
}

function hexBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}
