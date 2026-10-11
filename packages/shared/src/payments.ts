// Ways to pay into a deal. Every deal is priced and held in naira. A buyer pays by bank transfer in naira, or
// sends USDT (a dollar stablecoin) on one of four networks, which our crypto partner turns into naira for the deal.
// Which ways come first depends on the country the buyer is in.

export const USDT_NETWORKS = [
  { id: "solana", name: "Solana", tag: "SOL", standard: "SPL", fees: "Lowest network fees", evm: false },
  { id: "bsc", name: "BNB Smart Chain", tag: "BSC", standard: "BEP-20", fees: "Low network fees", evm: true },
  { id: "base", name: "Base", tag: "BASE", standard: "", fees: "Low network fees", evm: true },
  { id: "ethereum", name: "Ethereum", tag: "ETH", standard: "ERC-20", fees: "Higher network fees", evm: true },
] as const;

export type UsdtNetwork = (typeof USDT_NETWORKS)[number]["id"];
export type NetworkInfo = (typeof USDT_NETWORKS)[number];

export const isNetwork = (s: unknown): s is UsdtNetwork => typeof s === "string" && USDT_NETWORKS.some((n) => n.id === s);
export const networkOf = (id: UsdtNetwork): NetworkInfo => USDT_NETWORKS.find((n) => n.id === id)!;
/** "BNB Smart Chain (BEP-20)", "Base": as exchanges and wallets name them, so buyers can match the choice there. */
export const networkLabel = (n: NetworkInfo) => (n.standard ? `${n.name} (${n.standard})` : n.name);

/** How long a USDT amount holds. Prices move, so after this the buyer gets a new amount. */
export const QUOTE_MINUTES = 30;

const MICRO = 1_000_000n; // USDT has 6 decimal places on most networks; amounts are stored in millionths

/** The USDT to send for a naira amount, rounded up to the cent so the buyer never sends too little. */
export function usdtMicroFor(amountKobo: number, rateKoboPerUsdt: number): number {
  const cents = (BigInt(amountKobo) * 100n + BigInt(rateKoboPerUsdt) - 1n) / BigInt(rateKoboPerUsdt);
  return Number(cents * 10_000n);
}

/** What a USDT amount is worth in kobo at a rate, rounded down. */
export function koboForUsdt(usdtMicro: number, rateKoboPerUsdt: number): number {
  return Number((BigInt(usdtMicro) * BigInt(rateKoboPerUsdt)) / MICRO);
}

/** "12,908.07 USDT" */
export function usdt(micro: number | string, unit = true): string {
  const n = Number(micro) / 1e6;
  const s = n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return unit ? `${s} USDT` : s;
}

/** The number to type or paste into a wallet: "12908.07", no commas. */
export const usdtPlain = (micro: number | string) => (Number(micro) / 1e6).toFixed(Number(micro) % 10_000 === 0 ? 2 : 6);

/** "8ZUf …  4xQe": an address in groups of four, easier to check by eye. */
export const groupAddress = (a: string) => a.replace(/(.{4})/g, "$1 ").trim();
export const last4 = (a: string) => a.slice(-4);

/** Why an address won't do for refunds on a network, or null. */
export function usdtAddressProblem(network: UsdtNetwork, value: string): string | null {
  const a = value.trim();
  const n = networkOf(network);
  if (!a) return `Add your USDT address on ${n.name}. If you're refunded, the money goes here.`;
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
  /** In Nigeria, naira by bank transfer comes first. Elsewhere, USDT does. */
  bankFirst: boolean;
  bankDetail: string;
  /** False when no crypto partner is set up: only bank transfer is offered. */
  usdt: boolean;
  /** "Mobile money in cedis is coming soon", or null. */
  soon: string | null;
}

export function payPlanFor(country: string | null, usdtOn: boolean): PayPlan {
  const name = country ? countryName(country) : "your country";
  if (country === "NG" || !usdtOn) {
    return {
      country, countryName: name, bankFirst: true, usdt: usdtOn,
      bankDetail: country === "NG" || !country ? "From any Nigerian bank app. Usually shows in minutes." : "From a Nigerian bank account. Usually shows in minutes.",
      soon: country && country !== "NG" && LOCAL_SOON[country] ? `${LOCAL_SOON[country]} is coming soon.` : null,
    };
  }
  return {
    country, countryName: name, bankFirst: false, usdt: true,
    bankDetail: "Only if you have a Nigerian bank account.",
    soon: country && LOCAL_SOON[country] ? `${LOCAL_SOON[country]} is coming soon.` : `Cards and local ways to pay in ${name} are coming.`,
  };
}
