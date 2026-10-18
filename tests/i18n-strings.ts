// Every English string the customer site shows, for checking the translations: the literal text in t("…"),
// t.rich("…") and msg("…") in its code, plus the words kept in tables (categories, conditions, sizes…), which are
// translated where they're shown with t(value).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES } from "@noshen/shared/categories";
import { CONDITIONS, DISPUTE_REASONS, STATUS } from "@noshen/shared/deal";
import { SIZES } from "@noshen/shared/sizes";
import { LEGAL_NAV } from "@noshen/shared/legal-pages";
import { COUNTRIES } from "@noshen/shared/locations";

const root = new URL("..", import.meta.url).pathname;

/** Where the customer site's words are written. The staff site stays in English. */
const PLACES = ["apps/web/app", "apps/web/server", "packages/ui/src", "packages/shared/src", "packages/engine/src/photos.ts", "packages/engine/src/waitlist.ts"];

function filesIn(path: string): string[] {
  const full = join(root, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((f) => filesIn(join(path, f))).filter((f) => /\.tsx?$/.test(f) && !/(i18n-pcm\.ts|\/i18n\.tsx?)$/.test(f));
}

const LITERAL = /\b(?:t|t\.rich|msg)\(\s*"((?:[^"\\\n]|\\.)*)"/g;

/** The English strings in the code, with the file each first appears in. */
export function codeStrings(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of PLACES.flatMap(filesIn)) {
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(LITERAL)) {
      const text = JSON.parse(`"${m[1]}"`) as string;
      if (!found.has(text)) found.set(text, file);
    }
  }
  return found;
}

/** The words kept in tables and translated where they're shown. */
export function tableStrings(): string[] {
  const out: string[] = [];
  for (const c of CATEGORIES) {
    out.push(c.label, c.describeHint);
    if (c.id) out.push(c.id.label, c.id.hint);
  }
  for (const [, label, hint] of CONDITIONS) out.push(label, hint);
  for (const [, label] of DISPUTE_REASONS) out.push(label);
  for (const s of Object.values(STATUS)) out.push(s.word);
  for (const rule of Object.values(SIZES)) {
    if (!rule) continue;
    out.push(rule.label, rule.hint, ...rule.systems.map((x) => x.label));
  }
  for (const p of LEGAL_NAV) out.push(p.title);
  for (const c of COUNTRIES) out.push(c.name);
  return out;
}

export const allStrings = () => new Set([...codeStrings().keys(), ...tableStrings()]);
