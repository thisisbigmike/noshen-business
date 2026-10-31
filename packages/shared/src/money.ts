// Money is always kobo, as an integer. ₦1 = 100 kobo. Never use floating point for amounts.

export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => Math.round(naira * 100);

/** "₦450,000" from 45000000 kobo. Kobo are shown only when they aren't zero. */
export function naira(kobo: Kobo | string | bigint): string {
  const k = Number(kobo);
  const whole = Math.trunc(k / 100);
  const rest = Math.abs(k % 100);
  const sign = k < 0 ? "-" : "";
  const body = Math.abs(whole).toLocaleString("en-NG");
  return `${sign}₦${body}${rest ? "." + String(rest).padStart(2, "0") : ""}`;
}

export interface FeeRule {
  percent: number;   // 1.5
  min_kobo: Kobo;    // 50000 (₦500)
  max_kobo: Kobo;    // 1000000 (₦10,000)
}

export const DEFAULT_FEE: FeeRule = { percent: 1.5, min_kobo: 50000, max_kobo: 1000000 };

/** NosHen's fee on a price: a percentage, rounded to the nearest kobo, kept between the minimum and maximum. */
export function feeFor(priceKobo: Kobo, rule: FeeRule = DEFAULT_FEE): Kobo {
  const raw = Math.round((priceKobo * rule.percent) / 100);
  return Math.min(rule.max_kobo, Math.max(rule.min_kobo, raw));
}

export type FeePayer = "buyer" | "seller";

/** What the buyer pays in, and what the seller gets on release. */
export function dealAmounts(priceKobo: Kobo, feeKobo: Kobo, payer: FeePayer) {
  return {
    dueKobo: payer === "buyer" ? priceKobo + feeKobo : priceKobo,
    sellerShareKobo: payer === "seller" ? priceKobo - feeKobo : priceKobo,
  };
}
