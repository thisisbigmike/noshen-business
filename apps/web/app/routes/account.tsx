import { Form, Link } from "react-router";
import type { Route } from "./+types/account";
import { requireUser, withApp, messageOf } from "../../server/web";
import { myListings, sellerSummary } from "@noshen/engine/queries";
import { sellerReady, setListingStatus, setVisibility } from "@noshen/engine/sellers";
import { offersDelivery } from "@noshen/shared/delivery";
import { isService } from "@noshen/shared/categories";
import { one } from "@noshen/engine/db";
import { Button, ErrorText, Icon, Info, Kv, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { LEGAL_NAV } from "@noshen/shared/legal-pages";
import { ThemeSwitch } from "@noshen/ui/theme";
import { PushCard } from "../lib/push";
import { useLang, useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { DataSaverSwitch, LanguageSwitch } from "../lib/prefs";
import { CountrySwitch } from "../lib/country";
import { CopyButton } from "../lib/copy-button";
import { HandlesCard, type Handle } from "../lib/handles";
import { addHandle, myHandles, removeHandle, submitHandle } from "@noshen/engine/handles";

export const meta = () => [{ title: "Account · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const [ready, summary, listings, bank, kyc, handles] = await Promise.all([
      sellerReady(d, user.id), sellerSummary(d.db, user.id), myListings(d.db, user.id),
      one(d.db, "select account_name, account_last4 from bank_accounts where user_id = $1 and is_default and removed_at is null", [user.id]),
      one(d.db, "select type, verified_name from kyc_checks where user_id = $1 and result = 'verified' order by checked_at desc limit 1", [user.id]),
      myHandles(d.db, user.id),
    ]);
    return { user, ready, summary, listings, bank, kyc, handles: handles as Handle[], shop: `${new URL(request.url).origin}/s/${user.id}` };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      // Social handles, for "Check a seller".
      if (intent === "handle_add") return void await addHandle(d, user.id, String(f.get("platform") ?? ""), String(f.get("handle") ?? ""));
      if (intent === "handle_submit") return submitHandle(d, user.id, String(f.get("handle")));
      if (intent === "handle_remove") return removeHandle(d, user.id, String(f.get("handle")));
      const visibility = f.get("visibility");
      if (visibility === "public" || visibility === "link") await setVisibility(d, user.id, String(f.get("listing")), visibility);
      else await setListingStatus(d, user.id, String(f.get("listing")), String(f.get("status")) as "paused" | "live" | "removed");
    });
    return { ok: true, intent };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
}

const STATUS_WORD: Record<string, string> = { live: msg("Live"), paused: msg("Paused"), sold: msg("Sold"), draft: msg("Draft"), blocked: msg("Being checked") };

export default function Account({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const lang = useLang();
  return (
    <div>
      <TopBar title={t("Account")} />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">{t("Account")}</h1>
        <section className="card">
          <Kv k={t("Name")} v={x.user.full_name ?? t("Not added")} />
          <Kv k={t("Email")} v={x.user.email ?? t("Not added")} />
          <Kv k={t("Rating")} v={x.summary.rating ? t("{rating} from {n}", { rating: x.summary.rating, n: x.summary.ratingCount }) : t("No ratings yet")} />
          <Kv k={t("Completed sales")} v={String(x.summary.completedDeals)} />
        </section>
        <section className="card stack">
          <p className="title">{t("Selling")}</p>
          <Kv k={t("ID check")} v={x.kyc ? t("Verified ({type})", { type: x.kyc.type.toUpperCase() }) : t("Not done")} />
          <Kv k={t("Payout bank")} v={x.bank ? `${x.bank.account_name} ••${x.bank.account_last4}` : t("Not added")} />
          {!x.ready.ready ? <Button variant="primary" to="/account/verify?next=/account" icon="shield-check">{t("Verify ID and bank")}</Button>
            : <Info icon="circle-check">{t("You can sell. Buyers see “ID verified” on your listings.")}</Info>}
        </section>
        {x.listings.length ? (
          <section className="card stack">
            <div className="row-between"><p className="title">{t("My listings")}</p><Link to="/sell">{t("New listing")}</Link></div>
            {x.listings.map((l: any) => (
              <div key={l.id} className="kv" style={{ alignItems: "center" }}>
                <span className="stack" style={{ gap: 0 }}>
                  <Link to={l.status === "draft" ? (l.title === "Untitled listing" ? `/sell/${l.id}/photos` : `/sell/${l.id}/review`) : `/l/${l.id}`} className="body">{l.title === "Untitled listing" ? t("Draft listing") : l.title}</Link>
                  <span className="caption muted">{t(STATUS_WORD[l.status] ?? l.status)} · {naira(l.price_kobo)}{Number(l.requests) ? ` · ${Number(l.requests) === 1 ? t("1 request") : t("{n} requests", { n: l.requests })}` : ""}</span>
                  {(l.status === "live" || l.status === "paused") && !isService(l.category) ? <Link to={`/sell/${l.id}/delivery`} className="caption">{offersDelivery(l) ? t("Delivery prices") : t("Add delivery prices")}</Link> : null}
                  {l.visibility === "link" ? <span className="caption muted row" style={{ gap: 4 }}><Icon name="link" size={14} />{t("Checkout link only")}</span> : null}
                </span>
                {l.status === "live" || l.status === "paused" ? (
                  <span className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                    <Form method="post">
                      <input type="hidden" name="listing" value={l.id} />
                      <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                      <Button type="submit">{l.status === "live" ? t("Pause") : t("Make live")}</Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="listing" value={l.id} />
                      <input type="hidden" name="visibility" value={l.visibility === "link" ? "public" : "link"} />
                      <button type="submit" className="caption tap link-btn">{l.visibility === "link" ? t("Show on NosHen") : t("Link only")}</button>
                    </Form>
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        <ErrorText>{(actionData as any)?.intent?.startsWith("handle_") ? null : (actionData as any)?.error}</ErrorText>
        {x.listings.length ? (
          <section className="card stack" aria-labelledby="shop-link">
            <p className="title" id="shop-link">{t("Your shop link")}</p>
            <p className="caption muted">{t("Put it in your Instagram bio or WhatsApp status: one link to everything you sell on NosHen, with your track record.")}</p>
            <div className="row wrap" style={{ gap: 8 }}><code className="caption">{x.shop}</code><CopyButton text={x.shop} label={t("Copy link")} /></div>
            <Link to={new URL(x.shop).pathname} className="caption">{t("See your shop")}</Link>
          </section>
        ) : null}
        {x.listings.length || x.handles.length ? (
          <HandlesCard handles={x.handles} idOk={x.ready.idOk} error={(actionData as any)?.intent?.startsWith("handle_") ? (actionData as any)?.error : null} />
        ) : null}
        <PushCard />
        <section className="card stack" aria-labelledby="language">
          <p className="title" id="language">{t("Language")}</p>
          <p className="caption muted">{t("NosHen in English or Pidgin. Your choice is saved on this device.")}</p>
          <LanguageSwitch />
        </section>
        <section className="card stack" aria-labelledby="country">
          <p className="title" id="country">{t("Country")}</p>
          <p className="caption muted">{t("NosHen shows the country you're in first. Nigeria is open; Ghana, Kenya and South Africa are coming.")}</p>
          <div className="row"><CountrySwitch /></div>
        </section>
        <section className="card stack" aria-labelledby="data-saver">
          <p className="title" id="data-saver">{t("Data saver")}</p>
          <p className="caption muted">{t("For small data plans: smaller photos (tap one to see it full size), no extra fonts, and fewer background updates. It turns on by itself if your browser is saving data.")}</p>
          <DataSaverSwitch />
        </section>
        <section className="card stack" aria-labelledby="appearance">
          <p className="title" id="appearance">{t("Appearance")}</p>
          <p className="caption muted">{t("Light is the default. Your choice is saved on this device.")}</p>
          <ThemeSwitch />
        </section>
        <section className="card link-list" aria-label={t("Help and legal")}>
          <p className="label muted">{t("Help and legal")}</p>
          {lang !== "en" ? <p className="caption muted">{t("These pages are in English.")}</p> : null}
          {LEGAL_NAV.map((p) => <Link key={p.slug} to={`/${p.slug}`} className="row-between">{t(p.title)}<Icon name="chevron-right" size={18} /></Link>)}
        </section>
        <Form method="post" action="/signout"><Button type="submit" icon="logout">{t("Sign out")}</Button></Form>
      </main>
    </div>
  );
}
