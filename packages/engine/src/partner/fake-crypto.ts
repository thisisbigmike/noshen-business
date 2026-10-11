import { hmac, toHex, timingSafeEqual } from "../crypto";
import { QUOTE_MINUTES, coinMicroFor, type Coin, type Network } from "@noshen/shared/payments";
import { addMinutes } from "@noshen/shared/time";
import type { CryptoPartner, CryptoRefund, PartnerEvent } from "./types";
import { WebhookSignatureError } from "./types";

/** The pretend partner's rates: ₦1,500 to 1 USDT, ₦1,498 to 1 USDC. A real partner quotes its live rates. */
export const FAKE_RATE_KOBO: Record<Coin, number> = { usdt: 150_000, usdc: 149_800 };

/**
 * A pretend crypto partner for development, tests and the public demo. It gives each deal an address for each coin
 * and network, fixes the amount for 30 minutes, sends refunds, and signs its webhooks like the fake bank partner.
 *
 * Its addresses look like real ones but can't be: "0xTEST…" isn't hex and "TEST0…" isn't base58, so every
 * wallet refuses them. Nobody can lose real USDT or USDC by sending it to the demo.
 */
export class FakeCryptoPartner implements CryptoPartner {
  readonly name = "fake-crypto";
  readonly test = true;
  constructor(
    private secret: string,
    private settleLater: (event: PartnerEvent) => Promise<void> = async () => {},
  ) {}

  async quote(amountKobo: number, coin: Coin, now: Date) {
    const rateKobo = FAKE_RATE_KOBO[coin];
    return { rateKobo, micro: coinMicroFor(amountKobo, rateKobo), expiresAt: addMinutes(now, QUOTE_MINUTES) };
  }

  async openDeposit(dealId: string, coin: Coin, network: Network) {
    const hex = toHex(await hmac(this.secret, `deposit:${coin}:${network}:${dealId}`));
    const address = network === "solana" ? `TEST0${hex.slice(0, 39)}` : `0xTEST${hex.slice(0, 36)}`;
    return { ref: `fake_dep_${coin}_${network}_${dealId}`, address };
  }

  async sendRefund(r: CryptoRefund) {
    const partnerRef = `fake_cx_${r.transferId}`;
    await this.settleLater({ id: `evt_${partnerRef}`, type: "transfer.succeeded", data: { transfer_id: r.transferId, partner_ref: partnerRef } });
    return { partnerRef };
  }

  async sign(body: string) {
    return toHex(await hmac(this.secret, `crypto:${body}`, "SHA-512"));
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent> {
    const given = headers.get("x-fake-crypto-signature") ?? "";
    const expected = await this.sign(rawBody);
    const enc = new TextEncoder();
    if (!timingSafeEqual(enc.encode(given), enc.encode(expected))) throw new WebhookSignatureError("bad signature");
    return JSON.parse(rawBody) as PartnerEvent;
  }
}
