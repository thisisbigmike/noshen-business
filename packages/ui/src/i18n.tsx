// The chosen language, data saver and country, for every screen: useT() translates, useLite() says whether to save
// data, useMarket() is the NosHen country being shown.
// See @noshen/shared/i18n for how translation works. Without a provider (the staff site), it's English, data saver off.
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LANG_COOKIE, LANG_INFO, loadCatalog, richParts, translator, type Lang, type T as PlainT, type Vars } from "@noshen/shared/i18n";
import { DATA_COOKIE } from "@noshen/shared/data-saver";
import { COUNTRY_COOKIE } from "@noshen/shared/locations";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * market: the NosHen country being shown (NG, GH, KE, ZA). from: the country the visitor is in, when known (any
 * two-letter code), for "visiting from abroad" notes.
 */
interface Prefs { lang: Lang; lite: boolean; market?: string; from?: string | null }
interface PrefsActions {
  setLang: (next: Lang) => Promise<void>;
  setLite: (next: boolean) => void;
  setMarket: (next: string) => void;
}
const noopAsync = async () => {};
const noop = () => {};
const PrefsContext = createContext<Prefs & PrefsActions>({
  lang: "en", lite: false, market: "NG", from: null,
  setLang: noopAsync, setLite: noop, setMarket: noop,
});

export function PrefsProvider({ lang: initLang, lite: initLite, market: initMarket = "NG", from = null, children }: Prefs & { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initLang);
  const [lite, setLiteState] = useState<boolean>(initLite);
  const [market, setMarketState] = useState<string>(initMarket);

  useEffect(() => { setLangState(initLang); }, [initLang]);
  useEffect(() => { setLiteState(initLite); }, [initLite]);
  useEffect(() => { setMarketState(initMarket); }, [initMarket]);

  const langReq = useRef(0);
  const setLang = useCallback(async (next: Lang) => {
    const id = ++langReq.current;
    document.cookie = `${LANG_COOKIE}=${next}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    await loadCatalog(next);
    if (langReq.current !== id) return;
    document.documentElement.lang = LANG_INFO[next].html;
    document.documentElement.dataset.lang = next;
    setLangState(next);
  }, []);

  const setLite = useCallback((next: boolean) => {
    document.cookie = `${DATA_COOKIE}=${next ? "lite" : "full"}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    setLiteState(next);
  }, []);

  const setMarket = useCallback((next: string) => {
    document.cookie = `${COUNTRY_COOKIE}=${next}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    setMarketState(next);
  }, []);

  const value = useMemo(
    () => ({ lang, lite, market, from, setLang, setLite, setMarket }),
    [lang, lite, market, from, setLang, setLite, setMarket],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const useLang = () => useContext(PrefsContext).lang;
export const useLite = () => useContext(PrefsContext).lite;
export const useMarket = () => useContext(PrefsContext).market ?? "NG";
export const useVisitorCountry = () => useContext(PrefsContext).from ?? null;
export const useSetPrefs = () => {
  const { setLang, setLite, setMarket } = useContext(PrefsContext);
  return { setLang, setLite, setMarket };
};

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
