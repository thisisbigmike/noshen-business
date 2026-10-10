// What people can sell on NosHen, and what changes by category: the ID a buyer checks (IMEI, serial,
// chassis number), the checks before the release code, and the problems a buyer can report.
// The keys match the listing_category enum in the database.

import type { DisputeReason } from "./deal";

export type CategoryKey = "phone" | "laptop" | "electronics" | "fashion" | "shoes" | "vehicle" | "home" | "other";

/** The number a buyer matches at the hand-over. Shown to the buyer only after they pay. */
export interface IdField {
  label: string;
  hint: string;
  required: boolean;
  /** Normalised value must match this when given (and when required). */
  pattern: RegExp;
  error: string;
  numeric?: boolean;
}

export interface Category {
  key: CategoryKey;
  label: string;
  /** Lower-case word for sentences: "Check the phone first". */
  noun: string;
  icon: "device-mobile" | "device-laptop" | "device-tv" | "shirt" | "shoe" | "car" | "sofa" | "package";
  titleExample: string;
  describeHint: string;
  id?: IdField;
  reasons: DisputeReason[];
}

export const CATEGORIES: Category[] = [
  {
    key: "phone", label: "Phones & tablets", noun: "phone", icon: "device-mobile",
    titleExample: "iPhone 13, 128GB", describeHint: "How long you've used it, battery health, what comes with it.",
    id: { label: "IMEI", hint: "15 digits. Dial *#06# to see it. Buyers check it at the hand-over.", required: true, numeric: true, pattern: /^\d{15}$/, error: "The IMEI has 15 digits. Dial *#06# to see it." },
    reasons: ["not_as_described", "not_working", "locked", "imei_mismatch", "counterfeit", "not_delivered", "other"],
  },
  {
    key: "laptop", label: "Laptops & computers", noun: "laptop", icon: "device-laptop",
    titleExample: "HP EliteBook 840 G5", describeHint: "Processor, RAM, storage, battery life, and what comes with it.",
    id: { label: "Serial number (optional)", hint: "On the sticker underneath, or in System settings. Buyers check it at the hand-over.", required: false, pattern: /^[A-Z0-9-]{5,30}$/, error: "Use the serial number from the sticker: letters and numbers only." },
    reasons: ["not_as_described", "not_working", "locked", "not_delivered", "other"],
  },
  {
    key: "electronics", label: "Electronics", noun: "item", icon: "device-tv",
    titleExample: "PlayStation 5 with two pads", describeHint: "Model, how long you've used it, any faults, and what comes with it.",
    id: { label: "Serial number (optional)", hint: "On the label at the back or bottom. Buyers check it at the hand-over.", required: false, pattern: /^[A-Z0-9-]{5,30}$/, error: "Use the serial number from the label: letters and numbers only." },
    reasons: ["not_as_described", "not_working", "counterfeit", "not_delivered", "other"],
  },
  {
    key: "fashion", label: "Clothes & fashion", noun: "item", icon: "shirt",
    titleExample: "Ankara maxi dress, size 12", describeHint: "Size, fabric, how often it's been worn, and any marks.",
    reasons: ["not_as_described", "counterfeit", "not_delivered", "other"],
  },
  {
    key: "shoes", label: "Shoes", noun: "pair", icon: "shoe",
    titleExample: "Nike Air Force 1, size 43", describeHint: "Size (UK or EU), how often they've been worn, and whether the box comes with them.",
    reasons: ["not_as_described", "counterfeit", "not_delivered", "other"],
  },
  {
    key: "vehicle", label: "Cars & vehicles", noun: "car", icon: "car",
    titleExample: "Toyota Corolla 2014, automatic", describeHint: "Year, mileage, gearbox, papers you have, and any work it needs.",
    id: { label: "Chassis number (VIN)", hint: "On the vehicle papers and under the windscreen. Buyers check that the papers and the car match.", required: true, pattern: /^[A-Z0-9]{6,20}$/, error: "Enter the chassis number (VIN) from the papers: letters and numbers only." },
    reasons: ["not_as_described", "not_working", "documents_mismatch", "not_delivered", "other"],
  },
  {
    key: "home", label: "Home & furniture", noun: "item", icon: "sofa",
    titleExample: "3-seater fabric sofa, grey", describeHint: "Size, material, how old it is, and any marks.",
    reasons: ["not_as_described", "not_working", "not_delivered", "other"],
  },
  {
    key: "other", label: "Everything else", noun: "item", icon: "package",
    titleExample: "Yamaha keyboard with stand", describeHint: "What it is, its condition, and what comes with it.",
    reasons: ["not_as_described", "not_working", "counterfeit", "not_delivered", "other"],
  },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const isCategory = (k: unknown): k is CategoryKey => typeof k === "string" && (CATEGORY_KEYS as string[]).includes(k);
export const categoryOf = (k: string | null | undefined): Category => CATEGORIES.find((c) => c.key === k) ?? CATEGORIES[CATEGORIES.length - 1];
export const reasonsFor = (k: string | null | undefined): DisputeReason[] => categoryOf(k).reasons;

/** IMEI, serial or chassis number as stored: no spaces, upper case. */
export const normaliseId = (v: string) => v.replace(/\s/g, "").toUpperCase();

/** The three checks before the buyer sees their release code. */
export function checksFor(k: string | null | undefined, seller: string, id: string | null): [string, string][] {
  switch (categoryOf(k).key) {
    case "phone": return [
      ["It switches on and works", "Make a call. Try the camera, the screen and charging."],
      ["It isn’t locked to someone else’s account", `Settings should show no other Apple ID or Google account. Ask ${seller} to sign out in front of you.`],
      ["The IMEI matches the listing", `Dial *#06#. It should show ${id ?? "the IMEI on the listing"}.`],
    ];
    case "laptop": return [
      ["It switches on and works", "Open a few apps. Check the keyboard, screen and charging."],
      ["It isn’t locked to someone else’s account", `No other user account or activation lock. Ask ${seller} to sign out in front of you.`],
      [id ? "The serial number matches the listing" : "It’s the model in the listing", id ? `It should be ${id}.` : "Check the model on the sticker underneath or in System settings."],
    ];
    case "electronics": return [
      ["It powers on and works", "Plug it in and try the main things it does: picture, sound, buttons."],
      ["Everything in the listing is there", "Remote, cables, pads or charger: whatever the listing says comes with it."],
      [id ? "The serial number matches the listing" : "It’s the model in the listing", id ? `It should be ${id}.` : "Check the model name on the label or the box."],
    ];
    case "fashion": return [
      ["It’s the item in the photos", "Same colour, pattern and design as the listing."],
      ["The size is right", "Check the size label, and try it on if you can."],
      ["It’s in the condition described", "Look for stains, tears, missing buttons or broken zips. If it’s sold as original, check the labels and stitching."],
    ];
    case "shoes": return [
      ["It’s the pair in the photos", "Same model and colour, with a matching left and right."],
      ["The size is right", "Check the label inside and try them on."],
      ["They’re in the condition described", "Check the soles, stitching and glue. If they’re sold as original, check the tags and box label."],
    ];
    case "vehicle": return [
      ["The papers match the car", `The chassis number on the papers and on the car should be ${id ?? "the one on the listing"}. Check the name on the papers too.`],
      ["It starts, drives and stops well", "Take a test drive. Check the brakes, gears, AC and dashboard lights."],
      ["It’s in the condition described", "Check the body, tyres and inside. Bring a mechanic if you can."],
    ];
    case "home": return [
      ["It’s the item in the photos", "Same model, size and colour as the listing."],
      ["It works, if it’s an appliance", "Plug it in and turn it on. For furniture, check it’s solid and every part is there."],
      ["It’s in the condition described", "Look for marks, tears, cracks or missing parts."],
    ];
    default: return [
      ["It’s the item in the photos", "Same item, model and colour as the listing."],
      ["It works as described", "Try it the way you would use it."],
      ["Everything listed is there", "Parts, accessories and anything else the listing says comes with it."],
    ];
  }
}

/** An example for the "What happened" box when a buyer reports a problem. */
export function reportExample(k: string | null | undefined): string {
  switch (categoryOf(k).key) {
    case "phone": return "For example: the IMEI on the phone ends in 4410, the listing says 7631.";
    case "laptop": case "electronics": return "For example: it won't charge, and the listing said the battery is good.";
    case "fashion": case "shoes": return "For example: the label says size 10, the listing says size 12.";
    case "vehicle": return "For example: the chassis number on the papers is different from the one on the car.";
    default: return "For example: it has a crack that isn't in the photos.";
  }
}
