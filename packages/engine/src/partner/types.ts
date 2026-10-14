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
  /** The deposit the refunded payment came into, and the coin to send back (millionths): what an on-chain partner sends. */
  depositRef?: string;
  micro?: number;
}

/** A deal's address that an on-chain partner watches for payments. */
export interface WatchedDeposit {
  ref: string;
  coin: Coin;
  network: Network;
  address: string;
  amountMicro: number;    // the coin asked for
  amountKobo: number;     // what that pays: the deal's amount due
  rateKobo: number;
  quoteExpiresAt: Date;
  /** The newest transaction already looked at, so each check only fetches what's new. */
  cursor: string | null;
}

/** How real a network's payments are: made-up addresses, real transactions with test tokens, or real money. */
export type CryptoMode = "pretend" | "devnet" | "live";

export interface CryptoPartner {
  readonly name: string;
  /** Pretend addresses and a test rate: no real USDT can be sent. */
  readonly test: boolean;
  /** The coin for a naira amount, fixed until expiresAt. */
  quote(amountKobo: number, coin: Coin, now: Date): Promise<CryptoQuote>;
  /** An address for this deal, coin and network. The same three always get the same address. */
  openDeposit(dealId: string, coin: Coin, network: Network): Promise<{ ref: string; address: string; provider?: string }>;
  sendRefund(r: CryptoRefund): Promise<{ partnerRef: string }>;
  /** Throws unless the webhook's signature is valid. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PartnerEvent>;
  mode(network: Network): CryptoMode;

  // Partners that read the chain themselves instead of sending webhooks (NosHen's own Solana wallet).
  /** The networks this partner watches: their deposits are checked with watch(). */
  readonly watches?: readonly Network[];
  /** The providers whose deposits are checked with watch() (each deposit records who made it). */
  readonly watchingProviders?: readonly string[];
  /** Which provider makes new deposits on a network (stored with each deposit). */
  providerFor?(network: Network): string;
  /** New payments into one deal's address, and the cursor to start from next time. */
  watch?(deposit: WatchedDeposit): Promise<{ events: PartnerEvent[]; cursor: string | null }>;
  /** Results of refunds already sent on a network: an event for each one the network has settled. */
  settled?(network: Network, sent: { transferId: string; partnerRef: string; sentAt: Date }[]): Promise<PartnerEvent[]>;
  /** At release: moves the deal's coin from its address into NosHen's wallet. Returns the transaction. */
  collect?(network: Network, depositRef: string, micro: number): Promise<string>;
  /** Test networks only: pays a deal's address from NosHen's demo wallet, as a buyer's wallet would. */
  demoPay?(network: Network, depositRef: string, micro: number): Promise<string>;
  /** A link to an address or transaction on the network's explorer, where there is one. */
  explorer?(network: Network, kind: "address" | "tx", id: string): string | null;
}
