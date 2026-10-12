import { Form, Link } from "react-router";
import type { Route } from "./+types/audit";
import { env } from "cloudflare:workers";
import { requireStaff, withApp } from "../../server/web";
import { auditLog } from "@noshen/engine/queries";
import { Icon, Select } from "@noshen/ui/ui";
import { when } from "@noshen/shared/time";
import { actionLabel } from "../lib/labels";

export const meta = () => [{ title: "Audit log · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  const url = new URL(request.url);
  const f = { action: url.searchParams.get("action") ?? "", target: url.searchParams.get("target") ?? "", q: url.searchParams.get("q") ?? "" };
  return { ...(await withApp((d) => auditLog(d.db, f))), f, appUrl: env.APP_URL };
}

/** Where an entry's target lives on the staff site. */
function targetLink(type: string, id: string, appUrl: string) {
  const short = String(id).slice(0, 8).toUpperCase();
  if (type === "deal") return <Link to={`/deals/${id}`} className="ink-link">Deal {short}</Link>;
  if (type === "user") return <Link to={`/users/${id}`} className="ink-link">Person {short}</Link>;
  if (type === "dispute") return <Link to={`/disputes/${id}`} className="ink-link">Dispute {short}</Link>;
  if (type === "listing") return <a href={`${appUrl}/l/${id}`} target="_blank" rel="noreferrer" className="ink-link">Listing {short}</a>;
  return <span>{type} {short}</span>;
}

export default function Audit({ loaderData: { rows, actions, f, appUrl } }: Route.ComponentProps) {
  return (
    <>
      <div className="stack console-head"><h1 className="heading">Audit log</h1><p className="body muted">Every staff action, with who did it and why. Entries can't be edited or deleted.</p></div>
      <Form method="get" className="console-filters" role="search">
        {f.target ? <input type="hidden" name="target" value={f.target} /> : null}
        <label className="search-pill">
          <Icon name="search" size={20} />
          <span className="sr-only">Search reasons and staff</span>
          <input type="search" name="q" defaultValue={f.q} placeholder="Search reasons or staff names" />
        </label>
        <div className="console-filter-select">
          <Select name="action" label="Action" hideLabel submitOnChange defaultValue={f.action}
            options={[{ value: "", label: "All actions" }, ...actions.map((a) => ({ value: a, label: actionLabel(a) }))]} />
        </div>
        <button type="submit" className="nh-btn nh-btn-primary nh-btn-md nh-btn-pill">Search</button>
      </Form>
      {f.target ? <p className="caption muted">Showing actions on one {rows[0]?.target_type ?? "record"}. <Link to="/audit">Show everything</Link></p> : null}
      <section className="panel" aria-label="Staff actions"><div className="table-scroll" tabIndex={0} role="region" aria-label="Staff actions (scrolls sideways)">
      <table className="table">
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>About</th><th>Reason</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="muted">No staff actions{f.action || f.q || f.target ? " match" : " yet"}.</td></tr> : rows.map((a: any) => (
          <tr key={a.id}>
            <td style={{ whiteSpace: "nowrap" }}>{when(new Date(a.at))}</td>
            <td><p className="body">{a.name}</p><p className="caption muted">{a.role === "admin" ? "Admin" : "Reviewer"}</p></td>
            <td><Link to={`/audit?action=${encodeURIComponent(a.action)}`} className="st-pill brand" style={{ textDecoration: "none" }}>{actionLabel(a.action)}</Link></td>
            <td className="caption">{targetLink(a.target_type, a.target_id, appUrl)}</td>
            <td>{a.reason}</td>
          </tr>))}
        </tbody>
      </table>
      </div></section>
    </>
  );
}
