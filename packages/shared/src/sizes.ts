// Sizes for the things that have them. The seller picks the kind of size first (EU, UK or US for shoes; S/M/L,
// UK, EU, US, waist or one size for clothes), then the size. Buyers see it as "EU 42", "UK 12" or "M".

import type { CategoryKey } from "./categories";

export interface SizeSystem {
  id: string;
  /** On the switch: "EU", "S, M, L", "Waist". */
  label: string;
  /** Before the size when shown: "EU" makes "EU 42". Empty when the size says it all ("M", "One size"). */
  prefix: string;
  values: string[];
}

export interface SizeRule {
  /** The field's name: "Shoe size", "Size", "Length", "Age". */
  label: string;
  required: boolean;
  hint: string;
  systems: SizeSystem[];
}

const range = (from: number, to: number, step = 1, suffix = "") => {
  const out: string[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(`${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`);
  return out;
};

export const SIZES: Partial<Record<CategoryKey, SizeRule>> = {
  shoes: {
    label: "Shoe size", required: true,
    hint: "Use the size on the label inside the shoe. Most shoes in Nigeria use EU sizes.",
    systems: [
      { id: "eu", label: "EU", prefix: "EU", values: range(35, 48) },
      { id: "uk", label: "UK", prefix: "UK", values: range(2, 13, 0.5) },
      { id: "us", label: "US", prefix: "US", values: range(4, 15, 0.5) },
    ],
  },
  fashion: {
    label: "Size", required: true,
    hint: "Use the size on the label. Exact measurements in the description help even more.",
    systems: [
      { id: "letter", label: "S, M, L", prefix: "", values: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"] },
      { id: "uk", label: "UK", prefix: "UK", values: range(4, 30, 2) },
      { id: "eu", label: "EU", prefix: "EU", values: range(32, 58, 2) },
      { id: "us", label: "US", prefix: "US", values: range(0, 26, 2) },
      { id: "waist", label: "Waist", prefix: "Waist", values: range(24, 50, 1, " in") },
      { id: "one", label: "One size", prefix: "", values: ["One size"] },
    ],
  },
  hair: {
    label: "Length", required: true,
    hint: "Measure it straightened, from the top to the tip.",
    systems: [{ id: "inches", label: "Inches", prefix: "", values: range(6, 40, 2, " inches") }],
  },
  baby: {
    label: "Age range", required: false,
    hint: "Who it fits, for clothes, shoes, car seats and the like.",
    systems: [{ id: "age", label: "Age", prefix: "", values: ["Newborn", "0–3 months", "3–6 months", "6–12 months", "12–18 months", "18–24 months", "2–3 years", "3–4 years", "4–5 years", "5–6 years", "6–8 years", "8–10 years", "10–12 years"] }],
  },
};

export const sizeRuleFor = (category: string | null | undefined): SizeRule | null => (category ? SIZES[category as CategoryKey] ?? null : null);

/** "EU 42", "UK 12", "M", "Waist 32 in", "One size", "22 inches". Null when there's no size. */
export function sizeLabel(category: string | null | undefined, system: string | null | undefined, size: string | null | undefined): string | null {
  if (!size) return null;
  const s = sizeRuleFor(category)?.systems.find((x) => x.id === system);
  return s?.prefix ? `${s.prefix} ${size.replace(/ in$/, "")}${s.id === "waist" ? " in" : ""}` : size;
}

/** Why a size won't do for a category, or null. */
export function sizeProblem(category: string, system: string | null | undefined, size: string | null | undefined): string | null {
  const rule = sizeRuleFor(category);
  if (!rule) return null;
  if (!size) return rule.required ? `Choose the ${rule.label.toLowerCase()}, so buyers know it fits.` : null;
  const s = rule.systems.find((x) => x.id === system);
  if (!s) return `Choose the kind of ${rule.label.toLowerCase()} first.`;
  if (!s.values.includes(size)) return `Choose a ${rule.label.toLowerCase()} from the list.`;
  return null;
}
