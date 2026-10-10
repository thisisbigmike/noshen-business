// Deal states and the moves between them: the same machine the database enforces (deals_guard).

export type DealState =
  | "requested" | "accepted" | "held" | "disputed"
  | "released" | "paid_out" | "refunded" | "declined";

export const MOVES: Record<DealState, DealState[]> = {
  requested: ["accepted", "declined"],
  accepted: ["held", "declined"],
  held: ["released", "refunded", "disputed"],
  disputed: ["refunded", "released"],
  released: ["paid_out"],
  paid_out: [],
  refunded: [],
  declined: [],
};

export const canMove = (from: DealState, to: DealState) => MOVES[from].includes(to);
export const isClosed = (s: DealState) => s === "paid_out" || s === "refunded" || s === "declined";
export const isOpen = (s: DealState) => !isClosed(s);

/** The MoneyStatus chip for each state: the design system's money state plus its word. */
export const STATUS: Record<DealState, { state: "awaiting" | "held" | "released" | "dispute" | "refunded"; word: string }> = {
  requested: { state: "awaiting", word: "Request sent" },
  accepted: { state: "awaiting", word: "Awaiting payment" },
  held: { state: "held", word: "Held" },
  disputed: { state: "dispute", word: "Dispute" },
  released: { state: "released", word: "Released" },
  paid_out: { state: "released", word: "Paid out" },
  refunded: { state: "refunded", word: "Refunded" },
  declined: { state: "awaiting", word: "Declined" },
};

export type Handover = "meetup" | "delivery";

export const DISPUTE_REASONS = [
  ["not_as_described", "Not as described"],
  ["not_working", "Not working"],
  ["locked", "Locked to another account"],
  ["imei_mismatch", "IMEI doesn’t match"],
  ["counterfeit", "Fake, not original"],
  ["documents_mismatch", "Papers don’t match the car"],
  ["not_delivered", "Not delivered"],
  ["other", "Other"],
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number][0];

export const disputeReasonLabel = (r: string) => DISPUTE_REASONS.find(([k]) => k === r)?.[1] ?? r;

export const CONDITIONS = [
  ["new", "New", "Never used, with tags or in its box."],
  ["like_new", "Like new", "Used a little, no marks or wear."],
  ["good", "Good", "Works or wears well, light signs of use."],
  ["fair", "Fair", "Visible wear, priced for it."],
] as const;

export type Condition = (typeof CONDITIONS)[number][0];

export const AREAS = ["Yaba", "Ikeja", "Surulere", "Lekki", "Victoria Island", "Ajah", "Ikorodu", "Maryland", "Gbagada", "Festac"] as const;

/** Nigerian phone numbers in any common form → +234XXXXXXXXXX, or null. */
export function normalisePhone(input: string): string | null {
  const d = input.replace(/[^\d+]/g, "");
  let m: RegExpMatchArray | null;
  if ((m = d.match(/^\+?234(\d{10})$/))) return "+234" + m[1];
  if ((m = d.match(/^0(\d{10})$/))) return "+234" + m[1];
  if ((m = d.match(/^(\d{10})$/)) && /^[789]/.test(m[1])) return "+234" + m[1];
  return null;
}

/** +2348034127765 → 0803 412 7765 */
export function displayPhone(e164: string): string {
  const local = "0" + e164.replace(/^\+234/, "");
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

export const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || "Someone";
