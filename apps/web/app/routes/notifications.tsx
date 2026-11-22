import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/notifications";
import { requireUser, withApp } from "../../server/web";
import { notificationsFor } from "@noshen/engine/queries";
import { Icon, Kv, TopBar } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { when } from "@noshen/shared/time";
import { PushCard } from "../lib/push";
import { useT } from "@noshen/ui/i18n";

export const meta = () => [{ title: "Notifications · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => ({ items: await notificationsFor(d.db, (await requireUser(request, d)).id) }));
}

type Filter = "all" | "deals" | "new";
type Tone = "brand" | "ok" | "held" | "danger";

function metaFor(n: { deal_id: string | null; template?: string | null }): { icon: IconName; tone: Tone } {
  const tpl = n.template ?? "";
  if (tpl === "released" || tpl === "stage_released" || tpl === "payout_sent") return { icon: "circle-check", tone: "ok" };
  if (tpl === "payment_held") return { icon: "lock", tone: "held" };
  if (tpl === "problem_reported" || tpl.includes("removed") || tpl.includes("declined") || tpl.includes("cancelled") || tpl.includes("blocked")) {
    return { icon: "alert-triangle", tone: "danger" };
  }
  if (tpl.includes("expired") || tpl.includes("overdue") || tpl === "payment_review") return { icon: "clock", tone: "held" };
  if (tpl === "sent" || tpl === "delivered" || tpl === "arrival_check") return { icon: "truck-delivery", tone: "brand" };
  if (tpl.includes("refund")) return { icon: "arrow-back-up", tone: "brand" };
  return { icon: n.deal_id ? "receipt" : "bell", tone: "brand" };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const items = loaderData.items;
  const unreadCount = items.filter((n: any) => !n.read_at).length;
  const dealCount = items.filter((n: any) => !!n.deal_id).length;
  const shown = items.filter((n: any) => (filter === "deals" ? !!n.deal_id : filter === "new" ? !n.read_at : true));
  const filterIdx = filter === "all" ? 0 : filter === "deals" ? 1 : 2;
  const totalText = items.length === 1 ? t("1 update") : t("{n} updates", { n: items.length });

  const emptyTitle = filter === "new" ? t("No new notifications") : filter === "deals" ? t("No deal updates yet") : t("Nothing yet");
  const emptyBody = filter === "new"
    ? t("You're all caught up.")
    : filter === "deals"
      ? t("Deal updates will show up here once you buy or sell.")
      : t("Updates about your deals appear here as they happen.");

  return (
    <div>
      <TopBar title={t("Notifications")} />
      <main className="page notif-page stack-4">
        <div className="notif-head">
          <div className="stack desktop-only" style={{ gap: 2 }}>
            <h1 className="heading">{t("Notifications")}</h1>
            {items.length ? (
              <p className="caption muted">
                {unreadCount ? `${totalText} · ${t("{n} new", { n: unreadCount })}` : totalText}
              </p>
            ) : null}
          </div>
          <div className="seg notif-filter" role="tablist" aria-label={t("Filter notifications")}
            style={{ ["--seg-n" as string]: 3, ["--seg-i" as string]: filterIdx }}>
            <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
              {t("All")}
            </button>
            <button type="button" role="tab" aria-selected={filter === "deals"} onClick={() => setFilter("deals")}>
              {t("Deals")}
            </button>
            <button type="button" role="tab" aria-selected={filter === "new"} onClick={() => setFilter("new")}>
              {t("New")}{unreadCount ? <span className="notif-pill-count">{unreadCount}</span> : null}
            </button>
          </div>
        </div>

        <div className="notif-layout">
          <section className="notif-main" aria-label={t("Notifications")}>
            {shown.length === 0 ? (
              <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
                <span className="empty-icon"><Icon name="bell" size={26} /></span>
                <p className="title">{emptyTitle}</p>
                <p className="body muted">{emptyBody}</p>
              </div>
            ) : (
              <ul className="feed notif-feed">
                {shown.map((n: any) => {
                  const { icon, tone } = metaFor(n);
                  const unread = !n.read_at;
                  const time = when(new Date(n.created_at));
                  const inner = (
                    <>
                      <span className={`feed-icon tone-${tone}`} aria-hidden="true"><Icon name={icon} size={18} /></span>
                      <div className="feed-body">
                        <p className="body ink">{n.params?.text}</p>
                        <div className="feed-meta-mobile">
                          <span className="caption muted">{time}</span>
                          {unread ? <span className="notif-new-tag">{t("New")}</span> : null}
                        </div>
                      </div>
                      <div className="feed-end">
                        {unread ? <span className="notif-new-tag desktop-only">{t("New")}</span> : null}
                        <span className="caption muted desktop-only feed-time">{time}</span>
                        {n.deal_id ? <Icon name="chevron-right" size={18} className="feed-chev" /> : null}
                      </div>
                    </>
                  );
                  return (
                    <li key={n.id} className={unread ? "feed-item unread" : "feed-item"}>
                      {n.deal_id ? (
                        <Link to={`/d/${n.deal_id}`} className="feed-row">{inner}</Link>
                      ) : (
                        <div className="feed-row">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="notif-side">
            <PushCard />
            <section className="card stack desktop-only">
              <p className="title">{t("Overview")}</p>
              <div>
                <Kv k={t("Total updates")} v={String(items.length)} />
                <Kv k={t("New")} v={String(unreadCount)} />
                <Kv k={t("Deal updates")} v={String(dealCount)} />
              </div>
            </section>
            <section className="card link-list desktop-only" aria-label={t("Quick links")}>
              <p className="label muted">{t("Quick links")}</p>
              <Link to="/deals" className="row-between">
                <span className="row"><Icon name="receipt" size={18} />{t("Deals")}</span>
                <Icon name="chevron-right" size={18} />
              </Link>
              <Link to="/wallet" className="row-between">
                <span className="row"><Icon name="wallet" size={18} />{t("NosHen wallet")}</span>
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
