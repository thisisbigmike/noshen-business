import { Link } from "react-router";
import type { Route } from "./+types/notifications";
import { requireUser, withApp } from "../../server/web";
import { notificationsFor } from "@noshen/engine/queries";
import { Icon, TopBar } from "@noshen/ui/ui";
import { when } from "@noshen/shared/time";
import { PushCard } from "../lib/push";
import { useT } from "@noshen/ui/i18n";

export const meta = () => [{ title: "Notifications · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => ({ items: await notificationsFor(d.db, (await requireUser(request, d)).id) }));
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <div>
      <TopBar title={t("Notifications")} />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">{t("Notifications")}</h1>
        <PushCard />
        {loaderData.items.length === 0 ? (
          <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="empty-icon"><Icon name="bell" size={26} /></span>
            <p className="title">{t("Nothing yet")}</p>
            <p className="body muted">{t("Updates about your deals appear here as they happen.")}</p>
          </div>
        ) : (
          <ul className="feed">
            {loaderData.items.map((n: any) => {
              const text = n.deal_id ? <Link to={`/d/${n.deal_id}`} className="body ink">{n.params?.text}</Link> : <p className="body">{n.params?.text}</p>;
              return (
                <li key={n.id} className={n.read_at ? "feed-item" : "feed-item unread"}>
                  <span className="feed-icon"><Icon name={n.deal_id ? "receipt" : "bell"} size={18} /></span>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    {text}
                    <span className="caption muted">{when(new Date(n.created_at))}{n.read_at ? "" : ` · ${t("New")}`}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
