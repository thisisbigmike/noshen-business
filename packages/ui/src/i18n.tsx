// The chosen language, data saver and country, for every screen: useT() translates, useLite() says whether to save
// data, useMarket() is the NosHen country being shown.
// See @noshen/shared/i18n for how translation works. Without a provider (the staff site), it's English, data saver off.
import { createContext, Fragment, useContext, useMemo, type ReactNode } from "react";
import { richParts, translator, type Lang, type T as PlainT, type Vars } from "@noshen/shared/i18n";

/**
 * market: the NosHen country being shown (NG, GH, KE, ZA). from: the country the visitor is in, when known (any
 * two-letter code), for "visiting from abroad" notes.
 */
interface Prefs { lang: Lang; lite: boolean; market?: string; from?: string | null }
const PrefsContext = createContext<Prefs>({ lang: "en", lite: false, market: "NG", from: null });

export function PrefsProvider({ lang, lite, market = "NG", from = null, children }: Prefs & { children: ReactNode }) {
  const value = useMemo(() => ({ lang, lite, market, from }), [lang, lite, market, from]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const useLang = () => useContext(PrefsContext).lang;
export const useLite = () => useContext(PrefsContext).lite;
export const useMarket = () => useContext(PrefsContext).market ?? "NG";
export const useVisitorCountry = () => useContext(PrefsContext).from ?? null;

/** Each tag in rich text becomes what this says: { b: (text) => <strong>{text}</strong> }. */
export type Tags = Record<string, (text: string) => ReactNode>;

export type T = PlainT & {
  /** Rich text: t.rich("Agree to the <a>terms</a>.", { a: (s) => <Link to="/terms">{s}</Link> }). */
  rich: (text: string, tags: Tags, vars?: Vars) => ReactNode;
};

export function makeT(lang: Lang): T {
  const t = translator(lang);
  const rich = (text: string, tags: Tags, vars?: Vars) =>
    richParts(t(text, vars)).map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <Fragment key={i}>{tags[p.tag]?.(p.text) ?? p.text}</Fragment>));
  return Object.assign((text: string, v?: Vars) => t(text, v), { rich });
}

/** The translator for the chosen language. */
export function useT(): T {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
