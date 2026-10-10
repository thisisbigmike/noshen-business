import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/queues";
import { requireStaff, withApp } from "../../../server/web";
import { staffQueues } from "../../../server/engine/queries";
import { Info, MoneyStatus } from "../../components/ui";
import { naira } from "../../../shared/money";
import { disputeReasonLabel, firstName } from "../../../shared/deal";
import { left, when } from "../../../shared/time";

export const meta = () => [{ title: "Queues · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  return withApp((d) => staffQueues(d.db));
}

export default function Queues({ loaderData: q }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const decided = params.get("decided");
  const total = q.disputes.length + q.holds.length + q.locked.length + q.stuck.length + q.failed.length;
  const counts: [string, number, string][] = [
    ["Disputes awaiting decision", q.disputes.length, "Decide within 72 hours"], ["Review holds", q.holds.length, "Payment name or amount"],
    ["Locked release codes", q.locked.length, "5 wrong codes"], ["Stuck deals", q.stuck.length, "Past a deadline"], ["Failed payouts", q.failed.length, "Rejected by the bank"],
  ];
  return (
    <>
      <div className="stack"><h1 className="heading">Queues</h1><p className="body muted">{total ? `${total} thing${total > 1 ? "s" : ""} waiting, most urgent first.` : "Nothing waiting. Every deal is moving."}</p></div>
      {decided ? <Info icon="circle-check">Decision recorded: {decided}. Both people have been sent your reason, and the case has left the queue. <Link to="/staff/audit">See audit log</Link></Info> : null}
      <div className="stat-cards">
        {counts.map(([label, n, sub]) => <div key={label} className="card stack"><p className="big-amount">{n}</p><p className="label">{label}</p><p className="caption muted">{sub}</p></div>)}
      </div>
      <section className="stack">
        <h2 className="title">Disputes</h2>
        {q.disputes.length === 0 ? <p className="caption muted">Nothing waiting in this queue.</p> : (
          <table className="table">
            <thead><tr><th>Time left</th><th>Case</th><th>Amount</th><th>Money</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{q.disputes.map((x: any) => (
              <tr key={x.id}>
                <td><p className="label">{left(x.decision_due_at)}</p><p className="caption muted">Decide by {when(new Date(x.decision_due_at))}</p></td>
                <td><p className="body">{x.title}: {firstName(x.buyer)} vs {firstName(x.seller)}</p><p className="caption muted">{disputeReasonLabel(x.reason)} · {x.state === "collecting_evidence" ? "collecting evidence" : "ready to decide"}</p></td>
                <td className="tabular">{naira(x.held_kobo)}</td>
                <td><MoneyStatus state="dispute" /></td>
                <td><Link to={`/staff/disputes/${x.id}`}>Open</Link></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </section>
      <section className="stack">
        <h2 className="title">Review holds</h2>
        {q.holds.length === 0 ? <p className="caption muted">Nothing waiting in this queue.</p> : (
          <table className="table">
            <thead><tr><th>Held since</th><th>Case</th><th>Amount</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{q.holds.map((x: any) => (
              <tr key={x.id}>
                <td>{when(new Date(x.state_changed_at))}</td>
                <td><p className="body">{x.title}: {firstName(x.buyer)} buying from {firstName(x.seller)}</p><p className="caption muted">{x.review_hold_reason}</p></td>
                <td className="tabular">{naira(x.amount_due_kobo)}</td>
                <td><Link to={`/staff/holds/${x.id}`}>Open</Link></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </section>
      {q.locked.length || q.stuck.length || q.failed.length ? (
        <section className="stack">
          <h2 className="title">Other alerts</h2>
          <table className="table">
            <thead><tr><th>Alert</th><th>Deal</th><th>Detail</th></tr></thead>
            <tbody>
              {q.locked.map((x: any) => <tr key={"l" + x.id}><td>Locked release code</td><td>{x.title}</td><td>Locked until {when(new Date(x.locked_until))}</td></tr>)}
              {q.stuck.map((x: any) => <tr key={"s" + x.id}><td>Stuck deal</td><td>{x.title}</td><td>{x.state === "held" ? `Held past the hand-over deadline (${when(new Date(x.handover_due_at))})` : "Released, payout not confirmed"}</td></tr>)}
              {q.failed.map((x: any) => <tr key={"f" + x.id}><td>Failed {x.kind}</td><td className="tabular">{naira(x.amount_kobo)}</td><td>{x.failure_reason}</td></tr>)}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
