// The language and data saver switches. Each is a plain form post to /prefs, which saves the choice and reloads the
// page, so they work without JavaScript as well.
import { useLocation } from "react-router";
import { Icon } from "@noshen/ui/ui";
import { useLang, useLite, useT } from "@noshen/ui/i18n";
import { LANGS, LANG_INFO } from "@noshen/shared/i18n";

function useHere() {
  const l = useLocation();
  return l.pathname + l.search;
}

/** English | Pidgin, for settings. */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <form method="post" action="/prefs" className="seg theme-seg" role="group" aria-label={t("Language")}>
      <input type="hidden" name="next" value={useHere()} />
      {LANGS.map((l) => (
        <button key={l} type="submit" name="lang" value={l} aria-pressed={lang === l}>{LANG_INFO[l].name}</button>
      ))}
    </form>
  );
}

/** A small button that switches to the other language, for page headers: "Pidgin" in English, "English" in Pidgin. */
export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const other = lang === "en" ? "pcm" : "en";
  return (
    <form method="post" action="/prefs" className={className}>
      <input type="hidden" name="next" value={useHere()} />
      <button type="submit" name="lang" value={other} className="lang-toggle label" lang={LANG_INFO[other].html} title={t("Read NosHen in {language}", { language: LANG_INFO[other].name })}>
        <Icon name="world" size={16} />{LANG_INFO[other].name}
      </button>
    </form>
  );
}

/** Data saver: Off | On, for settings. */
export function DataSaverSwitch() {
  const lite = useLite();
  const t = useT();
  return (
    <form method="post" action="/prefs" className="seg theme-seg" role="group" aria-label={t("Data saver")}>
      <input type="hidden" name="next" value={useHere()} />
      <button type="submit" name="data" value="full" aria-pressed={!lite}>{t("Off")}</button>
      <button type="submit" name="data" value="lite" aria-pressed={lite}>{t("On")}</button>
    </form>
  );
}
