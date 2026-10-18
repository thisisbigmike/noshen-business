// Where NosHen works: every state in Nigeria now, more countries later. A listing has a state and an area
// (a town or neighbourhood the seller types, like "Yaba" or "Wuse 2"), never a street address.
import { en, type T } from "./i18n";

/** The 36 states and the Federal Capital Territory, as stored on listings. */
export const NIGERIA_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

export type NigeriaState = (typeof NIGERIA_STATES)[number];

export const isState = (s: unknown): s is NigeriaState => typeof s === "string" && (NIGERIA_STATES as readonly string[]).includes(s);

/** How a state reads on screen: "Abuja (FCT)" in lists, "Abuja" after an area. */
export const stateLabel = (s: string) => (s === "FCT" ? "Abuja (FCT)" : s);
const stateShort = (s: string) => (s === "FCT" ? "Abuja" : s);

/** "Yaba, Lagos", "Wuse 2, Abuja". Leaves out the area when there isn't one yet. */
export function placeLabel(area: string | null | undefined, state: string | null | undefined): string {
  const a = (area ?? "").trim();
  const s = state ? stateShort(state) : "";
  if (a && s && a.toLowerCase() !== s.toLowerCase()) return `${a}, ${s}`;
  return a || s || "Nigeria";
}

export interface Country { code: string; name: string; live: boolean }

/** Nigeria is live. The others are on the way and shown as "coming soon". */
export const COUNTRIES: Country[] = [
  { code: "NG", name: "Nigeria", live: true },
  { code: "GH", name: "Ghana", live: false },
  { code: "KE", name: "Kenya", live: false },
  { code: "ZA", name: "South Africa", live: false },
];

export const COMING_SOON = COUNTRIES.filter((c) => !c.live).map((c) => c.name);

/** "Ghana, Kenya and South Africa" */
export const comingSoonList = () =>
  COMING_SOON.length > 1 ? `${COMING_SOON.slice(0, -1).join(", ")} and ${COMING_SOON[COMING_SOON.length - 1]}` : COMING_SOON[0] ?? "";

/** Why an area won't do, or null. Buyers see it, so it's a neighbourhood or town, not an address. */
export function areaProblem(value: string, t: T = en): string | null {
  const s = value.trim();
  if (!s) return t("Add your area or town, like Yaba, Wuse 2 or GRA. Buyers see this, not your address.");
  if (s.length < 2) return t("That's too short. Add the area or town, like Yaba or Wuse 2.");
  if (s.length > 40) return t("Keep it under 40 characters: just the area or town, not your address.");
  // A house number with a street word ("12 Ring Road") is an address; "Wuse 2" or "Phase 1" is an area.
  if (/\d/.test(s) && /\b(street|st|road|rd|close|cl|avenue|ave|crescent|cres|lane|ln|drive|dr|way|estate road)\b\.?/i.test(s)) return t("Leave out your street address. Just the area or town is enough.");
  if (/[<>{}[\]\\]/.test(s)) return t("Use letters, numbers and spaces only.");
  return null;
}
