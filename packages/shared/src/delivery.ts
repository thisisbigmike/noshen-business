// Delivery: the seller sets a price for each zone on the listing, the buyer picks their state, and the fee is held
// with the price and paid to the seller at release (they pay the courier). Zones are by state, not distance:
// buyers know their state, and sellers already price "Lagos" against "outside Lagos".
import { naira, type Kobo } from "./money";
import { stateLabel } from "./locations";

/** "local": within the state the item is in. "other": any other state. */
export type DeliveryZone = "local" | "other";

/** The most a seller can charge for delivery (₦500,000, enough for a car on a truck). */
export const DELIVERY_MAX_KOBO: Kobo = 50_000_000;

/** A listing's delivery prices, in kobo: null when not offered, 0 when free. */
export interface DeliveryPrices {
  state: string | null;
  delivery_local_kobo: string | number | null;
  delivery_other_kobo: string | number | null;
}

const price = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export const deliveryZone = (itemState: string | null, buyerState: string): DeliveryZone => (itemState === buyerState ? "local" : "other");

/** What delivery to this state costs, or null when the seller doesn't deliver there. */
export function deliveryFee(l: DeliveryPrices, buyerState: string): Kobo | null {
  return deliveryZone(l.state, buyerState) === "local" ? price(l.delivery_local_kobo) : price(l.delivery_other_kobo);
}

export const offersDelivery = (l: DeliveryPrices) => price(l.delivery_local_kobo) !== null || price(l.delivery_other_kobo) !== null;

/** "Free", "₦3,000", or "Not offered". */
export const deliveryPriceLabel = (kobo: string | number | null) => (kobo === null ? "Not offered" : Number(kobo) === 0 ? "Free" : naira(kobo));

/** The two zones, to follow "Delivery": "within Lagos", "to other states". */
export function deliveryZones(l: DeliveryPrices) {
  return [
    { zone: "local" as const, label: `within ${l.state ? stateLabel(l.state) : "the item's state"}`, kobo: price(l.delivery_local_kobo) },
    { zone: "other" as const, label: "to other states", kobo: price(l.delivery_other_kobo) },
  ];
}

/** "3 days", from the hours a seller has to send it after payment. */
export const sendWithin = (hours: number) => (hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? "" : "s"}` : `${hours} hours`);

/** A short line for a listing: "Delivery: free in Lagos, ₦8,000 to other states", or null for meet-up only. */
export function deliverySummary(l: DeliveryPrices): string | null {
  const local = price(l.delivery_local_kobo);
  const other = price(l.delivery_other_kobo);
  if (local === null && other === null) return null;
  const where = l.state ? stateLabel(l.state) : "the item's state";
  const part = (k: number, place: string) => (k === 0 ? `free ${place}` : `${naira(k)} ${place}`);
  const bits = [local !== null ? part(local, `in ${where}`) : null, other !== null ? part(other, "to other states") : null].filter(Boolean);
  return `Delivery: ${bits.join(", ")}`;
}

/** Why a delivery price the seller typed won't do, or null. Empty means not offered; 0 means free. */
export function deliveryPriceProblem(value: string): string | null {
  const v = value.replace(/[,\s₦]/g, "");
  if (!v) return null;
  if (!/^\d+$/.test(v)) return "Enter the delivery price in naira, like 3,000. Use 0 for free delivery.";
  if (Number(v) * 100 > DELIVERY_MAX_KOBO) return `Delivery can be up to ${naira(DELIVERY_MAX_KOBO)}.`;
  return null;
}

/** A delivery price from the form: null for not offered, kobo otherwise (NaN when offered but left empty). */
export function parseDeliveryPrice(value: unknown, offered: boolean): Kobo | null {
  if (!offered) return null;
  const v = String(value ?? "").replace(/[,\s₦]/g, "");
  return v === "" || !/^\d+$/.test(v) ? NaN : Number(v) * 100;
}

/** Couriers sellers often use, offered as suggestions. Sellers can type any other. */
export const COURIERS = [
  "GIG Logistics", "GUO Transport", "ABC Transport", "Peace Mass Transit", "Red Star Express", "DHL", "Dispatch rider",
] as const;

export const PACKING_PHOTOS_MIN = 2;
export const PACKING_PHOTOS_MAX = 6;

/** Why the sending details won't do, or null. Out of the state, a tracking or waybill number is required. */
export function sendingProblem(zone: DeliveryZone, courier: string, tracking: string, photos: number): string | null {
  if (photos < PACKING_PHOTOS_MIN) return `Add at least ${PACKING_PHOTOS_MIN} photos: the item going into the package, and the package sealed.`;
  if (photos > PACKING_PHOTOS_MAX) return `Add up to ${PACKING_PHOTOS_MAX} photos.`;
  if (courier.trim().length < 2) return "Say who is delivering it, like GIG Logistics or a dispatch rider.";
  if (courier.trim().length > 60) return "Keep the courier's name under 60 characters.";
  if (zone === "other" && tracking.trim().length < 3) return "Add the tracking or waybill number from your receipt. The buyer uses it to follow the package.";
  if (tracking.trim().length > 60) return "Keep the tracking number under 60 characters.";
  return null;
}

/** What the packing photos should show, by category. */
export function packingHint(category: string): string {
  if (category === "phone") return "Show the phone switched on with the IMEI screen (dial *#06#) next to the open package, then the package sealed with its label.";
  if (category === "laptop" || category === "electronics") return "Show it switched on next to the open package, then the package sealed with its label.";
  if (category === "vehicle") return "Show the car loaded, with the plate number visible, and the waybill or delivery note.";
  return "Show the item going into the package, then the package sealed with its label or waybill.";
}
