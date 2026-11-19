// The language and data saver switches. Instant client-side update (no reload or scroll jump) when JS is on,
// with plain form POST fallback to /prefs when JS is off.
import { useLocation } from "react-router";
import { Icon } from "@noshen/ui/ui";
import { useLang, useLite, useSetPrefs, useT } from "@noshen/ui/i18n";
import { LANGS, LANG_INFO } from "@noshen/shared/i18n";

function useHere() {
  const l = useLocation();
  return l.pathname + l.search;
}

/** English | Pidgin, for settings. */
export function LanguageSwitch() {
  const lang = useLang();
  const { setLang } = useSetPrefs();
  const t = useT();
  return (
    <form method="post" action="/prefs" className="seg theme-seg" role="group" aria-label={t("Language")}
      style={{ ["--seg-i" as string]: Math.max(0, LANGS.indexOf(lang)) }}>
      <input type="hidden" name="next" value={useHere()} />
      {LANGS.map((l) => (
        <button key={l} type="submit" name="lang" value={l} aria-pressed={lang === l}
          onClick={(e) => { e.preventDefault(); if (lang !== l) void setLang(l); }}>
          {LANG_INFO[l].name}
        </button>
      ))}
    </form>
  );
}

/** A small button that switches to the other language, for page headers: "Pidgin" in English, "English" in Pidgin. */
export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang();
  const { setLang } = useSetPrefs();
  const t = useT();
  const other = lang === "en" ? "pcm" : "en";
  return (
    <form method="post" action="/prefs" className={className}>
      <input type="hidden" name="next" value={useHere()} />
      <button type="submit" name="lang" value={other} className="lang-toggle label" lang={LANG_INFO[other].html}
        title={t("Read NosHen in {language}", { language: LANG_INFO[other].name })}
        onClick={(e) => { e.preventDefault(); void setLang(other); }}>
        <Icon name="world" size={16} />{LANG_INFO[other].name}
      </button>
    </form>
  );
}

/** Data saver: Off | On, for settings. */
export function DataSaverSwitch() {
  const lite = useLite();
  const { setLite } = useSetPrefs();
  const t = useT();
  return (
    <form method="post" action="/prefs" className="seg theme-seg" role="group" aria-label={t("Data saver")}
      style={{ ["--seg-i" as string]: lite ? 1 : 0 }}>
      <input type="hidden" name="next" value={useHere()} />
      <button type="submit" name="data" value="full" aria-pressed={!lite}
        onClick={(e) => { e.preventDefault(); if (lite) setLite(false); }}>
        {t("Off")}
      </button>
      <button type="submit" name="data" value="lite" aria-pressed={lite}
        onClick={(e) => { e.preventDefault(); if (!lite) setLite(true); }}>
        {t("On")}
      </button>
    </form>
  );
}
