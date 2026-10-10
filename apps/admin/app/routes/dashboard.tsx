import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireStaff, withApp } from "../../server/web";
import { adminOverview, staffQueues } from "@noshen/engine/queries";
import { Icon, Info, MoneyStatus } from "@noshen/ui/ui";
import type { IconName } from "@noshen/ui/icons";
import { naira } from "@noshen/shared/money";
import { disputeReasonLabel, firstName } from "@noshen/shared/deal";
import { categoryOf } from "@noshen/shared/categories";
import { left, when } from "@noshen/shared/time";

export const meta = () => [{ title: "Dashboard · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  const [q, o] = await withApp((d) => Promise.all([staffQueues(d.db), adminOverview(d.db)]));
  // Worked out here, in Lagos time, so the page reads the same on the server and in the browser.
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" }).format(now);
  return { q, o, greeting: `${greeting}, ${firstName(staff.name)}`, today };
}

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export default function Dashboard({ loaderData: { q, o, greeting, today } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const decided = params.get("decided");
  const total = q.disputes.length + q.holds.length + q.locked.length + q.stuck.length + q.failed.length;
  const kpis: { icon: IconName; label: string; value: string; sub: string; to?: string }[] = [
    { icon: "shield-lock", label: "Money held", value: naira(o.heldKobo), sub: `${o.openDeals} open deal${o.openDeals === 1 ? "" : "s"}`, to: "/money" },
    { icon: "trending-up", label: "Sold in 7 days", value: naira(o.soldKobo7d), sub: `${o.completed7d} deal${o.completed7d === 1 ? "" : "s"} completed` },
    { icon: "receipt", label: "Fees in 7 days", value: naira(o.fees7d), sub: "NosHen's fee on completed deals" },
    { icon: "tag", label: "Live listings", value: o.liveListings.toLocaleString("en-NG"), sub: `${o.listings7d} posted this week`, to: "/listings?status=live" },
    { icon: "users", label: "People", value: o.usersTotal.toLocaleString("en-NG"), sub: `${o.users7d} joined this week`, to: "/users" },
  ];
  const queues: { label: string; n: number; sub: string; href?: string }[] = [
    { label: "Disputes", n: q.disputes.length, sub: "Decide within 72 hours", href: "#disputes" },
    { label: "Review holds", n: q.holds.length, sub: "Payment name or amount", href: "#holds" },
    { label: "Locked codes", n: q.locked.length, sub: "5 wrong release codes", href: "#alerts" },
    { label: "Stuck deals", n: q.stuck.length, sub: "Past a deadline", href: "#alerts" },
    { label: "Failed payouts", n: q.failed.length, sub: "Rejected by the bank", href: "#alerts" },
  ];
  const peak = Math.max(1, ...o.days.map((d) => Math.max(d.started, d.completed)));
  const started = o.days.reduce((a, d) => a + d.started, 0);
  const completed = o.days.reduce((a, d) => a + d.completed, 0);
  const topCat = Math.max(1, ...o.byCategory.map((c) => c.n));

  return (
    <>
      <header className="console-head">
        <div className="stack">
          <p className="caption muted">{today}</p>
          <h1 className="heading">{greeting}</h1>
          <p className="body muted">{total ? `${total} thing${total > 1 ? "s" : ""} waiting for a reviewer, most urgent first.` : "Nothing waiting. Every deal is moving."}</p>
        </div>
      </header>
      {decided ? <Info icon="circle-check">Decision recorded: {decided}. Both people have been sent your reason, and the case has left the queue. <Link to="/audit">See audit log</Link></Info> : null}

      <div className="kpis">
        {kpis.map((k) => {
          const body = (<>
            <span className="kpi-icon"><Icon name={k.icon} size={20} /></span>
            <p className="caption muted">{k.label}</p>
            <p className="kpi-value tabular">{k.value}</p>
            <p className="caption muted">{k.sub}</p>
          </>);
          return k.to ? <Link key={k.label} to={k.to} className="kpi kpi-link">{body}</Link> : <div key={k.label} className="kpi">{body}</div>;
        })}
      </div>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="chart-title">
          <div className="panel-head">
            <div><h2 id="chart-title" className="title">Deals, last 14 days</h2><p className="caption muted">{started} started · {completed} completed · Lagos time</p></div>
            <div className="legend" aria-hidden="true"><span><i className="dot started" />Started</span><span><i className="dot completed" />Completed</span></div>
          </div>
          <div className="bars" aria-hidden="true">
            {o.days.map((d, i) => (
              <div key={d.day} className="bar-day" title={`${dayLabel(d.day, { day: "numeric", month: "short" })}: ${d.started} started, ${d.completed} completed`}>
                <div className="bar-pair">
                  <span className="bar started" style={{ height: `${(d.started / peak) * 100}%` }} />
                  <span className="bar completed" style={{ height: `${(d.completed / peak) * 100}%` }} />
                </div>
                <span className={`bar-label${i % 2 ? " odd" : ""}`}>{dayLabel(d.day, { day: "numeric" })}</span>
              </div>
            ))}
          </div>
          <table className="sr-only">
            <caption>Deals started and completed each day, last 14 days</caption>
            <thead><tr><th>Day</th><th>Started</th><th>Completed</th></tr></thead>
            <tbody>{o.days.map((d) => <tr key={d.day}><td>{dayLabel(d.day, { weekday: "long", day: "numeric", month: "long" })}</td><td>{d.started}</td><td>{d.completed}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="panel" aria-labelledby="cat-title">
          <div className="panel-head"><div><h2 id="cat-title" className="title">Live listings by category</h2><p className="caption muted">{o.liveListings} live now</p></div></div>
          {o.byCategory.length === 0 ? <p className="caption muted">No live listings yet.</p> : (
            <ul className="hbars">
              {o.byCategory.map((c) => {
                const cat = categoryOf(c.category);
                return (
                  <li key={c.category}>
                    <Link to={`/listings?status=live&cat=${c.category}`} className="hbar">
                      <span className="hbar-label"><Icon name={cat.icon} size={16} />{cat.label}</span>
                      <span className="hbar-track"><span style={{ width: `${(c.n / topCat) * 100}%` }} /></span>
                      <span className="tabular label">{c.n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="stack" aria-labelledby="queues-title">
        <h2 id="queues-title" className="title">Needs attention</h2>
        <div className="queue-tiles">
          {queues.map((x) => {
            const body = (<><p className="kpi-value tabular">{x.n}</p><p className="label">{x.label}</p><p className="caption muted">{x.sub}</p></>);
            return x.n && x.href ? <a key={x.label} href={x.href} className="queue-tile hot">{body}</a> : <div key={x.label} className="queue-tile">{body}</div>;
          })}
        </div>
      </section>

      <section className="panel" id="disputes" aria-labelledby="disputes-title">
        <div className="panel-head"><h2 id="disputes-title" className="title">Disputes</h2>{q.disputes.length ? <span className="count-pill">{q.disputes.length}</span> : null}</div>
        {q.disputes.length === 0 ? <p className="caption muted">Nothing waiting in this queue.</p> : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Disputes (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Time left</th><th>Case</th><th>Amount</th><th>Money</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{q.disputes.map((x: any) => (
                <tr key={x.id}>
                  <td><p className="label">{left(x.decision_due_at)}</p><p className="caption muted">Decide by {when(new Date(x.decision_due_at))}</p></td>
                  <td><p className="body">{x.title}: {firstName(x.buyer)} vs {firstName(x.seller)}</p><p className="caption muted">{disputeReasonLabel(x.reason)} · {x.state === "collecting_evidence" ? "collecting evidence" : "ready to decide"}</p></td>
                  <td className="tabular">{naira(x.held_kobo)}</td>
                  <td><MoneyStatus state="dispute" /></td>
                  <td className="cell-action"><Link to={`/disputes/${x.id}`} className="nh-btn nh-btn-secondary nh-btn-sm">Open</Link></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" id="holds" aria-labelledby="holds-title">
        <div className="panel-head"><h2 id="holds-title" className="title">Review holds</h2>{q.holds.length ? <span className="count-pill">{q.holds.length}</span> : null}</div>
        {q.holds.length === 0 ? <p className="caption muted">Nothing waiting in this queue.</p> : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Review holds (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Held since</th><th>Case</th><th>Amount</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{q.holds.map((x: any) => (
                <tr key={x.id}>
                  <td>{when(new Date(x.state_changed_at))}</td>
                  <td><p className="body">{x.title}: {firstName(x.buyer)} buying from {firstName(x.seller)}</p><p className="caption muted">{x.review_hold_reason}</p></td>
                  <td className="tabular">{naira(x.amount_due_kobo)}</td>
                  <td className="cell-action"><Link to={`/holds/${x.id}`} className="nh-btn nh-btn-secondary nh-btn-sm">Open</Link></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {q.locked.length || q.stuck.length || q.failed.length ? (
        <section className="panel" id="alerts" aria-labelledby="alerts-title">
          <div className="panel-head"><h2 id="alerts-title" className="title">Other alerts</h2></div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Other alerts (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Alert</th><th>Deal</th><th>Detail</th></tr></thead>
              <tbody>
                {q.locked.map((x: any) => <tr key={"l" + x.id}><td>Locked release code</td><td>{x.title}</td><td>Locked until {when(new Date(x.locked_until))}</td></tr>)}
                {q.stuck.map((x: any) => <tr key={"s" + x.id}><td>Stuck deal</td><td>{x.title}</td><td>{x.state === "held" ? `Held past the hand-over deadline (${when(new Date(x.handover_due_at))})` : "Released, payout not confirmed"}</td></tr>)}
                {q.failed.map((x: any) => <tr key={"f" + x.id}><td>Failed {x.kind}</td><td className="tabular">{naira(x.amount_kobo)}</td><td>{x.failure_reason}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
