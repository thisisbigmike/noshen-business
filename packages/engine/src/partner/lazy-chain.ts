import { testExplorerLink, type Coin, type Network } from "@noshen/shared/payments";
import { CryptoRouter } from "./crypto-router";
import type { EvmConfig } from "./evm";
import type { SolanaConfig } from "./solana";
import type { CryptoMode, CryptoPartner, CryptoRefund, PartnerEvent, WatchedDeposit } from "./types";

/** The names NosHen's own wallets give their deposits (checked against the real partners in tests). */
export const SOLANA_DEVNET = "solana-devnet";
export const EVM_TESTNET = "evm-testnet";

/**
 * NosHen's own wallets (Solana, and BNB/Base/Ethereum), loaded only when first needed. Their libraries are large, and
 * loading them on every request cost most pages their CPU time; most requests only ask which networks are real and
 * for a link, which this answers from the settings alone. Anything that touches a chain loads the real wallets first.
 */
export class LazyChainPartner implements CryptoPartner {
  readonly name = "crypto";
  readonly test = true;
  readonly watches: Network[];
  readonly watchingProviders: string[];
  private real?: Promise<CryptoRouter>;

  constructor(readonly fallback: CryptoPartner, private solana: SolanaConfig | undefined, private evm: EvmConfig | undefined,
    private afterSend: () => Promise<unknown>) {
    this.watches = [...(solana ? ["solana" as const] : []), ...(evm ? (Object.keys(evm.networks) as Network[]) : [])];
    this.watchingProviders = [...(solana ? [SOLANA_DEVNET] : []), ...(evm ? [EVM_TESTNET] : [])];
  }

  private load() {
    return this.real ??= (async () => {
      const byNetwork: Partial<Record<Network, CryptoPartner>> = {};
      if (this.solana) {
        const { SolanaPartner } = await import("./solana");
        byNetwork.solana = new SolanaPartner(this.solana, this.afterSend);
      }
      if (this.evm) {
        const { EvmPartner } = await import("./evm");
        const evm = new EvmPartner(this.evm, this.afterSend);
        for (const n of evm.watches) byNetwork[n] = evm;
      }
      return new CryptoRouter(byNetwork, this.fallback);
    })();
  }

  private serves(network: Network) { return this.watches.includes(network); }
  mode(network: Network): CryptoMode { return this.serves(network) ? "devnet" : "pretend"; }
  providerFor(network: Network) {
    return !this.serves(network) ? this.fallback.name : network === "solana" ? SOLANA_DEVNET : EVM_TESTNET;
  }
  explorer(network: Network, kind: "address" | "tx", id: string) { return this.serves(network) ? testExplorerLink(network, kind, id) : null; }
  // The wallets quote the same test rates as the pretend partner.
  quote(amountKobo: number, coin: Coin, now: Date) { return this.fallback.quote(amountKobo, coin, now); }
  verifyWebhook(rawBody: string, headers: Headers) { return this.fallback.verifyWebhook(rawBody, headers); }

  async openDeposit(dealId: string, coin: Coin, network: Network) { return (await this.load()).openDeposit(dealId, coin, network); }
  async sendRefund(r: CryptoRefund) { return (await this.load()).sendRefund(r); }
  async watch(dep: WatchedDeposit): Promise<{ events: PartnerEvent[]; cursor: string | null }> { return (await this.load()).watch(dep); }
  async settled(network: Network, sent: { transferId: string; partnerRef: string; sentAt: Date }[]) { return (await this.load()).settled(network, sent); }
  async collect(network: Network, ref: string, micro: number) { return (await this.load()).collect(network, ref, micro); }
  async demoPay(network: Network, ref: string, micro: number) { return (await this.load()).demoPay(network, ref, micro); }
}
