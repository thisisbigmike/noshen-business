import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromPrivateKeyBytes, createSolanaRpc, createTransactionMessage,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signature, signTransactionMessageWithSigners, type Address,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getMintToCheckedInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { QUOTE_MINUTES, coinMicroFor, koboForCoin, type Coin, type Network } from "@noshen/shared/payments";
import { addMinutes } from "@noshen/shared/time";
import { hmac } from "../crypto";
import { FAKE_RATE_KOBO } from "./fake-crypto";
import type { CryptoMode, CryptoPartner, CryptoRefund, PartnerEvent, WatchedDeposit } from "./types";

/** USDT and USDC both have 6 decimals on Solana, so amounts are in millionths, like the rest of NosHen. */
const DECIMALS = 6;

export interface SolanaConfig {
  rpcUrl: string;
  cluster: "devnet" | "mainnet-beta";
  /** The USDT and USDC mints on this cluster. On devnet, NosHen's own test tokens. */
  mints: Record<Coin, string>;
  /** NosHen's wallet (a 32-byte secret, base64): pays every network fee and receives released coin. */
  walletSecret: string;
  /** Turns a deal into its own address. Anyone with it controls the deposits, so it's a secret like the wallet. */
  depositSecret: string;
  /** Devnet only: the wallet behind "Send from NosHen's demo wallet". Its tokens are minted when it pays. */
  demoWalletSecret?: string;
}

type Rpc = ReturnType<typeof createSolanaRpc>;
type Signer = Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>;
type Ix = Parameters<typeof appendTransactionMessageInstructions>[0][number];

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A deposit's reference: which coin, for which deal. */
export const depositRef = (coin: Coin, dealId: string) => `sol:${coin}:${dealId}`;
function parseRef(ref: string): { coin: Coin; dealId: string } {
  const [kind, coin, dealId] = ref.split(":");
  if (kind !== "sol" || (coin !== "usdt" && coin !== "usdc") || !dealId) throw new Error(`not a Solana deposit: ${ref}`);
  return { coin, dealId };
}

/**
 * NosHen's own wallet on Solana, in place of a crypto partner. Each deal gets its own address (a key made from the
 * deposit secret and the deal, so nothing secret is stored), and the buyer pays it directly. NosHen reads the chain to
 * see the payment, sends refunds from that address, and at release moves the coin into its own wallet. NosHen's wallet
 * pays every network fee, so a deal's address never needs SOL.
 *
 * On devnet the tokens are NosHen's own test USDT and USDC (anyone can be sent some), at a fixed test rate. Moving to
 * mainnet is a matter of config: the real mints, a mainnet RPC, and a live rate (not built yet).
 */
export class SolanaPartner implements CryptoPartner {
  readonly name: string;
  readonly test: boolean;
  readonly watches = ["solana"] as const;
  private rpc: Rpc;
  private signers = new Map<string, Promise<Signer>>();

  constructor(private cfg: SolanaConfig, private afterSend: () => Promise<unknown> = async () => {}, rpc?: Rpc) {
    this.name = cfg.cluster === "devnet" ? "solana-devnet" : "solana";
    this.test = cfg.cluster !== "mainnet-beta";
    this.rpc = rpc ?? createSolanaRpc(cfg.rpcUrl);
  }

  mode(): CryptoMode { return this.test ? "devnet" : "live"; }

  async quote(amountKobo: number, coin: Coin, now: Date) {
    if (!this.test) throw new Error("Live rates aren't set up for Solana yet.");
    const rateKobo = FAKE_RATE_KOBO[coin];
    return { rateKobo, micro: coinMicroFor(amountKobo, rateKobo), expiresAt: addMinutes(now, QUOTE_MINUTES) };
  }

  private signer(secret: Uint8Array | string): Promise<Signer> {
    const key = typeof secret === "string" ? secret : Array.from(secret).join(",");
    let s = this.signers.get(key);
    if (!s) {
      s = createKeyPairSignerFromPrivateKeyBytes(typeof secret === "string" ? fromB64(secret) : secret);
      this.signers.set(key, s);
    }
    return s;
  }
  private wallet() { return this.signer(this.cfg.walletSecret); }
  /** The key behind one deal's address for one coin. */
  async depositSigner(dealId: string, coin: Coin) {
    return this.signer(await hmac(this.cfg.depositSecret, `noshen:solana-deposit:v1:${coin}:${dealId}`));
  }
  private mint(coin: Coin) { return address(this.cfg.mints[coin]); }
  /** A wallet's token account for a coin: where that coin actually sits. */
  private async tokenAccount(owner: Address, coin: Coin) {
    const [pda] = await findAssociatedTokenPda({ owner, mint: this.mint(coin), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return pda;
  }

  /** Signs with NosHen's wallet as fee payer (plus any signer in the instructions) and sends. Returns the signature. */
  private async send(instructions: Ix[]): Promise<string> {
    const payer = await this.wallet();
    const { value: blockhash } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    const sig = getSignatureFromTransaction(tx);
    await this.rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
    // Check again shortly, so the result shows without waiting for the minute check.
    await this.afterSend().catch(() => {});
    return sig;
  }

  async openDeposit(dealId: string, coin: Coin, network: Network) {
    if (network !== "solana") throw new Error(`NosHen's Solana wallet can't take ${network}.`);
    const owner = await this.depositSigner(dealId, coin);
    // Its token account, made now: a wallet creates one when it pays, but an exchange won't.
    try {
      const payer = await this.wallet();
      const ata = await this.tokenAccount(owner.address, coin);
      await this.send([getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: owner.address, mint: this.mint(coin) })]);
    } catch (e) {
      console.error("couldn't open the token account", depositRef(coin, dealId), e);
    }
    return { ref: depositRef(coin, dealId), address: owner.address as string, provider: this.name };
  }

  async watch(dep: WatchedDeposit) {
    const owner = address(dep.address);
    const account = await this.tokenAccount(owner, dep.coin);
    const sigs = await this.rpc.getSignaturesForAddress(account, {
      limit: 25, commitment: "confirmed", ...(dep.cursor ? { until: signature(dep.cursor) } : {}),
    }).send();
    if (!sigs.length) return { events: [], cursor: dep.cursor };
    const events: PartnerEvent[] = [];
    // Oldest first, so payments are taken in the order they came.
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const tx = await this.rpc.getTransaction(s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
      if (!tx?.meta || tx.meta.err) continue;
      const received = coinIn(tx.meta as TokenMeta, dep.address, this.cfg.mints[dep.coin]);
      if (received <= 0) continue; // a refund, a collection, or opening the account
      const at = s.blockTime ? new Date(Number(s.blockTime) * 1000) : new Date();
      // The deal's amount due if the amount asked for came while it held; otherwise converted at the rate.
      const kobo = received === dep.amountMicro && at <= dep.quoteExpiresAt ? dep.amountKobo : koboForCoin(received, dep.rateKobo);
      events.push({
        id: `sol:${s.signature}`, type: "crypto.received",
        data: { deposit_ref: dep.ref, coin: dep.coin, network: "solana", amount_micro: received, amount_kobo: kobo, tx_hash: s.signature, received_at: at.toISOString() },
      });
    }
    return { events, cursor: sigs[0].signature as string };
  }

  async sendRefund(r: CryptoRefund) {
    if (r.network !== "solana") throw new Error(`NosHen's Solana wallet can't send on ${r.network}.`);
    if (!r.depositRef || !r.micro) throw new Error(`refund ${r.transferId} needs its deposit and amount`);
    const { coin, dealId } = parseRef(r.depositRef);
    const from = await this.depositSigner(dealId, coin);
    const to = address(r.address);
    const [source, destination, payer] = await Promise.all([this.tokenAccount(from.address, coin), this.tokenAccount(to, coin), this.wallet()]);
    const sig = await this.send([
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: to, mint: this.mint(coin) }),
      getTransferCheckedInstruction({ source, mint: this.mint(coin), destination, authority: from, amount: BigInt(r.micro), decimals: DECIMALS }),
    ]);
    return { partnerRef: sig };
  }

  async settled(network: Network, sent: { transferId: string; partnerRef: string; sentAt: Date }[]) {
    if (network !== "solana" || !sent.length) return [];
    const { value } = await this.rpc.getSignatureStatuses(sent.map((t) => signature(t.partnerRef)), { searchTransactionHistory: true }).send();
    const events: PartnerEvent[] = [];
    sent.forEach((t, i) => {
      const s = value[i];
      const done = s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");
      // A transaction the network never took is gone for good once its blockhash expires (about a minute).
      const lost = !s && Date.now() - t.sentAt.getTime() > 5 * 60_000;
      if (s?.err || lost) {
        events.push({ id: `sol-failed:${t.partnerRef}`, type: "transfer.failed", data: { transfer_id: t.transferId, partner_ref: t.partnerRef, reason: lost ? "The Solana network didn't take the transaction." : "The Solana transaction failed." } });
      } else if (done) {
        events.push({ id: `sol-done:${t.partnerRef}`, type: "transfer.succeeded", data: { transfer_id: t.transferId, partner_ref: t.partnerRef } });
      }
    });
    return events;
  }

  async collect(network: Network, ref: string, micro: number) {
    if (network !== "solana") throw new Error(`NosHen's Solana wallet can't collect on ${network}.`);
    const { coin, dealId } = parseRef(ref);
    const from = await this.depositSigner(dealId, coin);
    const payer = await this.wallet();
    const [source, destination] = await Promise.all([this.tokenAccount(from.address, coin), this.tokenAccount(payer.address, coin)]);
    return this.send([
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: destination, owner: payer.address, mint: this.mint(coin) }),
      getTransferCheckedInstruction({ source, mint: this.mint(coin), destination, authority: from, amount: BigInt(micro), decimals: DECIMALS }),
    ]);
  }

  async demoPay(network: Network, ref: string, micro: number) {
    if (network !== "solana" || !this.test || !this.cfg.demoWalletSecret) throw new Error("The demo wallet only pays on devnet.");
    const { coin, dealId } = parseRef(ref);
    const [payer, demo, deposit] = await Promise.all([this.wallet(), this.signer(this.cfg.demoWalletSecret), this.depositSigner(dealId, coin)]);
    const [demoAccount, depositAccount] = await Promise.all([this.tokenAccount(demo.address, coin), this.tokenAccount(deposit.address, coin)]);
    const mint = this.mint(coin);
    // NosHen's wallet mints the test coin to the demo wallet, which then pays it to the deal like any buyer would.
    return this.send([
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: demoAccount, owner: demo.address, mint }),
      getMintToCheckedInstruction({ mint, token: demoAccount, mintAuthority: payer, amount: BigInt(micro), decimals: DECIMALS }),
      getCreateAssociatedTokenIdempotentInstruction({ payer, ata: depositAccount, owner: deposit.address, mint }),
      getTransferCheckedInstruction({ source: demoAccount, mint, destination: depositAccount, authority: demo, amount: BigInt(micro), decimals: DECIMALS }),
    ]);
  }

  explorer(network: Network, kind: "address" | "tx", id: string) {
    if (network !== "solana") return null;
    return `https://explorer.solana.com/${kind}/${id}${this.test ? "?cluster=devnet" : ""}`;
  }

  async verifyWebhook(): Promise<PartnerEvent> {
    throw new Error("NosHen's Solana wallet reads the chain; it takes no webhooks.");
  }
}

interface TokenBalance { owner?: string; mint: string; uiTokenAmount: { amount: string } }
interface TokenMeta { preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null }

/** How much of a coin a transaction moved into an owner's account (negative when it moved out), in millionths. */
export function coinIn(meta: TokenMeta, owner: string, mint: string): number {
  const of = (list?: readonly TokenBalance[] | null) =>
    BigInt(list?.find((b) => b.owner === owner && b.mint === mint)?.uiTokenAmount.amount ?? "0");
  return Number(of(meta.postTokenBalances) - of(meta.preTokenBalances));
}
