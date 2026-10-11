import { hmac, toHex, timingSafeEqual } from "../crypto";
import { QUOTE_MINUTES, usdtMicroFor, type UsdtNetwork } from "@noshen/shared/payments";
import { addMinutes } from "@noshen/shared/time";
import type { CryptoPartner, CryptoRefund, PartnerEvent } from "./types";
import { WebhookSignatureError } from "./types";

/** The pretend partner's rate: ₦1,500 to 1 USDT. A real partner quotes its live rate. */
export const FAKE_USDT_RATE_KOBO = 150_000;

/**
 * A pretend crypto partner for development, tests and the public demo. It gives each deal an address on each
 * network, fixes a USDT amount for 30 minutes, sends refunds, and signs its webhooks like the fake bank partner.
 *
 * Its addresses look like real ones but can't be: "0xTEST…" isn't hex and "TEST0…" isn't base58, so every
 * wallet refuses them. Nobody can lose real USDT by sending it to the demo.
 */
export class FakeCryptoPartner implements CryptoPartner {
  readonly name = "fake-crypto";
  readonly test = true;
  constructor(
    private secret: string,
    private settleLater: (event: PartnerEvent) => Promise<void> = async () => {},
    readonly rateKoboPerUsdt = FAKE_USDT_RATE_KOBO,
  ) {}

  async quote(amountKobo: number, now: Date) {
    return { rateKoboPerUsdt: this.rateKoboPerUsdt, usdtMicro: usdtMicroFor(amountKobo, this.rateKoboPerUsdt), expiresAt: addMinutes(now, QUOTE_MINUTES) };
  }

  async openDeposit(dealId: string, network: UsdtNetwork) {
    const hex = toHex(await hmac(this.secret, `deposit:${network}:${dealId}`));
    const address = network === "solana" ? `TEST0${hex.slice(0, 39)}` : `0xTEST${hex.slice(0, 36)}`;
    return { ref: `fake_dep_${network}_${dealId}`, address };
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
