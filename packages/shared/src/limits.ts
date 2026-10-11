// Deal limits in words. Shared so the sell form can show them in the browser; the numbers come from
// sellerLimit() in @noshen/engine/deals.
import { naira } from "./money";

export interface SellerLimit {
  /** The most this seller can take in one deal, or null for no limit. */
  capKobo: number | null;
  /** Staff set this seller's limit by hand. */
  custom: boolean;
  /** The seller has passed the ID and bank checks. */
  verified: boolean;
}

/** True when a deal at this price is more than the seller can take. */
export const overLimit = (priceKobo: number, l: SellerLimit) => l.capKobo !== null && priceKobo > l.capKobo;

/** The limit in words, for the buyer looking at the listing or the seller listing it. Only used when over it. */
export function sellerLimitText(l: SellerLimit, to: "buyer" | "seller"): string {
  const cap = naira(l.capKobo ?? 0);
  if (to === "buyer") {
    return l.custom
      ? `This seller can take deals up to ${cap} for now, so this item can't be bought through NosHen yet.`
      : `This seller hasn't finished NosHen's ID and bank checks yet, so they can take deals up to ${cap} for now. This item can't be bought through NosHen yet.`;
  }
  return l.custom
    ? `Your deal limit is ${cap} for now. You can list it, but buyers can't buy it until NosHen raises your limit.`
    : `Until you've verified your ID and bank account, you can take deals up to ${cap}. Verify them to sell for more: you'll be asked before your listing goes live.`;
}
