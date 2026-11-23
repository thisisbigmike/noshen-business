import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/deals";
import { requireUser, withApp } from "../../server/web";
import { dealsFor, needsAction } from "@noshen/engine/queries";
import { Button, DealCard, Icon, Kv, TopBar } from "@noshen/ui/ui";
import { dealText } from "../lib/deal-text";
import { useT } from "@noshen/ui/i18n";
import { photoUrl } from "@noshen/shared/photos";

export const meta = () => [{ title: "Deals · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const deals = await dealsFor(d.db, user.id);
    return { me: user.full_name ?? "", deals: deals.map((x) => ({ ...x, action: needsAction(x) })), walletLive: !!d.wallets };
  });
}

const ACTIVE_STATES = new Set(["requested", "accepted", "held", "disputed"]);

export default function Deals({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const [params] = useSearchParams();
  const all = loaderData.deals;
  const defaultTab = all.some((x) => x.role === "seller" && x.action) && !all.some((x) => x.role === "buyer" && x.action) ? "selling" : "buying";
  const urlTab = params.get("tab") === "selling" || params.get("tab") === "buying" ? (params.get("tab") as "buying" | "selling") : defaultTab;
  const [tab, setTab] = useState<"buying" | "selling">(urlTab);
  useEffect(() => { setTab(urlTab); }, [urlTab]);

  const switchTab = (next: "buying" | "selling") => {
    setTab(next);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    }
  };

  const buyingDeals = all.filter((x) => x.role === "buyer");
  const sellingDeals = all.filter((x) => x.role === "seller");
  const buyingNeeds = buyingDeals.filter((x) => x.action).length;
  const sellingNeeds = sellingDeals.filter((x) => x.action).length;
  const totalNeeds = buyingNeeds + sellingNeeds;
  const activeCount = all.filter((x) => ACTIVE_STATES.has(x.state)).length;

  const list = tab === "selling" ? sellingDeals : buyingDeals;
  const now = new Date();
  const card = (x: (typeof list)[number]) => {
    const names = x.role === "buyer" ? { buyer: loaderData.me, seller: x.other } : { buyer: x.other, seller: loaderData.me };
    const dt = dealText(x, x.role, names, Number(x.amount_due_kobo), { decisionDue: x.decision_due_at, endedBy: x.ended_by, nextStageDone: x.next_stage_done }, now, t);
    return <DealCard key={x.id} href={`/d/${x.id}`} state={dt.chip.state} word={dt.chip.word} amountKobo={dt.amountKobo} item={x.title}
      counterpart={x.other.split(" ")[0]} deadline={dt.deadline} nextStep={x.action ? dt.next : undefined}
      imageUrl={x.photo_key ? photoUrl(x.photo_key, "small") : undefined} />;
  };
  const needs = list.filter((x) => x.action);
  // Deals still going (but not waiting on you) apart from the finished ones, so "On its way" isn't lost among old deals.
  const going = list.filter((x) => !x.action && ACTIVE_STATES.has(x.state));
  const done = list.filter((x) => !x.action && !ACTIVE_STATES.has(x.state));
  const totalText = all.length === 1 ? t("1 deal") : t("{n} deals", { n: all.length });

  return (
    <div>
      <TopBar title={t("Deals")} />
      <main className="page deals-page stack-4">
        <div className="deals-head">
          <div className="stack desktop-only" style={{ gap: 2 }}>
            <h1 className="heading">{t("Deals")}</h1>
            <p className="caption muted">
              {all.length
                ? (totalNeeds ? `${totalText} · ${t("{n} need you", { n: totalNeeds })}` : totalText)
                : t("Every deal is protected until you confirm.")}
            </p>
          </div>
          <div className="seg deals-tabs" role="tablist" aria-label={t("Deals")} style={{ ["--seg-i" as string]: tab === "selling" ? 1 : 0 }}>
            <button type="button" role="tab" aria-selected={tab === "buying"} onClick={() => switchTab("buying")}>
              {t("Buying")}{buyingNeeds ? <span className="notif-pill-count">{buyingNeeds}</span> : null}
            </button>
            <button type="button" role="tab" aria-selected={tab === "selling"} onClick={() => switchTab("selling")}>
              {t("Selling")}{sellingNeeds ? <span className="notif-pill-count">{sellingNeeds}</span> : null}
            </button>
          </div>
        </div>

        <div className="deals-layout">
          <div className="deals-main">
            {list.length === 0 ? (
              <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
                <span className="empty-icon"><Icon name="receipt" size={26} /></span>
                {tab === "selling" ? (
                  <>
                    <p className="body muted">{t("You're not selling anything yet. List something and share the link.")}</p>
                    <Button variant="primary" to="/sell" icon="plus">{t("Sell something")}</Button>
                  </>
                ) : (
                  <>
                    <p className="body muted">{t("You haven't bought anything with NosHen yet.")}</p>
                    <Button variant="primary" to="/browse" icon="search">{t("Browse listings")}</Button>
                  </>
                )}
              </div>
            ) : null}

            {needs.length ? (
              <section className="stack">
                <h2 className="label muted">{t("Needs you")}</h2>
                <div className="deals-grid">{needs.map(card)}</div>
              </section>
            ) : null}

            {going.length ? (
              <section className="stack">
                <h2 className="label muted">{t("In progress")}</h2>
                <div className="deals-grid">{going.map(card)}</div>
              </section>
            ) : null}

            {done.length ? (
              <section className="stack">
                <h2 className="label muted">{t("Done")}</h2>
                <div className="deals-grid">{done.map(card)}</div>
              </section>
            ) : null}
          </div>

          <aside className="deals-side desktop-only">
            <section className="card stack">
              <p className="title">{t("Overview")}</p>
              <div>
                <Kv k={t("Buying")} v={String(buyingDeals.length)} />
                <Kv k={t("Selling")} v={String(sellingDeals.length)} />
                <Kv k={t("Active")} v={String(activeCount)} />
                <Kv k={t("Needs you")} v={String(totalNeeds)} />
              </div>
            </section>
            <section className="card stack">
              <p className="title">{t("Start a deal")}</p>
              <Button variant="primary" to="/sell" icon="plus" block>{t("Sell something")}</Button>
              <Button to="/sell/quick" icon="bolt" block>{t("Quick escrow link")}</Button>
              <Button to="/browse" icon="search" block>{t("Browse listings")}</Button>
            </section>
            <section className="card link-list" aria-label={t("Quick links")}>
              <p className="label muted">{t("Quick links")}</p>
              <Link to="/notifications" className="row-between">
                <span className="row"><Icon name="bell" size={18} />{t("Notifications")}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
              <Link to="/wallet" className="row-between">
                <span className="row"><Icon name="wallet" size={18} />{t("NosHen wallet")}{loaderData.walletLive ? null : <span className="soon-tag">{t("Soon")}</span>}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
              <Link to="/account" className="row-between">
                <span className="row"><Icon name="user" size={18} />{t("Account")}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
