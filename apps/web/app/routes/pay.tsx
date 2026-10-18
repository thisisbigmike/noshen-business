import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/pay";
import { countryOf, requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { MoneyStatus, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { cleanCountry } from "@noshen/shared/payments";
import { PayOptions } from "../lib/pay-options";
import { cryptoQuotes } from "@noshen/engine/stablecoins";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Choose how to pay · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "accepted") throw redirect(`/d/${params.id}`);
    // The country comes from the buyer's device, through Cloudflare. ?from=GH previews another country's choices (for testing).
    const from = cleanCountry(new URL(request.url).searchParams.get("from"));
    return {
      dealId: v.deal.id, due: v.deal.amount_due_kobo, payBy: v.deal.payment_due_at, title: v.listing.title,
      seller: firstName(v.seller.name), country: from ?? countryOf(request), quotes: await cryptoQuotes(d, Number(v.deal.amount_due_kobo)),
    };
  });
}

export default function Pay({ loaderData: x }: Route.ComponentProps) {
  const t = useT();
  return (
    <div>
      <TopBar title={t("Choose how to pay")} back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Choose how to pay")}</h1>
        <nav className="desktop-only caption muted" aria-label={t("Breadcrumb")}><Link to="/deals">{t("Deals")}</Link> / <Link to={`/d/${x.dealId}`}>{x.title}</Link> / {t("Pay")}</nav>
        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" />{x.payBy ? <span className="caption muted">{t("Pay by {time}", { time: when(new Date(x.payBy)) })}</span> : null}</div>
          <p className="big-amount">{naira(x.due)}</p>
          <p className="body muted">{t("{item} · {name} accepted", { item: x.title, name: x.seller })}</p>
          <p className="body">{t("However you pay, NosHen holds the money until you have the item.")}</p>
        </section>
        <PayOptions dealId={x.dealId} country={x.country} quotes={x.quotes} />
      </main>
    </div>
  );
}
