import { hmac, toHex, timingSafeEqual } from "../crypto";
import type { PaymentsPartner, PartnerEvent, TransferRequest } from "./types";
import { WebhookSignatureError } from "./types";

/**
 * A pretend payment partner for development and tests. It behaves like a real one: collection
 * accounts, transfers, account-name checks, and webhooks signed with HMAC-SHA512 (as Paystack does).
 * Transfers succeed a few seconds later through `settleLater`, which the app wires to a Workflow.
 */
export class FakePartner implements PaymentsPartner {
  readonly name = "fake";
  constructor(
    private secret: string,
    readonly bankName: string,
    private settleLater: (event: PartnerEvent) => Promise<void> = async () => {},
  ) {}

  async openCollection(dealId: string, _amountKobo: number, label: string) {
    const digits = toHex(await hmac(this.secret, `collection:${dealId}`)).replace(/[a-f]/g, "").padEnd(12, "7");
    return { ref: `fake_col_${dealId}`, accountNumber: "80" + digits.slice(0, 8), bankName: this.bankName, accountName: `NosHen / ${label}` };
  }

  async sendTransfer(t: TransferRequest) {
    const partnerRef = `fake_tr_${t.transferId}`;
    await this.settleLater({ id: `evt_${partnerRef}`, type: "transfer.succeeded", data: { transfer_id: t.transferId, partner_ref: partnerRef } });
    return { partnerRef };
  }

  async resolveAccount(_bankCode: string, accountNumber: string, hintName?: string) {
    if (!/^\d{10}$/.test(accountNumber)) throw new Error("Account numbers have 10 digits.");
    return { accountName: (hintName || "ACCOUNT HOLDER").toUpperCase() };
  }

  async sign(body: string) {
    return toHex(await hmac(this.secret, body, "SHA-512"));
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent> {
    const given = headers.get("x-fake-signature") ?? "";
    const expected = await this.sign(rawBody);
    const enc = new TextEncoder();
    if (!timingSafeEqual(enc.encode(given), enc.encode(expected))) throw new WebhookSignatureError("bad signature");
    return JSON.parse(rawBody) as PartnerEvent;
  }
}
