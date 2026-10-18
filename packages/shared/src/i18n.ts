// Languages. English is written inline in the code, and the English text is the key: t("Buy with protection").
// Another language is a catalog from that English to its own words (i18n-pcm.ts for Pidgin). Anything a catalog
// doesn't have yet shows in English. Values go in {braces}: t("Meet {name} by {time}", { name, time }).
// Rich text marks a part with a tag, <b>like this</b>, and the screen decides what the tag becomes (see t.rich in
// @noshen/ui/i18n).
//
// A catalog is loaded only for people who chose that language, so English readers never download it.

export const LANGS = ["en", "pcm"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** What each language is called (in itself), and its tag for <html lang>. */
export const LANG_INFO: Record<Lang, { name: string; html: string }> = {
  en: { name: "English", html: "en-NG" },
  pcm: { name: "Pidgin", html: "pcm" },
};

export const LANG_COOKIE = "noshen-lang";

/** The language saved in the request's cookie; else Pidgin if the browser asks for it first; else English. */
export function langFromRequest(cookie: string | null, acceptLanguage: string | null): Lang {
  const saved = (cookie ?? "").match(/(?:^|;\s*)noshen-lang=([a-z]+)/)?.[1];
  if (isLang(saved)) return saved;
  return /^\s*pcm\b/i.test(acceptLanguage ?? "") ? "pcm" : "en";
}

export type Vars = Record<string, string | number>;
export type Catalog = Record<string, string>;

const catalogs: Partial<Record<Lang, Catalog>> = {};

/** Loads a language's catalog (once). English has none: its words are the keys. */
export async function loadCatalog(lang: Lang): Promise<void> {
  if (lang === "pcm" && !catalogs.pcm) catalogs.pcm = (await import("./i18n-pcm")).PCM;
}

/** Fills {name} with vars.name. A value that isn't given stays as {name}, so a missing one is easy to spot. */
export const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/** The text in this language (English if there's no translation yet), with its values filled in. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  return fill((lang === "en" ? undefined : catalogs[lang]?.[text]) ?? text, vars);
}

export type T = (text: string, vars?: Vars) => string;

/**
 * Marks English kept in a list or table to be translated where it's shown, with t(): [msg("Browse"), ...]. It
 * returns the text as it is; the mark lets the translation check find it.
 */
export const msg = (text: string) => text;

/** English as it's written: for code that runs where no language is chosen (the staff site, emails). */
export const en: T = (text, vars) => fill(text, vars);

export const translator = (lang: Lang): T => (lang === "en" ? en : (text, vars) => translate(lang, text, vars));

/** Splits rich text into plain parts and tagged parts: "Agree to the <a>terms</a>." → ["Agree to the ", {tag: "a", text: "terms"}, "."]. */
export function richParts(text: string): (string | { tag: string; text: string })[] {
  const out: (string | { tag: string; text: string })[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ tag: m[1], text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The {values} and <tags> in a text, sorted: a translation must keep exactly these. */
export function markersOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => (m[1] ? `{${m[1]}}` : `<${m[2]}>`)).sort();
}
