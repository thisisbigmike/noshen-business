import type { Route } from "./+types/money";
import { requireStaff, withApp } from "../../../server/web";
import { moneySummary } from "../../../server/engine/queries";
import { Info, MoneyStatus } from "../../components/ui";
import { naira } from "../../../shared/money";
import { when } from "../../../shared/time";

export const meta = () => [{ title: "Money · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  return withApp((d) => moneySummary(d.db));
}

export default function Money({ loaderData: m }: Route.ComponentProps) {
  const ledger = Number(m.check?.ledger_held_kobo ?? 0);
  const open = Number(m.check?.open_deals_kobo ?? 0);
  const ok = ledger === open;
  return (
    <>
      <div className="stack"><h1 className="heading">Money</h1><p className="body muted">Every naira held for buyers and sellers, checked against payments into open deals.</p></div>
      <div className="stat-cards" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="card stack"><p className="label">Held in NosHen's ledger</p><p className="big-amount">{naira(ledger)}</p></div>
        <div className="card stack"><p className="label">Paid into open deals</p><p className="big-amount">{naira(open)}</p></div>
      </div>
      {ok ? <Info icon="circle-check"><strong>Matches.</strong> The ledger and the payments into held and disputed deals agree.</Info>
        : <Info icon="alert-triangle" tone="danger"><strong>Mismatch of {naira(Math.abs(ledger - open))}.</strong> Stop releases and reconcile with the partner's statement.</Info>}
      <section className="stack">
        <h2 className="title">Held money by deal state</h2>
        <table className="table"><thead><tr><th>State</th><th>Deals</th><th>Amount</th></tr></thead>
          <tbody>{m.byState.length === 0 ? <tr><td colSpan={3} className="muted">No money held right now.</td></tr> : m.byState.map((b: any) => (
            <tr key={b.state}><td><MoneyStatus state={b.state === "held" ? "held" : "dispute"} /></td><td>{b.n}</td><td className="tabular">{naira(b.kobo)}</td></tr>))}</tbody></table>
      </section>
      <section className="stack">
        <h2 className="title">Transfers out</h2>
        <table className="table"><thead><tr><th>Time</th><th>Type</th><th>Deal</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{m.transfers.length === 0 ? <tr><td colSpan={5} className="muted">No transfers yet.</td></tr> : m.transfers.map((t: any, i: number) => (
            <tr key={i}><td>{when(new Date(t.created_at))}</td><td>{t.kind}</td><td>{String(t.deal_id ?? "").slice(0, 8).toUpperCase()}</td><td className="tabular">{naira(t.amount_kobo)}</td><td className={t.status === "failed" ? "error-text" : ""}>{t.status}</td></tr>))}</tbody></table>
      </section>
      {m.unmatched.length ? (
        <section className="stack">
          <h2 className="title">Payments that matched no deal</h2>
          <table className="table"><thead><tr><th>Received</th><th>From</th><th>Amount</th></tr></thead>
            <tbody>{m.unmatched.map((p: any, i: number) => <tr key={i}><td>{when(new Date(p.received_at))}</td><td>{p.sender_name}</td><td className="tabular">{naira(p.amount_kobo)}</td></tr>)}</tbody></table>
        </section>
      ) : null}
    </>
  );
}
