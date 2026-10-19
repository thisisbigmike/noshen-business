import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/check";
import { withApp } from "../../server/web";
import { checkSeller } from "@noshen/engine/handles";
import { Button, Icon, Info, TopBar } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { firstName } from "@noshen/shared/deal";
import { platformOf, profileUrl } from "@noshen/shared/social";
import { SellerRecord } from "../lib/track-record";
import { CopyButton } from "../lib/copy-button";

export const meta: Route.MetaFunction = () => [
  { title: "Check a seller · NosHen" },
  { name: "description", content: "Found a seller on Instagram, TikTok, Facebook or X? Check them on NosHen before you pay." },
];

/** "Check a seller": a handle or profile link in, the verified NosHen seller behind it (if any) out. A plain GET. */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const result = q.trim() ? await withApp((d) => checkSeller(d.db, q)) : null;
  return { q, result, origin: url.origin };
}

export default function Check({ loaderData: { q, result, origin } }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state === "loading";
  const handle = result?.query ? `@${result.query.handle}` : "";
  const ask = t("Hi! I'd like to buy from you. Can you sell it to me through NosHen, so my payment is protected until I have it? It's free to list: {link}", { link: `${origin}/sell` });
  return (
    <div>
      <TopBar title={t("Check a seller")} back="/browse" />
      <main className="page narrow stack-4">
        <div className="stack">
          <h1 className="heading">{t("Check a seller before you pay")}</h1>
          <p className="body muted">{t("Found a seller on Instagram, TikTok, Facebook or X? Paste their name or profile link. If they're a verified NosHen seller, you'll see their real track record.")}</p>
        </div>
        <Form method="get" className="check-form" role="search">
          <label className="sr-only" htmlFor="check-q">{t("Their name or profile link")}</label>
          <input id="check-q" name="q" type="search" className="nh-input grow" defaultValue={q} placeholder="@ada.styles" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={200} enterKeyHint="search" />
          <Button type="submit" variant="primary" icon="search" disabled={busy}>{t("Check")}</Button>
        </Form>

        {q && !result?.query ? (
          <Info icon="alert-triangle" tone="warn">{t("That doesn't look like a name or a profile link. Try their name as it shows on their profile, like @ada.styles.")}</Info>
        ) : null}

        {result?.query && result.matches.length ? result.matches.map((m) => {
          const name = firstName(m.seller.name);
          return (
            <div key={`${m.platform}:${m.handle}`} className="stack-4">
              <Info icon="circle-check">{t.rich("<b>@{handle} on {platform} is a verified NosHen seller:</b> {name}. We saw our code in that profile's bio.", { b: (s) => <strong>{s}</strong> }, { handle: m.handle, platform: t(platformOf(m.platform).label), name })}</Info>
              <SellerRecord person={m.seller} />
              <section className="card stack">
                <p className="title">{t("Before you pay")}</p>
                <ul className="check-steps">
                  <li><Icon name="eye" size={18} /><span>{t.rich("Check the name letter for letter: scammers copy names with one letter changed. <profile>Open the real profile</profile>.", { profile: (s) => <a href={profileUrl(m.platform, m.handle)} target="_blank" rel="noreferrer">{s}</a> })}</span></li>
                  <li><Icon name="link" size={18} /><span>{t("Ask {name} for a NosHen checkout link, or buy from their shop on NosHen.", { name })}</span></li>
                  <li><Icon name="lock" size={18} /><span>{t("Never send money to their bank account directly. Only money paid through NosHen is held until you have the item.")}</span></li>
                </ul>
              </section>
            </div>
          );
        }) : null}

        {result?.query && !result.matches.length ? (
          <section className="card stack-4" aria-labelledby="no-match">
            <div className="stack" style={{ gap: 6 }}>
              <p className="title row" id="no-match" style={{ gap: 8 }}><Icon name="alert-triangle" size={20} />{t("No verified NosHen seller is {handle}", { handle })}</p>
              <p className="body">{t("That doesn't make them a scammer: many sellers aren't on NosHen yet. But if you pay them directly, nobody can get your money back if something goes wrong.")}</p>
            </div>
            <div className="stack">
              <p className="label">{t("Ask them to sell to you through NosHen")}</p>
              <p className="caption muted">{t("Your money is held until you have the item. Send them this:")}</p>
              <blockquote className="check-message">{ask}</blockquote>
              <div className="row wrap" style={{ gap: 8 }}>
                <a className="nh-btn nh-btn-primary nh-btn-md" style={{ textDecoration: "none" }} href={`https://wa.me/?text=${encodeURIComponent(ask)}`} target="_blank" rel="noreferrer">
                  <Icon name="brand-whatsapp" size={18} />{t("Send on WhatsApp")}
                </a>
                <CopyButton text={ask} label={t("Copy message")} />
              </div>
            </div>
          </section>
        ) : null}

        <p className="caption muted">{t("How we verify: a seller adds their handle on NosHen, and puts a code we give them in that profile's bio. We check the profile ourselves before it shows here.")}{" "}
          <Link to="/account">{t("Sell on Instagram? Add your handle.")}</Link></p>
      </main>
    </div>
  );
}
