// A seller's track record in a word, from what happened in their deals (not just a one-time ID check).
import { en, type T } from "./i18n";

export interface TrackRecordLike { idVerified: boolean; completedDeals: number; problemFree: number | null; disputesLost: number }

export type TrustLevel = "trusted" | "building" | "new";

/** Trusted: ID checked, at least 5 sales completed, and at least 95% of them without a problem decided against them. */
export function trustLevel(s: TrackRecordLike): TrustLevel {
  if (s.idVerified && s.completedDeals >= 5 && (s.problemFree ?? 0) >= 95) return "trusted";
  return s.completedDeals > 0 ? "building" : "new";
}

/** "Within an hour", "In about 3 hours", "In about 2 days". */
export function replyTime(minutes: number | null, t: T = en): string | null {
  if (minutes === null) return null;
  if (minutes <= 60) return t("Within an hour");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? t("In about an hour") : t("In about {n} hours", { n: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t("In about a day") : t("In about {n} days", { n: days });
}

/** "Oct 2026", in Nigeria time. */
export const monthYear = (d: Date | string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date(d));
