import { Link } from "react-router";
import type { Route } from "./+types/disputes";
import { requireStaff, withApp } from "../../server/web";
import { staffDisputes } from "@noshen/engine/queries";
import { Icon } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { disputeReasonLabel, firstName } from "@noshen/shared/deal";
import { left, when } from "@noshen/shared/time";

export const meta = () => [{ title: "Disputes · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  const decided = new URL(request.url).searchParams.get("show") === "decided";
  return { decided, rows: await withApp((d) => staffDisputes(d.db, decided)) };
}

export default function Disputes({ loaderData: { decided, rows } }: Route.ComponentProps) {
  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">Disputes</h1>
          <p className="body muted">{decided ? "Decided disputes, newest first." : "Open disputes, the closest deadline first. Each must be decided within 72 hours of the report."}</p>
        </div>
      </header>
      <nav className="chips" aria-label="Show">
        <Link to="/disputes" className="chip" aria-current={!decided ? "true" : undefined} replace>Open</Link>
        <Link to="/disputes?show=decided" className="chip" aria-current={decided ? "true" : undefined} replace>Decided</Link>
      </nav>
      <section className="panel" aria-label="Disputes">
        {rows.length === 0 ? (
          <div className="empty-mini"><Icon name="scale" size={28} /><p className="label">{decided ? "No decided disputes yet" : "No open disputes"}</p><p className="caption muted">{decided ? "Decisions show here once made." : "Nothing to decide right now."}</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Disputes (scrolls sideways)">
            <table className="table">
              <thead><tr><th>{decided ? "Decided" : "Time left"}</th><th>Case</th><th>Amount</th><th>{decided ? "Decision" : "Stage"}</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{rows.map((x: any) => (
                <tr key={x.id}>
                  <td>{decided ? <span className="caption">{when(new Date(x.decided_at))}</span> : <><p className="label">{left(x.decision_due_at)}</p><p className="caption muted">by {when(new Date(x.decision_due_at))}</p></>}</td>
                  <td><Link to={`/disputes/${x.id}`} className="body ink-link">{x.title}: {firstName(x.buyer ?? "Buyer")} vs {firstName(x.seller ?? "Seller")}</Link><p className="caption muted">{disputeReasonLabel(x.reason)} · <Link to={`/deals/${x.deal_id}`} className="muted-link">deal</Link></p></td>
                  <td className="tabular">{naira(x.amount_due_kobo)}</td>
                  <td>{decided
                    ? <span className="st-pill brand">{x.decision === "refund_buyer" ? "Refunded buyer" : "Released to seller"}</span>
                    : <span className={`st-pill ${x.state === "in_review" ? "bad" : "warn"}`}>{x.state === "in_review" ? "Ready to decide" : "Collecting evidence"}</span>}</td>
                  <td className="cell-action"><Link to={`/disputes/${x.id}`} className="nh-btn nh-btn-secondary nh-btn-sm" prefetch="intent">Open</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
