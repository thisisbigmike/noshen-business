import type { Coin } from "@noshen/shared/payments";

/**
 * Live NGN/USDT and NGN/USDC exchange-rate cache (5 minutes) with a small volatility buffer
 * so NosHen is protected against short-term FX swings while funds are held in escrow.
 */
const CACHE_MS = 5 * 60_000;
const SPREAD_BPS = 75; // 0.75% FX buffer on top of spot rate

let cached: { at: number; rates: Record<Coin, number> } | null = null;

/**
 * Fetches live NGN rates (in kobo per 1 USDT / 1 USDC) from CoinGecko's public simple price feed.
 * Falls back to `fallback` if offline, rate-limited, or invalid.
 */
export async function liveRateKobo(coin: Coin, fallback: Record<Coin, number>): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.rates[coin];
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=ngn", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return fallback[coin];
    const data = (await res.json()) as { tether?: { ngn?: number }; "usd-coin"?: { ngn?: number } };
    const usdtNgn = Number(data?.tether?.ngn ?? 0);
    const usdcNgn = Number(data?.["usd-coin"]?.ngn ?? 0);
    // Sanity bounds: ₦500 – ₦10,000 per USD so a corrupted upstream feed can never quote an absurd rate.
    if (usdtNgn < 500 || usdtNgn > 10_000 || usdcNgn < 500 || usdcNgn > 10_000) return fallback[coin];
    const withSpread = (ngn: number) => Math.round(ngn * (1 + SPREAD_BPS / 10_000) * 100);
    cached = { at: now, rates: { usdt: withSpread(usdtNgn), usdc: withSpread(usdcNgn) } };
    return cached.rates[coin];
  } catch {
    return fallback[coin];
  }
}
