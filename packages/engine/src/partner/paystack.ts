import { hmac, timingSafeEqual, toHex } from "../crypto";
import type { CollectionAccount, PartnerEvent, PaymentsPartner, TransferRequest } from "./types";
import { WebhookSignatureError } from "./types";

const BASE_URL = "https://api.paystack.co";

/**
 * Live Nigerian Naira partner via Paystack (Dedicated Virtual Accounts, Bank Resolve, Transfers, and Webhooks).
 * Activated when PARTNER="paystack" and PAYSTACK_SECRET_KEY is configured as a Worker secret.
 */
export class PaystackPartner implements PaymentsPartner {
  readonly name = "paystack";
  constructor(
    private secretKey: string,
    readonly bankName: string = "Wema Bank (Paystack)",
    private preferredBank: string = "wema-bank",
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !json?.status || json.data === undefined) {
      throw new Error(json?.message || `Paystack request failed (${res.status})`);
    }
    return json.data;
  }

  /**
   * Opens a dedicated collection account for a deal by creating a Paystack deal customer and assigning a DVA.
   * Each deal has its own dedicated email/ref (`deal+<id>@escrow.noshen.com`) so incoming transfers reconcile 1:1.
   */
  async openCollection(dealId: string, _amountKobo: number, label: string): Promise<CollectionAccount> {
    const email = `deal.${dealId.replace(/-/g, "").slice(0, 20)}@escrow.noshen.com`;
    const customer = await this.request<{ customer_code: string }>("/customer", {
      method: "POST",
      body: JSON.stringify({
        email,
        first_name: "NosHen",
        last_name: label.slice(0, 40) || "Escrow",
        metadata: { deal_id: dealId },
      }),
    });
    const dva = await this.request<{ account_number: string; account_name: string; bank: { name: string } }>("/dedicated_account", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.customer_code,
        preferred_bank: this.preferredBank,
      }),
    });
    return {
      ref: customer.customer_code,
      accountNumber: dva.account_number,
      bankName: dva.bank?.name || this.bankName,
      accountName: dva.account_name,
    };
  }

  async resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }> {
    const data = await this.request<{ account_name: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return { accountName: data.account_name };
  }

  async sendTransfer(t: TransferRequest): Promise<{ partnerRef: string }> {
    const recipient = await this.request<{ recipient_code: string }>("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: t.destination.accountName,
        account_number: t.destination.accountNumber,
        bank_code: t.destination.bankCode,
        currency: "NGN",
      }),
    });
    const transfer = await this.request<{ transfer_code: string; reference: string }>("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: t.amountKobo,
        recipient: recipient.recipient_code,
        reference: t.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50),
        reason: `NosHen ${t.kind} (${t.transferId})`,
      }),
    });
    return { partnerRef: transfer.transfer_code || transfer.reference };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent> {
    const given = headers.get("x-paystack-signature") ?? "";
    const expected = toHex(await hmac(this.secretKey, rawBody, "SHA-512"));
    const enc = new TextEncoder();
    if (!given || !timingSafeEqual(enc.encode(given), enc.encode(expected))) {
      throw new WebhookSignatureError("bad paystack signature");
    }
    const payload = JSON.parse(rawBody) as { event: string; data: any };
    const d = payload.data ?? {};
    if (payload.event === "charge.success") {
      const auth = d.authorization ?? {};
      return {
        id: `ps_${d.id ?? d.reference}`,
        type: "collection.received",
        data: {
          collection_ref: d.customer?.customer_code ?? d.reference,
          amount_kobo: Number(d.amount ?? 0),
          sender_name: String(auth.sender_name || d.customer?.first_name || "BANK TRANSFER").toUpperCase(),
          sender_bank_code: String(auth.sender_bank_code || auth.bank || "000"),
          sender_account: String(auth.sender_bank_account_number || ""),
          received_at: String(d.paid_at || d.created_at || new Date().toISOString()),
        },
      };
    }
    if (payload.event === "transfer.success") {
      return {
        id: `ps_tx_${d.id ?? d.transfer_code}`,
        type: "transfer.succeeded",
        data: {
          transfer_id: String(d.reference ?? ""),
          partner_ref: String(d.transfer_code ?? d.reference ?? ""),
        },
      };
    }
    if (payload.event === "transfer.failed" || payload.event === "transfer.reversed") {
      return {
        id: `ps_txf_${d.id ?? d.transfer_code}`,
        type: "transfer.failed",
        data: {
          transfer_id: String(d.reference ?? ""),
          partner_ref: String(d.transfer_code ?? d.reference ?? ""),
          reason: String(d.reason || payload.event),
        },
      };
    }
    throw new WebhookSignatureError(`unhandled paystack event: ${payload.event}`);
  }
}
