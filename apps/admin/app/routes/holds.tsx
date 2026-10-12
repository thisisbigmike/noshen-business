import { Link } from "react-router";
import type { Route } from "./+types/holds";
import { requireStaff, withApp } from "../../server/web";
import { staffQueues } from "@noshen/engine/queries";
import { Icon } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { ago } from "@noshen/shared/time";

export const meta = () => [{ title: "Review holds · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  return { rows: (await withApp((d) => staffQueues(d.db))).holds };
}

export default function Holds({ loaderData: { rows } }: Route.ComponentProps) {
  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">Review holds</h1>
          <p className="body muted">Payments that arrived but didn't look right: the wrong amount, or from an account in another name. The deal waits until you clear the hold or refund it.</p>
        </div>
      </header>
      <section className="panel" aria-label="Review holds">
        {rows.length === 0 ? (
          <div className="empty-mini"><Icon name="circle-check" size={28} /><p className="label">Nothing held</p><p className="caption muted">Every payment matched its deal.</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Review holds (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Held</th><th>Case</th><th>Amount</th><th className="cell-action"><span className="sr-only">Review</span></th></tr></thead>
              <tbody>{rows.map((x: any) => (
                <tr key={x.id}>
                  <td className="caption" style={{ whiteSpace: "nowrap" }}>{ago(x.state_changed_at)}</td>
                  <td><Link to={`/holds/${x.id}`} className="body ink-link">{x.title}: {firstName(x.buyer ?? "Buyer")} buying from {firstName(x.seller ?? "Seller")}</Link><p className="caption muted">{x.review_hold_reason}</p></td>
                  <td className="tabular">{naira(x.amount_due_kobo)}</td>
                  <td className="cell-action"><Link to={`/holds/${x.id}`} className="nh-btn nh-btn-primary nh-btn-sm" prefetch="intent">Review</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
