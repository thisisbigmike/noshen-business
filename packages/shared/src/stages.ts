// Services are paid in stages. The seller names each stage and its share of the price; the buyer pays the whole
// price into the deal, and each stage is released on its own as the work gets done.
import { en, msg, type T } from "./i18n";
import { naira, type Kobo } from "./money";

export interface Stage { title: string; percent: number }

export const MAX_STAGES = 4;

/** A start and a finish, the most common way to pay for a job. */
export const DEFAULT_STAGES: Stage[] = [
  { title: msg("Work starts"), percent: 30 },
  { title: msg("Work finished"), percent: 70 },
];

/** Why a set of stages won't do, or null: 1 to 4 of them, each named, each at least 5%, adding up to 100%. */
export function stagesProblem(stages: Stage[], t: T = en): string | null {
  if (stages.length < 1 || stages.length > MAX_STAGES) return t("Use 1 to {max} stages.", { max: MAX_STAGES });
  for (const [i, s] of stages.entries()) {
    if (s.title.trim().length < 2) return t("Name stage {n}, like “Work starts”.", { n: i + 1 });
    if (s.title.trim().length > 60) return t("Keep stage {n}'s name under 60 characters.", { n: i + 1 });
    if (!Number.isInteger(s.percent) || s.percent < 5) return t("Each stage is at least 5% of the price.");
  }
  const total = stages.reduce((n, s) => n + s.percent, 0);
  if (total !== 100) return t("The stages add up to {total}%. Make them add up to 100%.", { total });
  return null;
}

/** Stages from a form: stage_title_1, stage_percent_1, … */
export function stagesFromForm(f: FormData): Stage[] {
  const out: Stage[] = [];
  for (let n = 1; n <= MAX_STAGES; n++) {
    const title = String(f.get(`stage_title_${n}`) ?? "").trim();
    const percent = String(f.get(`stage_percent_${n}`) ?? "").trim();
    if (!title && !percent) continue;
    out.push({ title, percent: Number(percent.replace(/[^\d]/g, "")) || 0 });
  }
  return out;
}

/**
 * What each stage is worth: its share of what the seller gets and of NosHen's fee. Rounded to the kobo, with the
 * last stage taking what rounding leaves, so the stages always add up exactly.
 */
export function splitStages(stages: Stage[], shareKobo: Kobo, feeKobo: Kobo) {
  let share = 0, fee = 0;
  return stages.map((s, i) => {
    const last = i === stages.length - 1;
    const sh = last ? shareKobo - share : Math.round((shareKobo * s.percent) / 100);
    const fe = last ? feeKobo - fee : Math.round((feeKobo * s.percent) / 100);
    share += sh; fee += fe;
    return { n: i + 1, title: s.title.trim(), shareKobo: sh, feeKobo: fe };
  });
}

/** "Work starts: 30% (₦15,000)", for a listing. */
export const stageLabel = (s: Stage, priceKobo: Kobo) => `${s.title}: ${s.percent}% (${naira(Math.round((priceKobo * s.percent) / 100))})`;
