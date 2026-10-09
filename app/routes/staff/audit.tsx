import type { Route } from "./+types/audit";
import { requireStaff, withApp } from "../../../server/web";
import { auditLog } from "../../../server/engine/queries";
import { when } from "../../../shared/time";

export const meta = () => [{ title: "Audit log · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  return { rows: await withApp((d) => auditLog(d.db)) };
}

export default function Audit({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <div className="stack"><h1 className="heading">Audit log</h1><p className="body muted">Every staff action, with who did it and why. Entries can't be edited or deleted.</p></div>
      <table className="table">
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="muted">No staff actions yet.</td></tr> : rows.map((a: any, i: number) => (
          <tr key={i}>
            <td style={{ whiteSpace: "nowrap" }}>{when(new Date(a.at))}</td>
            <td><p className="body">{a.name}</p><p className="caption muted">{a.role === "admin" ? "Admin" : "Reviewer"}</p></td>
            <td>{a.action.replace(/_/g, " ")}</td>
            <td className="caption">{a.target_type} {String(a.target_id).slice(0, 8).toUpperCase()}</td>
            <td>{a.reason}</td>
          </tr>))}
        </tbody>
      </table>
    </>
  );
}
