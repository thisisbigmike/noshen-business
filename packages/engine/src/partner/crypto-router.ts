import type { Coin, Network } from "@noshen/shared/payments";
import type { CryptoPartner, CryptoRefund, PartnerEvent, WatchedDeposit } from "./types";

/**
 * More than one crypto partner behind one: each network goes to the partner that serves it (Solana to NosHen's own
 * wallet, say), and the rest to the fallback. Deal code still sees a single crypto partner.
 */
export class CryptoRouter implements CryptoPartner {
  readonly name = "crypto";
  readonly test: boolean;
  readonly watches: Network[];

  constructor(private byNetwork: Partial<Record<Network, CryptoPartner>>, readonly fallback: CryptoPartner) {
    const all = [fallback, ...Object.values(byNetwork)] as CryptoPartner[];
    this.test = all.some((p) => p.test);
    this.watches = all.flatMap((p) => [...(p.watches ?? [])]);
  }

  private for(network: Network) { return this.byNetwork[network] ?? this.fallback; }

  mode(network: Network) { return this.for(network).mode(network); }
  quote(amountKobo: number, coin: Coin, now: Date) { return this.fallback.quote(amountKobo, coin, now); }

  async openDeposit(dealId: string, coin: Coin, network: Network) {
    const p = this.for(network);
    return { provider: p.name, ...(await p.openDeposit(dealId, coin, network)) };
  }

  sendRefund(r: CryptoRefund) { return this.for(r.network).sendRefund(r); }
  verifyWebhook(rawBody: string, headers: Headers) { return this.fallback.verifyWebhook(rawBody, headers); }

  async watch(dep: WatchedDeposit): Promise<{ events: PartnerEvent[]; cursor: string | null }> {
    const p = this.for(dep.network);
    return p.watch ? p.watch(dep) : { events: [], cursor: dep.cursor };
  }
  async settled(network: Network, sent: { transferId: string; partnerRef: string; sentAt: Date }[]) {
    return this.for(network).settled?.(network, sent) ?? [];
  }
  collect(network: Network, depositRef: string, micro: number) {
    const p = this.for(network);
    if (!p.collect) throw new Error(`nothing to collect on ${network}`);
    return p.collect(network, depositRef, micro);
  }
  demoPay(network: Network, depositRef: string, micro: number) {
    const p = this.for(network);
    if (!p.demoPay) throw new Error(`no demo wallet on ${network}`);
    return p.demoPay(network, depositRef, micro);
  }
  explorer(network: Network, kind: "address" | "tx", id: string) { return this.for(network).explorer?.(network, kind, id) ?? null; }
}
