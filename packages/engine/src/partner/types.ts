import type { Coin, Network } from "@noshen/shared/payments";

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
  | { id: string; type: "transfer.succeeded" | "transfer.failed"; data: { transfer_id: string; partner_ref: string; reason?: string } }
  // From the crypto partner: USDT or USDC arrived at a deal's address. amount_kobo is what the partner credits the deal in naira.
  | { id: string; type: "crypto.received"; data: { deposit_ref: string; coin: string; network: string; amount_micro: number; amount_kobo: number; tx_hash: string; received_at: string } };

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

// ---------------------------------------------------------------------------
// The crypto partner: USDT or USDC in, naira to the deal; refunds back out in the same coin.
// ---------------------------------------------------------------------------

export interface CryptoQuote {
  rateKobo: number;   // naira (in kobo) for one coin
  micro: number;      // the coin to send, in millionths
  expiresAt: Date;
}

export interface CryptoRefund {
  transferId: string;
  amountKobo: number;     // sent in the coin the buyer paid with, at the partner's rate on the day
  idempotencyKey: string;
  coin: Coin;
  network: Network;
  address: string;
}

export interface CryptoPartner {
  readonly name: string;
  /** Pretend addresses and a test rate: no real USDT can be sent. */
  readonly test: boolean;
  /** The coin for a naira amount, fixed until expiresAt. */
  quote(amountKobo: number, coin: Coin, now: Date): Promise<CryptoQuote>;
  /** An address for this deal, coin and network. The same three always get the same address. */
  openDeposit(dealId: string, coin: Coin, network: Network): Promise<{ ref: string; address: string }>;
  sendRefund(r: CryptoRefund): Promise<{ partnerRef: string }>;
  /** Throws unless the webhook's signature is valid. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent>;
}
