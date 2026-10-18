import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/landing";
import { optionalUser, withApp } from "../../server/web";
import { settingsOf } from "@noshen/engine/core";
import { many } from "@noshen/engine/db";
import { Avatar, Button, DealCard, Icon, ReleaseCode, Wordmark } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { dealAmounts, feeFor, naira, type FeeRule } from "@noshen/shared/money";
import { photoUrl } from "@noshen/shared/photos";
import { CATEGORIES, checksFor } from "@noshen/shared/categories";
import "../styles/landing.css";
import { ThemeToggle } from "@noshen/ui/theme";
import { comingSoonList, placeLabel } from "@noshen/shared/locations";
import { useT, type T } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { LanguageToggle } from "../lib/prefs";

export const handle = { tabs: false };

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = "NosHen: buy and sell anything in Nigeria, protected";
  const desc = "Your money is held by a licensed partner bank until you have the item. The seller is paid when you give them your release code.";
  return [
    { title },
    { name: "description", content: desc },
    { property: "og:title", content: "NosHen: your money is held until you have the item" },
    { property: "og:description", content: desc },
    { property: "og:type", content: "website" },
    ...(loaderData ? [{ property: "og:url", content: loaderData.origin }] : []),
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const s = await settingsOf(d);
    const recent = await many<{ id: string; title: string; area: string; state: string | null; price_kobo: string; photo_keys: string[] | null }>(d.db,
      "select id, title, area, state, price_kobo, photo_keys from listings where status = 'live' order by published_at desc limit 12");
    const byCat = await many<{ category: string; n: string }>(d.db, "select category, count(*) as n from listings where status = 'live' group by category");
    const counts = Object.fromEntries(byCat.map((r) => [r.category, Number(r.n)]));
    const live = byCat.reduce((t, r) => t + Number(r.n), 0);
    const user = await optionalUser(request, d);
    return { fee: s.fee, min: s.deal_min_kobo, max: s.deal_max_kobo, live, counts, recent, signedIn: !!user, origin: new URL(request.url).origin };
  });
}

const PROBLEMS: [IconName, string, string][] = [
  ["alert-triangle", msg("Pay first"), msg("The seller disappears, or sends something fake or different.")],
  ["cash", msg("Hand over first"), msg("The “payment” turns out to be a fake transfer alert.")],
  ["map-pin", msg("Meet with cash"), msg("You carry the full price in cash across town to meet a stranger.")],
];

const STEPS: [IconName, string, string][] = [
  ["building-bank", msg("You pay NosHen"), msg("Transfer to a deal account at our licensed partner bank, only after the seller accepts.")],
  ["lock", msg("The money is held"), msg("The seller can see it's there, but can't touch it.")],
  ["eye", msg("You check the item"), msg("Meet in a public place, or get it delivered. Make sure it's what you paid for.")],
  ["circle-check", msg("The seller is paid"), msg("Give the seller your 6-digit release code, or confirm the delivery. The payout starts within minutes.")],
];

const faq = (t: T, min: number, max: number | null): [string, string][] => [
  [t("Is NosHen a bank?"), t("No. A licensed partner bank holds the money. NosHen runs the deal steps and tells the bank where the money goes, and keeps a record of every naira.")],
  [t("What can I buy and sell?"), max
    ? t("Almost anything you can hand over in Nigeria: phones, laptops, electronics, clothes, shoes, hair and wigs, beauty products, watches and jewellery, baby things, sports gear, furniture, cars and more, from {min} to {max}. Not allowed: anything illegal, stolen or fake, weapons, drugs, or live animals.", { min: naira(min), max: naira(max) })
    : t("Almost anything you can hand over in Nigeria: phones, laptops, electronics, clothes, shoes, hair and wigs, beauty products, watches and jewellery, baby things, sports gear, furniture, cars and more, from {min} upwards, with no top price. Not allowed: anything illegal, stolen or fake, weapons, drugs, or live animals.", { min: naira(min) })],
  [t("Where does NosHen work?"), t("Everywhere in Nigeria: all 36 states and Abuja. Meet in a public place when you're in the same town, or choose delivery and the money stays held until the item arrives. {countries} are coming soon.", { countries: comingSoonList() })],
  [t("What if the seller never shows up?"), t("If the hand-over hasn't happened within 72 hours of your payment, cancel the deal and get everything back, fee included.")],
  [t("What if it's fake, faulty or not as described?"), t("Don't give your code. Report a problem in the app and the money stays frozen. You both add photos or notes, and a NosHen reviewer decides within 72 hours and tells you both why.")],
  [t("Can I pay the seller directly to save the fee?"), t("You can, but that money isn't protected. If something goes wrong, NosHen can't get it back for you.")],
  [t("How do sellers get paid?"), t("To a bank account in their own name, checked against their NIN or BVN. The payout starts within minutes of the release code.")],
  [t("Can I use NosHen in Pidgin, or on a small data plan?"), t("Yes. Tap Pidgin at the top of the page to read NosHen in Pidgin. Turn on Data saver in your account (or in your browser) and pages use small photos and no extra fonts.")],
];

export default function Landing({ loaderData: x }: Route.ComponentProps) {
  const t = useT();
  const b = (s: string) => <strong>{s}</strong>;
  return (
    <div className="landing">
      <header className="pill-bar landing-top mobile-only">
        <Link to="/" aria-label={t("NosHen home")} style={{ textDecoration: "none" }}><Wordmark size="sm" /></Link>
        <nav className="row">
          <LanguageToggle />
          <ThemeToggle />
          <Link to="/browse" className="label tap hide-narrow">{t("Browse")}</Link>
          <Button variant="primary" pill to={x.signedIn ? "/deals" : "/signin"}>{x.signedIn ? t("Deals") : t("Sign in")}</Button>
        </nav>
      </header>

      <main id="main" className="landing-main">
      <Hero live={x.live} />
      <LiveStrip items={x.recent} />
      <CategoryRail counts={x.counts} />

      <section className="lp-band" aria-labelledby="problem-title">
        <div className="lp-inner">
          <div className="lp-head reveal">
            <p className="lp-eyebrow">{t("The problem")}</p>
            <h2 id="problem-title" className="lp-h2">{t("Nobody wants to go first")}</h2>
            <p className="lp-lede">{t("Online deals between strangers in Nigeria fall apart at the payment. Someone has to take the risk.")}</p>
          </div>
          <div className="bento">
            {PROBLEMS.map(([icon, title, body], i) => (
              <div key={title} className="bento-card reveal" data-n={`0${i + 1}`}>
                <span className="lp-icon warn"><Icon name={icon} /></span>
                <p className="title">{t(title)}</p>
                <p className="body muted">{t(body)}</p>
              </div>
            ))}
            <div className="bento-card bento-answer reveal">
              <span className="lp-icon"><Icon name="shield-check" /></span>
              <p className="lp-h3">{t("NosHen takes the risk out of the first step.")}</p>
              <p className="body">{t("The money waits in the middle, at a licensed partner bank, until the buyer has the item.")}</p>
            </div>
          </div>
        </div>
      </section>

      <FollowTheMoney />

      <section className="lp-band" aria-labelledby="code-title">
        <div className="lp-inner lp-split">
          <div className="stack-4 reveal">
            <p className="lp-eyebrow">{t("At the meet-up")}</p>
            <h2 id="code-title" className="lp-h2">{t("Your code moves the money")}</h2>
            <p className="lp-lede">{t("Your 6-digit release code is only in your NosHen app, never in an SMS or email. Before you show it, the app walks you through three checks for what you're buying:")}</p>
            <CheckTabs />
            <p className="body muted">{t("Happy? Read out your code and the seller types it in. Not happy? Keep your code and report a problem. The money stays held.")}</p>
          </div>
          <div className="code-stage reveal">
            <ReleaseCode code="519358" help={t("Give this code to the seller only after you have checked the item. It releases your money.")} />
            <div className="float-card code-tip">
              <span className="lp-icon sm"><Icon name="shield-lock" size={18} /></span>
              <div><p className="label">{t("NosHen never asks for it")}</p><p className="caption muted">{t("Not by call, chat or SMS.")}</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-band lp-tint" aria-labelledby="who-title">
        <div className="lp-inner">
          <div className="lp-head reveal">
            <p className="lp-eyebrow">{t("For both sides")}</p>
            <h2 id="who-title" className="lp-h2">{t("Safer whether you're buying or selling")}</h2>
          </div>
          <div className="lp-split">
            <article className="side-card reveal">
              <div className="side-top"><span className="lp-icon"><Icon name="shield-check" /></span><h3 className="title">{t("For buyers")}</h3></div>
              <p className="lp-h3">{t("No more paying first and hoping.")}</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />{t("Your money is held until you have the item.")}</li>
                <li><Icon name="check" size={18} />{t("Something wrong? Report it before you give your code, and the money stays frozen.")}</li>
                <li><Icon name="check" size={18} />{t("No cash to carry to a meet-up.")}</li>
                <li><Icon name="check" size={18} />{t("Sellers are ID-checked before they can be paid.")}</li>
              </ul>
              <Button variant="primary" pill to="/browse" iconRight="arrow-right">{t("Browse listings")}</Button>
            </article>
            <article className="side-card reveal">
              <div className="side-top"><span className="lp-icon"><Icon name="building-bank" /></span><h3 className="title">{t("For sellers")}</h3></div>
              <p className="lp-h3">{t("Know the money is real before you hand over.")}</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />{t("NosHen shows you the money is held. No more fake alerts.")}</li>
                <li><Icon name="check" size={18} />{t("Paid to your bank account within minutes of the code.")}</li>
                <li><Icon name="check" size={18} />{t("One link for WhatsApp, Facebook and Instagram.")}</li>
              </ul>
              <div className="share-preview" aria-label={t("Example of a shared link")}>
                <span className="share-thumb"><Icon name="device-mobile" size={22} /></span>
                <div className="grow"><p className="label">Nike Air Force 1, size 43 · ₦45,000</p><p className="caption muted">{t("Lekki, Lagos. Protected by NosHen.")}</p></div>
                <Icon name="brand-whatsapp" size={20} className="wa-ico" />
              </div>
              <Button variant="primary" pill to="/sell" iconRight="arrow-right">{t("Start selling")}</Button>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-band" aria-labelledby="fee-title">
        <div className="lp-inner lp-split">
          <div className="stack-4 reveal">
            <p className="lp-eyebrow">{t("If something goes wrong")}</p>
            <h2 className="lp-h2">{t("A person decides, and tells you why")}</h2>
            <ol className="lp-steps">
              <li>{t.rich("<b>Report a problem</b> in the app before you give your code or confirm delivery. The money freezes at once.", { b })}</li>
              <li>{t.rich("<b>Both of you add photos or notes</b> within 24 hours.", { b })}</li>
              <li>{t.rich("<b>A NosHen reviewer decides</b> within 72 hours: refund the buyer in full, or release the money to the seller. You both get the reason.", { b })}</li>
            </ol>
            <p className="body muted">{t("If the seller doesn't hand over within 72 hours of your payment, you can cancel and get everything back, fee included.")}</p>
          </div>
          <FeeCalculator fee={x.fee} min={x.min} max={x.max ?? CALCULATOR_TOP_KOBO} id="fee-title" />
        </div>
      </section>

      <section className="lp-band" aria-labelledby="faq-title">
        <div className="lp-inner faq-grid">
          <div className="stack-4 reveal">
            <p className="lp-eyebrow">{t("Questions")}</p>
            <h2 id="faq-title" className="lp-h2">{t("What people ask first")}</h2>
            <p className="body muted">{t("Still unsure? Start with a small deal and watch every step for yourself.")}</p>
          </div>
          <div className="faq stack">
            {faq(t, x.min, x.max).map(([q, a]) => (
              <details key={q} className="faq-item reveal">
                <summary className="title">{q}<span className="faq-plus" aria-hidden="true"><Icon name="plus" size={18} /></span></summary>
                <p className="body muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final" aria-labelledby="final-title">
        <div className="final-glow" aria-hidden="true" />
        <div className="lp-inner final-inner reveal">
          <Seal className="final-seal" />
          <h2 id="final-title" className="final-title">{t("Your next deal, protected.")}</h2>
          <p className="final-sub">{t("You pay nothing until the seller accepts. Fee: {percent}%, from {min} to {max}.", { percent: x.fee.percent, min: naira(x.fee.min_kobo), max: naira(x.fee.max_kobo) })}</p>
          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <Button variant="primary" size="lg" pill to="/browse" iconRight="arrow-right">{t("See what's for sale")}</Button>
            <Link to="/sell" className="nh-btn nh-btn-lg nh-btn-pill ghost-light">{t("Sell with protection")}</Link>
          </div>
        </div>
      </section>

      </main>

      <footer className="landing-footer">
        <div className="lp-inner footer-grid">
          <div className="stack footer-brand"><Wordmark size="sm" /><p className="caption muted">{t("Your money is held until you have the item. Across Nigeria. {countries} coming soon.", { countries: comingSoonList() })}</p><LanguageToggle /></div>
          <nav className="stack" aria-label={t("Use NosHen")}>
            <p className="label">{t("Use NosHen")}</p>
            <Link to="/browse" className="caption">{t("Browse")}</Link>
            <Link to="/sell" className="caption">{t("Sell")}</Link>
            <Link to={x.signedIn ? "/account" : "/signin"} className="caption">{x.signedIn ? t("Account") : t("Sign in")}</Link>
          </nav>
          <nav className="stack" aria-label={t("Help")}>
            <p className="label">{t("Help")}</p>
            <a href="#how-title" className="caption">{t("How it works")}</a>
            <a href="#faq-title" className="caption">{t("Questions")}</a>
            <Link to="/safety" className="caption">{t("Safety tips")}</Link>
            <Link to="/prohibited-items" className="caption">{t("Prohibited items")}</Link>
          </nav>
          <nav className="stack" aria-label={t("Legal")}>
            <p className="label">{t("Legal")}</p>
            <Link to="/terms" className="caption">{t("Terms of Use")}</Link>
            <Link to="/deal-terms" className="caption">{t("Protected Deal Terms")}</Link>
            <Link to="/privacy" className="caption">{t("Privacy Policy")}</Link>
            <Link to="/cookies" className="caption">{t("Cookie Policy")}</Link>
          </nav>
          <div className="footer-bottom">
            <p className="caption muted">{t("© {year} NosHen. Money is held by a licensed partner bank; NosHen is not a bank.", { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Hero({ live }: { live: number }) {
  const t = useT();
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-inner hero-layout">
        <div className="hero-copy">
          <p className="live-pill"><span className="live-dot" aria-hidden="true" />{live ? t("{n} items for sale across Nigeria now", { n: live }) : t("Buy and sell anything in Nigeria")}</p>
          <h1 id="hero-title" className="hero-title">{t.rich("Your money is <mark>held</mark> until you have the item.", {
            mark: (s) => <span className="mark">{s}<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 14 C 50 4, 120 4, 197 10" /></svg></span>,
          })}</h1>
          <p className="hero-sub">{t("The safe way to buy and sell anything in Nigeria, from phones, hair and shoes to sofas and cars. You pay NosHen, a licensed partner bank holds the money, and the seller is paid only when you've checked the item.")}</p>
          <div className="hero-ctas">
            <Button variant="primary" size="lg" pill icon="search" to="/browse">{t("See what's for sale")}</Button>
            <Button size="lg" pill icon="plus" to="/sell">{t("Sell with protection")}</Button>
          </div>
          <ul className="hero-facts">
            <li><Icon name="building-bank" size={18} />{t("Licensed partner bank")}</li>
            <li><Icon name="id" size={18} />{t("Sellers ID-checked")}</li>
            <li><Icon name="scale" size={18} />{t("Problems decided in 72 hours")}</li>
          </ul>
        </div>

        <div className="hero-stage" aria-label={t("Example: a deal with the money held")}>
          <div className="stage-blob" aria-hidden="true" />
          <div className="phone">
            <div className="phone-island" aria-hidden="true" />
            <div className="phone-screen">
              <div className="row-between"><p className="label muted">{t("Deal with {name}", { name: "Tunde" })}</p><span className="caption muted">{t("Meet-up")}</span></div>
              <DealCard state="held" word={t("Held")} amountKobo={45_675_000} item="iPhone 13, 128GB" counterpart="Tunde"
                deadline={t("Meet by {time}", { time: "Fri 6pm" })} nextStep={t("Meet in a public place. Check the phone, then give Tunde your code.")} />
              <ReleaseCode code="482913" defaultRevealed help={t("Tunde types this in at the hand-over.")} />
            </div>
          </div>
          <div className="float-card fc-held" aria-hidden="true">
            <span className="lp-icon sm held"><Icon name="lock" size={18} /></span>
            <div><p className="label">{t("{amount} is held", { amount: "₦456,750" })}</p><p className="caption muted">{t("Tunde can see it. He can't touch it.")}</p></div>
          </div>
          <div className="float-card fc-seller" aria-hidden="true">
            <Avatar name="Tunde" />
            <div><p className="label">Tunde B.</p><p className="caption verified"><Icon name="circle-check" size={14} />{t("ID verified seller")}</p></div>
          </div>
          <div className="float-card fc-paid" aria-hidden="true">
            <span className="lp-icon sm ok"><Icon name="arrow-up-right" size={18} /></span>
            <div><p className="label">{t("Code given, payout started")}</p><p className="caption muted">{t("{amount} to Tunde's bank", { amount: "₦450,000" })}</p></div>
          </div>
          <Seal className="hero-seal" />
        </div>
      </div>
    </section>
  );
}

/** A slowly turning round seal: "Protected by NosHen", around the shield. */
function Seal({ className }: { className?: string }) {
  const t = useT();
  const id = useId();
  return (
    <div className={`seal ${className ?? ""}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="seal-ring">
        <defs><path id={id} d="M60 60 m-46 0 a46 46 0 1 1 92 0 a46 46 0 1 1 -92 0" /></defs>
        <text><textPath href={`#${id}`} textLength="286" lengthAdjust="spacing">{t("PROTECTED BY NOSHEN • YOUR MONEY HELD •")}</textPath></text>
      </svg>
      <span className="seal-core"><Icon name="shield-check" size={26} /></span>
    </div>
  );
}

function LiveStrip({ items }: { items: { id: string; title: string; area: string; state: string | null; price_kobo: string; photo_keys: string[] | null }[] }) {
  const t = useT();
  if (items.length === 0) return null;
  const row = items.length < 6 ? [...items, ...items] : items;
  return (
    <section className="live-strip" aria-labelledby="live-title">
      <div className="lp-inner row-between">
        <h2 id="live-title" className="label"><span className="live-dot" aria-hidden="true" />{t("For sale on NosHen now")}</h2>
        <Link to="/browse" className="label row tap">{t("See all")}<Icon name="arrow-right" size={16} /></Link>
      </div>
      <div className="marquee">
        <ul className="marquee-track">
          {[0, 1].map((copy) => row.map((l, i) => (
            <li key={`${copy}-${l.id}-${i}`} aria-hidden={copy === 1 ? true : undefined}>
              <Link to={`/l/${l.id}`} className="mq-card" tabIndex={copy === 1 ? -1 : undefined}>
                {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" loading="lazy" decoding="async" /> : <span className="mq-ph"><Icon name="camera" /></span>}
                <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span className="label mq-title">{l.title}</span>
                  <span className="caption muted">{placeLabel(l.area, l.state)} · <span className="tabular ink">{naira(l.price_kobo)}</span></span>
                </span>
              </Link>
            </li>
          )))}
        </ul>
      </div>
    </section>
  );
}

function FollowTheMoney() {
  const t = useT();
  return (
    <section className="lp-dark" aria-labelledby="how-title">
      <div className="lp-inner stack-6">
        <div className="lp-head reveal">
          <p className="lp-eyebrow on-dark">{t("How it works")}</p>
          <h2 id="how-title" className="lp-h2">{t("Follow the money")}</h2>
          <p className="lp-lede on-dark">{t("Four steps, the same for every deal. The money only moves forward when you say so.")}</p>
        </div>
        <div className="money-track reveal" aria-hidden="true">
          <div className="mt-line"><span className="mt-fill" /></div>
          <div className="mt-node" style={{ left: "0%" }}><span className="mt-dot"><Icon name="user" size={20} /></span><span className="mt-name">{t("You")}</span></div>
          <div className="mt-node mt-bank" style={{ left: "50%" }}><span className="mt-dot"><Icon name="lock" size={20} /></span><span className="mt-name">{t("Held at the partner bank")}</span></div>
          <div className="mt-node" style={{ left: "100%" }}><span className="mt-dot"><Icon name="building-bank" size={20} /></span><span className="mt-name">{t("Seller")}</span></div>
          <span className="mt-coin">₦</span>
        </div>
        <ol className="dark-steps">
          {STEPS.map(([icon, title, body], i) => (
            <li key={title} className={`dark-step s${i + 1} reveal`}>
              <div className="row-between"><span className="dark-n">{i + 1}</span><Icon name={icon} /></div>
              <p className="title">{t(title)}</p>
              <p className="body">{t(body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Counts smoothly from the last value to the new one. Shows the final value at once when motion is reduced. */
function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = target; setV(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const now = p < 1 ? Math.round((start + (target - start) * e) / 100) * 100 : target;
      from.current = now;
      setV(now);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** The fee calculator's slider needs an end even when NosHen has no top price: ₦50,000,000 covers cars. */
const CALCULATOR_TOP_KOBO = 5_000_000_000;

function FeeCalculator({ fee: rule, min, max, id }: { fee: FeeRule; min: number; max: number; id: string }) {
  const t = useT();
  // The slider moves on a log scale, so ₦5,000 shoes and a ₦20m car both get room. Prices snap to round numbers.
  const lo = Math.log(min / 100), hi = Math.log(max / 100);
  const toPrice = (t: number) => { const v = Math.exp(lo + (hi - lo) * (t / 1000)); const step = v < 100_000 ? 1_000 : v < 1_000_000 ? 5_000 : v < 5_000_000 ? 50_000 : 100_000; return Math.min(max / 100, Math.max(min / 100, Math.round(v / step) * step)); };
  const toT = (p: number) => Math.round(((Math.log(p) - lo) / (hi - lo)) * 1000);
  const [price, setPrice] = useState(450_000);
  const [sellerPays, setSellerPays] = useState(false);
  const priceKobo = price * 100;
  const fee = feeFor(priceKobo, rule);
  const { dueKobo, sellerShareKobo } = dealAmounts(priceKobo, fee, sellerPays ? "seller" : "buyer");
  const shownFee = useTween(fee);
  const shownDue = useTween(dueKobo);
  const shownShare = useTween(sellerShareKobo);
  const pct = toT(price) / 10;
  return (
    <div className="fee-calc reveal">
      <h2 id={id} className="lp-h3">{t("What it costs")}</h2>
      <p className="body muted">{t("{percent}% of the price, at least {min} and at most {max}. Listing and browsing are free.", { percent: rule.percent, min: naira(rule.min_kobo), max: naira(rule.max_kobo) })}</p>
      <label className="fee-price" htmlFor="fee-range">
        <span className="caption muted">{t("Price of the item")}</span>
        <span className="fee-big tabular">{naira(priceKobo)}</span>
      </label>
      <input id="fee-range" type="range" min={0} max={1000} step={1} value={toT(price)} onChange={(e) => setPrice(toPrice(Number(e.target.value)))}
        className="range" style={{ ["--pct" as string]: `${pct}%` }} aria-valuetext={naira(priceKobo)} />
      <div className="seg" role="radiogroup" aria-label={t("Who pays the fee")}>
        <button type="button" role="radio" aria-checked={!sellerPays} onClick={() => setSellerPays(false)}>{t("Buyer pays the fee")}</button>
        <button type="button" role="radio" aria-checked={sellerPays} onClick={() => setSellerPays(true)}>{t("Seller offers to pay")}</button>
      </div>
      <div>
        <div className="kv"><span className="muted">{t("NosHen fee")}</span><span className="tabular">{naira(shownFee)}</span></div>
        <div className="kv"><span className="muted">{t("The buyer pays")}</span><span className="tabular">{naira(shownDue)}</span></div>
        <div className="kv total"><span>{t("The seller gets")}</span><span className="tabular">{naira(shownShare)}</span></div>
      </div>
      <p className="caption muted">{t("You pay nothing until the seller accepts.")}</p>
    </div>
  );
}

/** Tiles that open Browse on one category, with how many are live in each. */
function CategoryRail({ counts }: { counts: Record<string, number> }) {
  const t = useT();
  return (
    <section className="cat-rail-wrap" aria-labelledby="cats-title">
      <div className="lp-inner">
        <h2 id="cats-title" className="label cats-title">{t("Shop by category")}</h2>
        <ul className="cat-rail">
          {CATEGORIES.map((c) => (
            <li key={c.key}>
              <Link to={`/browse?cat=${c.key}`} className="cat-tile">
                <span className="cat-tile-icon"><Icon name={c.icon} size={24} /></span>
                <span className="label">{t(c.label)}</span>
                <span className="caption muted">{counts[c.key] ? t("{n} for sale", { n: counts[c.key] }) : t("Be the first")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const CHECK_TABS: [string, string, IconName][] = [["phone", msg("Phones"), "device-mobile"], ["fashion", msg("Clothes"), "shirt"], ["vehicle", msg("Cars"), "car"], ["home", msg("Home"), "sofa"]];

/** The release-code checklist changes with what you're buying. */
function CheckTabs() {
  const t = useT();
  const [tab, setTab] = useState(CHECK_TABS[0][0]);
  const items = checksFor(tab, t("the seller"), null, t);
  return (
    <div className="check-tabs">
      <div className="seg seg-4" role="tablist" aria-label={t("What you're buying")}>
        {CHECK_TABS.map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" id={`ct-${k}`} aria-selected={tab === k} aria-controls="ct-panel" onClick={() => setTab(k)}><Icon name={icon} size={16} /><span>{t(label)}</span></button>
        ))}
      </div>
      <div id="ct-panel" role="tabpanel" aria-labelledby={`ct-${tab}`}>
        <ul className="lp-checks" key={tab}>
          {items.map(([label, hint]) => (
            <li key={label}><span><Icon name="check" size={16} /></span><div><p className="body ink">{label}.</p><p className="caption muted">{hint}</p></div></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
