// Ways to pay into a deal. Every deal is priced and held in naira. A buyer pays by bank transfer in naira, or
// sends a dollar stablecoin (USDT or USDC) on one of four networks, which our crypto partner turns into naira for
// the deal. Which ways come first depends on the country the buyer is in.

export const COINS = [
  { id: "usdt", name: "USDT", issuer: "Tether" },
  { id: "usdc", name: "USDC", issuer: "Circle" },
] as const;

export type Coin = (typeof COINS)[number]["id"];
export const isCoin = (s: unknown): s is Coin => typeof s === "string" && COINS.some((c) => c.id === s);
export const coinName = (c: Coin) => COINS.find((x) => x.id === c)!.name;

// testnet: the test network NosHen uses there for now; explorer: where anyone can look a payment up.
export const NETWORKS = [
  { id: "solana", name: "Solana", standard: "SPL", fees: "Lowest network fees", evm: false, testnet: "Solana devnet", explorer: "Solana Explorer" },
  { id: "bsc", name: "BNB Smart Chain", standard: "BEP-20", fees: "Low network fees", evm: true, testnet: "BNB Smart Chain testnet", explorer: "BscScan" },
  { id: "base", name: "Base", standard: "", fees: "Low network fees", evm: true, testnet: "Base Sepolia", explorer: "BaseScan" },
  { id: "ethereum", name: "Ethereum", standard: "ERC-20", fees: "Higher network fees", evm: true, testnet: "Ethereum Sepolia", explorer: "Etherscan" },
] as const;

export type Network = (typeof NETWORKS)[number]["id"];
export type NetworkInfo = (typeof NETWORKS)[number];

/** Where a test-network address or transaction can be looked up. */
const TEST_EXPLORERS: Record<Network, (kind: "address" | "tx", id: string) => string> = {
  solana: (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`,
  bsc: (kind, id) => `https://testnet.bscscan.com/${kind}/${id}`,
  base: (kind, id) => `https://sepolia.basescan.org/${kind}/${id}`,
  ethereum: (kind, id) => `https://sepolia.etherscan.io/${kind}/${id}`,
};
export const testExplorerLink = (network: Network, kind: "address" | "tx", id: string) => TEST_EXPLORERS[network](kind, id);

export const isNetwork = (s: unknown): s is Network => typeof s === "string" && NETWORKS.some((n) => n.id === s);
export const networkOf = (id: Network): NetworkInfo => NETWORKS.find((n) => n.id === id)!;
/** "BNB Smart Chain (BEP-20)", "Base": as exchanges and wallets name them, so buyers can match the choice there. */
export const networkLabel = (n: NetworkInfo) => (n.standard ? `${n.name} (${n.standard})` : n.name);
/** "USDC on Base" */
export const cryptoLabel = (coin: Coin, network: Network) => `${coinName(coin)} on ${networkOf(network).name}`;

/** How long a coin amount holds. Prices move, so after this the buyer gets a new amount. */
export const QUOTE_MINUTES = 30;

const MICRO = 1_000_000n; // amounts are stored in millionths of a coin (USDT and USDC have 6 decimal places on most networks)

/** The coin to send for a naira amount, rounded up to the cent so the buyer never sends too little. */
export function coinMicroFor(amountKobo: number, rateKobo: number): number {
  const cents = (BigInt(amountKobo) * 100n + BigInt(rateKobo) - 1n) / BigInt(rateKobo);
  return Number(cents * 10_000n);
}

/** What a coin amount is worth in kobo at a rate (kobo for one coin), rounded down. */
export function koboForCoin(micro: number, rateKobo: number): number {
  return Number((BigInt(micro) * BigInt(rateKobo)) / MICRO);
}

/** "12,908.07 USDT" */
export function coinAmount(micro: number | string, coin: Coin): string {
  const n = Number(micro) / 1e6;
  return `${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${coinName(coin)}`;
}

/** The number to type or paste into a wallet: "12908.07", no commas. */
export const plainAmount = (micro: number | string) => (Number(micro) / 1e6).toFixed(Number(micro) % 10_000 === 0 ? 2 : 6);

/** "0x 5290 8400 …", "9xQe WvG8 …": an address in groups of four, easier to check by eye. */
export const groupAddress = (a: string) => {
  const [prefix, rest] = a.startsWith("0x") ? ["0x ", a.slice(2)] : ["", a];
  return prefix + rest.replace(/(.{4})/g, "$1 ").trim();
};
export const last4 = (a: string) => a.slice(-4);

/** Why an address won't do for refunds on a network, or null. The same address takes USDT and USDC. */
export function addressProblem(coin: Coin, network: Network, value: string): string | null {
  const a = value.trim();
  const n = networkOf(network);
  if (!a) return `Add your ${coinName(coin)} address on ${n.name}. If you're refunded, the money goes here.`;
  if (n.evm) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return `That isn't a ${n.name} address. Copy it from your wallet: it starts with 0x, then 40 letters and numbers.`;
    if (/^0x0{40}$/.test(a)) return "That address can't receive money. Copy your own address from your wallet.";
    return null;
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return `That isn't a ${n.name} address. Copy it from your wallet: it's 32 to 44 letters and numbers.`;
  return null;
}

// ---------------------------------------------------------------------------
// By country
// ---------------------------------------------------------------------------

/** Local ways to pay we're adding, by country. Shown as "coming soon" so people know. */
const LOCAL_SOON: Record<string, string> = {
  GH: "Mobile money in cedis",
  KE: "M-Pesa in shillings",
  ZA: "Bank transfer in rand",
};

export function countryName(code: string): string {
  if (code === "NG") return "Nigeria";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A two-letter country, or null for unknown ("XX") and Tor ("T1"). */
export function cleanCountry(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : null;
}

export interface PayPlan {
  country: string | null;
  countryName: string;
  /** In Nigeria, naira by bank transfer comes first. Elsewhere, stablecoins do. */
  bankFirst: boolean;
  bankDetail: string;
  /** False when no crypto partner is set up: only bank transfer is offered. */
  crypto: boolean;
  /** "Mobile money in cedis is coming soon", or null. */
  soon: string | null;
}

export function payPlanFor(country: string | null, cryptoOn: boolean): PayPlan {
  const name = country ? countryName(country) : "your country";
  if (country === "NG" || !cryptoOn) {
    return {
      country, countryName: name, bankFirst: true, crypto: cryptoOn,
      bankDetail: country === "NG" || !country ? "From any Nigerian bank app. Usually shows in minutes." : "From a Nigerian bank account. Usually shows in minutes.",
      soon: country && country !== "NG" && LOCAL_SOON[country] ? `${LOCAL_SOON[country]} is coming soon.` : null,
    };
  }
  return {
    country, countryName: name, bankFirst: false, crypto: true,
    bankDetail: "Only if you have a Nigerian bank account.",
    soon: country && LOCAL_SOON[country] ? `${LOCAL_SOON[country]} is coming soon.` : `Cards and local ways to pay in ${name} are coming.`,
  };
}
