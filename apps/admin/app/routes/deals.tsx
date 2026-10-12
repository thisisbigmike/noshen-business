import { Form, Link, useNavigate } from "react-router";
import type { Route } from "./+types/deals";
import { requireStaff, withApp } from "../../server/web";
import { staffDeals } from "@noshen/engine/queries";
import { Icon } from "@noshen/ui/ui";
import { photoUrl } from "@noshen/shared/photos";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { ago } from "@noshen/shared/time";
import { DEAL_STATE, StatePill } from "../lib/labels";

export const meta = () => [{ title: "Deals · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  const url = new URL(request.url);
  const f = { q: url.searchParams.get("q") ?? "", state: url.searchParams.get("state") ?? "", flag: url.searchParams.get("flag") ?? "" };
  return { ...(await withApp((d) => staffDeals(d.db, f))), f };
}

const STATES = ["", "requested", "accepted", "held", "disputed", "released", "paid_out", "refunded", "declined"];
const FLAGS: [string, string][] = [["holds", "Review holds"], ["disputes", "Open disputes"], ["locked", "Locked codes"], ["stuck", "Stuck"], ["failed", "Failed payouts"]];

export default function Deals({ loaderData: { rows, counts, f } }: Route.ComponentProps) {
  const navigate = useNavigate();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const href = (next: Partial<typeof f>) => {
    const p = new URLSearchParams();
    const m = { ...f, ...next };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/deals?${s}` : "/deals";
  };
  const flagLabel = FLAGS.find(([k]) => k === f.flag)?.[1];
  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">Deals</h1>
          <p className="body muted">Every deal, newest first. Open one to see its money, history and chat, and to act on it.</p>
        </div>
      </header>

      <Form method="get" className="console-filters" role="search">
        {f.state ? <input type="hidden" name="state" value={f.state} /> : null}
        {f.flag ? <input type="hidden" name="flag" value={f.flag} /> : null}
        <label className="search-pill">
          <Icon name="search" size={20} />
          <span className="sr-only">Search deals</span>
          <input type="search" name="q" defaultValue={f.q} placeholder="Item, person, email or deal number" />
        </label>
        <button type="submit" className="nh-btn nh-btn-primary nh-btn-md nh-btn-pill">Search</button>
      </Form>

      <div className="stack">
        <nav className="chips" aria-label="Deal state">
          {STATES.map((s) => (
            <Link key={s || "all"} to={href({ state: s, flag: "" })} className="chip" aria-current={f.state === s && !f.flag ? "true" : undefined} replace>
              {s ? DEAL_STATE[s].label : "All"}<span className="chip-count">{s ? counts[s] ?? 0 : total}</span>
            </Link>
          ))}
        </nav>
        <nav className="chips" aria-label="Needs attention">
          {FLAGS.map(([k, label]) => (
            <Link key={k} to={href({ flag: f.flag === k ? "" : k, state: "" })} className="chip" aria-current={f.flag === k ? "true" : undefined} replace>
              <Icon name="alert-triangle" size={16} />{label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="panel" aria-label="Deals">
        <div className="panel-head"><p className="caption muted">
          {rows.length === 200 ? "Showing the newest 200. Search or filter to narrow it down." : `${rows.length} deal${rows.length === 1 ? "" : "s"}`}
          {f.state ? ` · ${DEAL_STATE[f.state]?.label}` : ""}{flagLabel ? ` · ${flagLabel}` : ""}{f.q ? ` matching "${f.q}"` : ""}
        </p></div>
        {rows.length === 0 ? (
          <div className="empty-mini"><Icon name="receipt" size={28} /><p className="label">No deals here</p><p className="caption muted">Try another filter, or clear the search.</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Deals (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Deal</th><th>Amount</th><th>State</th><th>Started</th><th className="cell-action"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{rows.map((x: any) => (
                <tr key={x.id} className="row-link" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) navigate(`/deals/${x.id}`); }}>
                  <td>
                    <div className="cell-listing">
                      <span className="thumb">{x.photo_keys?.[0] ? <img src={photoUrl(x.photo_keys[0])} alt="" loading="lazy" /> : <Icon name="photo" size={20} />}</span>
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/deals/${x.id}`} className="body ink-link">{x.title}</Link>
                        <p className="caption muted">
                          <Link to={`/users/${x.buyer_id}`} className="muted-link">{firstName(x.buyer ?? "Buyer")}</Link> buying from <Link to={`/users/${x.seller_id}`} className="muted-link">{firstName(x.seller ?? "Seller")}</Link>
                          {" · "}{String(x.id).slice(0, 8).toUpperCase()}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="tabular">{naira(x.amount_due_kobo)}{x.paid_with === "crypto" ? <p className="caption muted">Paid in crypto</p> : null}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <StatePill map={DEAL_STATE} value={x.state} />
                      {x.review_hold ? <span className="st-pill warn">Review hold</span> : null}
                      {x.dispute_state && x.dispute_state !== "decided" ? <span className="st-pill bad">Dispute</span> : null}
                    </div>
                  </td>
                  <td className="caption" style={{ whiteSpace: "nowrap" }}>{ago(x.created_at)}</td>
                  <td className="cell-action"><Link to={`/deals/${x.id}`} className="nh-btn nh-btn-secondary nh-btn-sm" prefetch="intent">Open</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
