import { Form, Link } from "react-router";
import type { Route } from "./+types/users";
import { requireStaff, withApp } from "../../server/web";
import { staffUsers } from "@noshen/engine/queries";
import { Avatar, Icon } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { ago } from "@noshen/shared/time";

export const meta = () => [{ title: "People · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return { q, rows: await withApp((d) => staffUsers(d.db, q)) };
}

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" }, frozen: { label: "Frozen", tone: "warn" }, banned: { label: "Banned", tone: "bad" },
};

export default function Users({ loaderData: { q, rows } }: Route.ComponentProps) {
  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">People</h1>
          <p className="body muted">Everyone with a NosHen account, newest first: their checks, limits and deals.</p>
        </div>
      </header>
      <Form method="get" className="console-filters" role="search">
        <label className="search-pill">
          <Icon name="search" size={20} />
          <span className="sr-only">Search people</span>
          <input type="search" name="q" defaultValue={q} placeholder="Search by name or email" />
        </label>
        <button type="submit" className="nh-btn nh-btn-primary nh-btn-md nh-btn-pill">Search</button>
      </Form>
      <section className="panel" aria-label="People">
        <div className="panel-head"><p className="caption muted">{rows.length === 200 ? "Showing the newest 200. Search to narrow it down." : `${rows.length} ${rows.length === 1 ? "person" : "people"}${q ? ` matching "${q}"` : ""}`}</p></div>
        {rows.length === 0 ? (
          <div className="empty-mini"><Icon name="users" size={28} /><p className="label">No one matches</p><p className="caption muted">Check the spelling, or search by email.</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="People (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Person</th><th>Joined</th><th>Checks</th><th>Deal limit</th><th>Listings</th><th>Bought</th><th>Sold</th><th>Status</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{rows.map((u: any) => {
                const st = STATUS[u.status] ?? { label: u.status, tone: "muted" };
                return (
                  <tr key={u.id}>
                    <td><div className="cell-listing"><Avatar name={u.full_name ?? u.email ?? "?"} /><div style={{ minWidth: 0 }}><Link to={`/users/${u.id}`} className="body ink-link" prefetch="intent">{u.full_name ?? "No name yet"}</Link><p className="caption muted">{u.email ?? "No email"}</p></div></div></td>
                    <td className="caption" style={{ whiteSpace: "nowrap" }}>{ago(u.created_at)}</td>
                    <td>
                      <div className="checks">
                        <span className={u.id_verified ? "ok" : ""}><Icon name={u.id_verified ? "circle-check" : "clock"} size={16} />ID</span>
                        <span className={u.bank_ok ? "ok" : ""}><Icon name={u.bank_ok ? "circle-check" : "clock"} size={16} />Bank</span>
                      </div>
                    </td>
                    <td className="tabular">{u.max_deal_kobo ? naira(u.max_deal_kobo) : <span className="caption muted">Standard</span>}</td>
                    <td className="tabular">{u.live_listings}</td>
                    <td className="tabular">{u.bought}</td>
                    <td className="tabular">{u.sold}</td>
                    <td><span className={`st-pill ${st.tone}`}>{st.label}</span></td>
                    <td className="cell-action"><Link to={`/users/${u.id}`} className="nh-btn nh-btn-secondary nh-btn-sm">Open</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
