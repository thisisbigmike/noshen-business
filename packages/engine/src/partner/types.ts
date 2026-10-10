// The payments adapter from the TRD. Deal code never calls a partner directly: it calls this.
// Swapping the fake partner for Paystack, Flutterwave or a bank means writing one new implementation.

export interface CollectionAccount {
  ref: string;            // the partner's reference for this deal's collection account
  accountNumber: string;
  bankName: string;
  accountName: string;
}

export interface TransferRequest {
  transferId: string;
  kind: "payout" | "refund" | "fee_sweep";
  amountKobo: number;
  idempotencyKey: string; // deal id + action: a retry can never pay twice
  destination: { bankCode: string; accountNumber: string; accountName: string };
}

export type PartnerEvent =
  | { id: string; type: "collection.received"; data: { collection_ref: string; amount_kobo: number; sender_name: string; sender_bank_code: string; sender_account: string; received_at: string } }
  | { id: string; type: "transfer.succeeded" | "transfer.failed"; data: { transfer_id: string; partner_ref: string; reason?: string } };

export interface PaymentsPartner {
  readonly name: string;
  readonly bankName: string;
  openCollection(dealId: string, amountKobo: number, label: string): Promise<CollectionAccount>;
  sendTransfer(t: TransferRequest): Promise<{ partnerRef: string }>;
  /** The account name the bank holds for an account number. */
  resolveAccount(bankCode: string, accountNumber: string, hintName?: string): Promise<{ accountName: string }>;
  /** Throws unless the webhook's signature is valid. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent>;
}

export class WebhookSignatureError extends Error {}
