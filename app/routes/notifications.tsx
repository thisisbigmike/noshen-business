import { Link } from "react-router";
import type { Route } from "./+types/notifications";
import { requireUser, withApp } from "../../server/web";
import { notificationsFor } from "../../server/engine/queries";
import { TopBar } from "../components/ui";
import { when } from "../../shared/time";

export const meta = () => [{ title: "Notifications · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => ({ items: await notificationsFor(d.db, (await requireUser(request, d)).id) }));
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <TopBar title="Notifications" back="/account" />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">Notifications</h1>
        {loaderData.items.length === 0 ? <p className="body muted">Nothing yet. Updates about your deals appear here, and by SMS.</p> : null}
        <div className="card stack" style={{ gap: 0 }}>
          {loaderData.items.map((n: any) => (
            <div key={n.id} className="kv" style={{ flexDirection: "column", gap: 2 }}>
              {n.deal_id ? <Link to={`/d/${n.deal_id}`} className="body">{n.params?.text}</Link> : <p className="body">{n.params?.text}</p>}
              <span className="caption muted">{when(new Date(n.created_at))}{n.read_at ? "" : " · New"}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
