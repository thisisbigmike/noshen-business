// Countries. A visitor sees the NosHen country they're in (Cloudflare tells us) or the one they chose; Nigeria is
// live, the others show a coming-soon page with a waitlist. Every control here is a plain form post, so it works
// without JavaScript, like the language switch.
import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router";
import { Button, Icon, Info } from "@noshen/ui/ui";
import { useMarket, useT, useVisitorCountry } from "@noshen/ui/i18n";
import { COUNTRIES, isMarket, marketOf } from "@noshen/shared/locations";
import { countryName } from "@noshen/shared/payments";

function useHere() {
  const l = useLocation();
  return l.pathname + l.search;
}

/** The current country as a flag and name; tapping it lists the others. */
export function CountrySwitch({ className }: { className?: string }) {
  const t = useT();
  const market = marketOf(useMarket());
  const here = useHere();
  // With JavaScript, a tap anywhere else closes the list.
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { const el = box.current; if (el?.open && !el.contains(e.target as Node)) el.open = false; };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  return (
    <details ref={box} className={`country-switch${className ? ` ${className}` : ""}`}>
      <summary className="lang-toggle label" aria-label={t("Country: {country}. Change it", { country: t(market.name) })}>
        <span aria-hidden="true">{market.flag}</span><span className="country-name">{t(market.name)}</span><Icon name="chevron-down" size={14} />
      </summary>
      <form method="post" action="/prefs" className="country-menu">
        <input type="hidden" name="next" value={here} />
        <p className="caption muted">{t("Shop NosHen in")}</p>
        {COUNTRIES.map((c) => (
          <button key={c.code} type="submit" name="country" value={c.code} aria-pressed={c.code === market.code}>
            <span aria-hidden="true">{c.flag}</span>
            <span className="grow">{t(c.name)}</span>
            {c.live ? null : <span className="caption muted">{t("Coming soon")}</span>}
            {c.code === market.code ? <Icon name="check" size={16} /> : null}
          </button>
        ))}
      </form>
    </details>
  );
}

/**
 * The page for a NosHen country that isn't open yet: say so, take an email for the day it opens, and offer
 * Nigeria meanwhile (buying from there works from anywhere, paying with USDT or USDC).
 */
export function ComingSoon() {
  const t = useT();
  const market = marketOf(useMarket());
  const here = useHere();
  const [params] = useSearchParams();
  const joined = params.get("joined") === market.code;
  const error = params.get("waitlist_error");
  const name = t(market.name);
  return (
    <section className="card stack-4 coming-soon" aria-labelledby="soon-title">
      <div className="row-between"><span className="soon-flag" aria-hidden="true">{market.flag}</span><CountrySwitch /></div>
      <div className="stack">
        <h1 id="soon-title" className="heading">{t("NosHen {country} is coming soon", { country: name })}</h1>
        <p className="body muted">{t("We're starting in Nigeria. Leave your email and we'll tell you the day you can buy and sell with protection in {country}.", { country: name })}</p>
      </div>
      {joined ? (
        <Info icon="circle-check">{t("You're on the list. We'll email you when NosHen opens in {country}.", { country: name })}</Info>
      ) : (
        <form method="post" action="/waitlist" className="soon-form">
          <input type="hidden" name="country" value={market.code} />
          <input type="hidden" name="next" value={here.replace(/[?&](joined|waitlist_error)=[^&]*/g, "")} />
          <label className="sr-only" htmlFor="soon-email">{t("Email")}</label>
          <input id="soon-email" name="email" type="email" inputMode="email" autoComplete="email" required className="nh-input grow" placeholder={t("Your email")} />
          <Button type="submit" variant="primary">{t("Tell me")}</Button>
        </form>
      )}
      {error ? <p className="caption error-text" role="alert">{t(error)}</p> : null}
      <form method="post" action="/prefs" className="stack" style={{ gap: 6 }}>
        <input type="hidden" name="next" value="/browse" />
        <Button type="submit" name="country" value="NG" icon="arrow-right">{t("Meanwhile, shop Nigeria")}</Button>
        <p className="caption muted">{t("You can buy from Nigerian sellers from anywhere, and pay with USDT or USDC. Your money is held until you have the item.")}</p>
      </form>
    </section>
  );
}

/** Countries whose names read with "the" in a sentence: "visiting from the United States". */
const WITH_THE = new Set(["US", "GB", "AE", "NL", "PH", "BS", "GM", "DO", "CF"]);

/** For someone in a country NosHen isn't coming to yet (the USA, the UK…): what works for them. */
export function AbroadNote() {
  const t = useT();
  const from = useVisitorCountry();
  if (!from || isMarket(from)) return null;
  const name = countryName(from);
  return <Info icon="world">{t("Visiting from {country}? NosHen works in Nigeria for now. You can buy from Nigerian sellers and pay with USDT or USDC; someone in Nigeria collects the item or it's delivered there.", { country: WITH_THE.has(from) ? `the ${name}` : name })}</Info>;
}
