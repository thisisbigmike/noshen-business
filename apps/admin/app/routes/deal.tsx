import { Link, data } from "react-router";
import type { Route } from "./+types/deal";
import { messageOf, requireStaff, withApp } from "../../server/web";
import { staffDeal } from "@noshen/engine/queries";
import { explorerLink } from "@noshen/engine/stablecoins";
import { checkDeadlinesNow, giveMoreTime, noteToBoth, openDisputeForBuyer, retryTransfer, staffCancel, staffRefund, staffRelease, unlockReleaseCode } from "@noshen/engine/staff";
import { Icon, Info, Kv, Select } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { DISPUTE_REASONS, disputeReasonLabel, firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { photoUrl } from "@noshen/shared/photos";
import { placeLabel } from "@noshen/shared/locations";
import { coinAmount, cryptoLabel, isCoin, isNetwork } from "@noshen/shared/payments";
import { ACCOUNT_STATUS, DEAL_STATE, StatePill, TRANSFER_STATUS, actionLabel } from "../lib/labels";
import { ReasonAction, type ActionResult } from "../lib/reason-action";

export const meta: Route.MetaFunction = ({ loaderData: v }) => [{ title: `${v ? v.listing.title : "Deal"} · NosHen staff` }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const staff = await requireStaff(request);
  const v = await withApp(async (d) => {
    const found = await staffDeal(d.db, params.id);
    if (!found) return null;
    // Links to the network's explorer for coin paid, addresses, and coin collected at release (Solana).
    const collected = found.events.filter((e: any) => e.type === "coin_collected");
    return {
      ...found,
      payments: found.payments.map((p: any) => ({ ...p, tx_url: p.method === "crypto" ? explorerLink(d, p.network, "tx", p.tx_hash) : null })),
      deposits: found.deposits.map((c: any) => ({ ...c, address_url: explorerLink(d, c.network, "address", c.address) })),
      collected: collected.map((e: any) => ({ at: e.at, url: explorerLink(d, e.payload?.network, "tx", e.payload?.tx) })),
    };
  });
  if (!v) throw data("Not found", { status: 404 });
  const stuck = (v.deal.state === "held" && v.deal.handover_due_at && new Date(v.deal.handover_due_at).getTime() < Date.now() - 3_600_000)
    || (v.deal.state === "released" && new Date(v.deal.state_changed_at).getTime() < Date.now() - 3_600_000);
  return { ...v, stuck, isAdmin: staff.role === "admin" };
}

export async function action({ request, params }: Route.ActionArgs): Promise<ActionResult> {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const intent = String(f.get("intent"));
  const reason = String(f.get("reason") ?? "");
  try {
    if (intent === "unlock") {
      await withApp((d) => unlockReleaseCode(d, staff, params.id, reason));
      return { ok: true, intent, message: "Unlocked. The seller has been told they can try the code again." };
    }
    if (intent === "retry") {
      await withApp((d) => retryTransfer(d, staff, String(f.get("transfer")), reason));
      return { ok: true, intent, message: "Sent again. Its status below updates when the bank answers." };
    }
    if (intent === "refund") {
      await withApp((d) => staffRefund(d, staff, params.id, reason));
      return { ok: true, intent, message: "Refunded. The money is on its way back to the buyer, and both have been told." };
    }
    if (intent === "release") {
      await withApp((d) => staffRelease(d, staff, params.id, reason));
      return { ok: true, intent, message: "Released. The seller's payout has started, and both have been told." };
    }
    if (intent === "time") {
      const due = await withApp((d) => giveMoreTime(d, staff, params.id, Number(f.get("days")), reason));
      return { ok: true, intent, message: `New deadline: ${when(due)}. Both have been told.` };
    }
    if (intent === "dispute") {
      await withApp((d) => openDisputeForBuyer(d, staff, params.id, String(f.get("problem")), reason));
      return { ok: true, intent, message: "Dispute opened. The money is frozen, and both can add photos and notes." };
    }
    if (intent === "cancel") {
      await withApp((d) => staffCancel(d, staff, params.id, reason));
      return { ok: true, intent, message: "Cancelled. Both have been told." };
    }
    if (intent === "note") {
      await withApp((d) => noteToBoth(d, staff, params.id, reason));
      return { ok: true, intent, message: "Sent. It's in both people's alerts." };
    }
    if (intent === "check") {
      const done = await withApp((d) => checkDeadlinesNow(d, staff, params.id));
      return { ok: true, intent, message: done.length ? `Done: ${done.join("; ")}.` : "Checked: no deadline has passed that needs action." };
    }
    return { ok: false, intent, error: "Unknown action." };
  } catch (e) {
    return { ok: false, intent, error: messageOf(e) };
  }
}

const EVENT_TEXT: Record<string, string> = {
  requested: "Buy request sent", accepted: "Seller accepted", held: "Payment held", disputed: "Problem reported: money frozen",
  released: "Released to the seller", paid_out: "Paid out", refunded: "Refunded to the buyer", declined: "Ended",
};

export default function StaffDeal({ loaderData: v }: Route.ComponentProps) {
  const { deal, listing, dispute, code } = v;
  const buyer = firstName(v.buyer.name), seller = firstName(v.seller.name);
  const who = (actor: string) => actor === "buyer" ? buyer : actor === "seller" ? seller : actor === "partner" ? "Payment partner" : actor === "staff" ? "NosHen staff" : "NosHen";
  const locked = code?.locked_until && new Date(code.locked_until) > new Date();
  const failed = v.transfers.filter((t: any) => t.status === "failed");
  const flagged = v.messages.filter((m: any) => m.flagged).length;
  const held = v.payments.filter((p: any) => !p.sent_back).reduce((n: number, p: any) => n + Number(p.amount_kobo), 0);
  const open = ["requested", "accepted", "held", "disputed"].includes(deal.state);
  const deadline: [string, string | null] | null = deal.state === "requested" ? ["Seller answers by", deal.request_expires_at]
    : deal.state === "accepted" ? ["Buyer pays by", deal.payment_due_at]
    : deal.state === "held" && deal.delivered_at ? ["Buyer checks the delivery by", deal.release_due_at]
    : deal.state === "held" ? ["Hand-over by", deal.handover_due_at] : null;

  return (
    <>
      <nav className="caption muted" aria-label="Breadcrumb"><Link to="/">Dashboard</Link> / <Link to="/deals">Deals</Link> / {String(deal.id).slice(0, 8).toUpperCase()}</nav>
      <header className="console-head">
        <div className="cell-listing" style={{ minWidth: 0 }}>
          <span className="thumb lg">{listing.photo_keys?.[0] ? <img src={photoUrl(listing.photo_keys[0])} alt="" /> : <Icon name="photo" size={24} />}</span>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <h1 className="heading">{listing.title}</h1>
            <div className="row wrap" style={{ gap: 8 }}>
              <StatePill map={DEAL_STATE} value={deal.state} />
              {deal.review_hold ? <span className="st-pill warn">Review hold</span> : null}
              <span className="caption muted">{naira(deal.amount_due_kobo)} · {deal.handover === "meetup" ? "Meet-up" : "Delivery"} · {placeLabel(listing.area, listing.state)} · started {when(new Date(deal.created_at))}</span>
            </div>
          </div>
        </div>
      </header>

      {deal.review_hold ? (
        <Info icon="alert-triangle" tone="warn"><strong>Held for review:</strong> {deal.review_hold_reason}. <Link to={`/holds/${deal.id}`}>Review the payment and decide</Link></Info>
      ) : null}
      {dispute && dispute.state !== "decided" ? (
        <Info icon="scale" tone="danger"><strong>Dispute open:</strong> {disputeReasonLabel(dispute.reason)}. Decide by {when(new Date(dispute.decision_due_at))}. <Link to={`/disputes/${dispute.id}`}>Open the dispute</Link></Info>
      ) : dispute ? (
        <Info icon="scale">Dispute decided: {dispute.decision === "refund_buyer" ? "refunded to the buyer" : "released to the seller"}. <Link to={`/disputes/${dispute.id}`}>See the decision</Link></Info>
      ) : null}

      <div className="detail-grid">
        <div className="stack-4">
          <section className="panel" aria-labelledby="people-title">
            <h2 id="people-title" className="title">People</h2>
            <div className="people-pair">
              {[["Buyer", v.buyerUser], ["Seller", v.sellerUser]].map(([role, u]: any) => (
                <Link key={role} to={`/users/${u.id}`} className="person-card">
                  <span className="caption muted">{role}</span>
                  <span className="label">{u.full_name ?? "No name yet"}</span>
                  <span className="caption muted truncate">{u.email}</span>
                  {u.status !== "active" ? <StatePill map={ACCOUNT_STATUS} value={u.status} /> : null}
                </Link>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="money-title">
            <h2 id="money-title" className="title">Money</h2>
            <div>
              <Kv k="Price" v={naira(deal.price_kobo)} />
              <Kv k={`NosHen fee (paid by the ${deal.fee_payer})`} v={naira(deal.fee_kobo)} />
              <Kv k="Buyer pays" v={naira(deal.amount_due_kobo)} />
              <Kv k="Seller gets" v={naira(deal.seller_share_kobo)} total />
            </div>
            <p className="label">Payments in</p>
            {v.payments.length === 0 ? <p className="caption muted">Nothing paid yet.</p> : v.payments.map((p: any, i: number) => (
              <div key={i} className="money-row">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="body">{naira(p.amount_kobo)} {p.method === "crypto" && isCoin(p.coin) && isNetwork(p.network)
                    ? <span className="caption muted">· {coinAmount(p.amount_coin_micro, p.coin)}, {cryptoLabel(p.coin, p.network)}</span>
                    : <span className="caption muted">· bank transfer from {p.sender_name ?? "unknown"}</span>}</span>
                  <span className="caption muted">{when(new Date(p.received_at))}{p.tx_hash ? <> · {p.tx_url ? <a className="mono-sm" href={p.tx_url} target="_blank" rel="noreferrer">tx {String(p.tx_hash).slice(0, 18)}…</a> : <span className="mono-sm">tx {String(p.tx_hash).slice(0, 18)}…</span>}</> : null}</span>
                </div>
                <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {p.sent_back ? <span className="st-pill muted">Sent back</span> : null}
                  {!p.matches_amount_due ? <span className="st-pill bad">Wrong amount</span> : null}
                  {p.matches_buyer_name === false ? <span className="st-pill warn">Name differs</span> : null}
                </div>
              </div>
            ))}
            <p className="label">Payouts and refunds</p>
            {v.transfers.length === 0 ? <p className="caption muted">Nothing sent yet.</p> : v.transfers.map((t: any) => (
              <div key={t.id} className="money-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span className="body">{t.kind === "payout" ? "Payout to the seller" : "Refund to the buyer"} · {naira(t.amount_kobo)}</span>
                  <span className="caption muted">{when(new Date(t.created_at))}{t.failure_reason ? ` · ${t.failure_reason}` : ""}</span>
                </div>
                <StatePill map={TRANSFER_STATUS} value={t.status} />
              </div>
            ))}
            {v.collected.length ? (
              <p className="caption">Coin moved to NosHen's wallet at release: {v.collected.map((c: any, i: number) => c.url
                ? <a key={i} href={c.url} target="_blank" rel="noreferrer">see the transaction</a> : <span key={i}>recorded</span>)}</p>
            ) : null}
            {v.deposits.length ? (
              <>
                <p className="label">Crypto addresses opened</p>
                {v.deposits.map((c: any, i: number) => (
                  <div key={i} className="money-row">
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="body">{isCoin(c.coin) && isNetwork(c.network) ? cryptoLabel(c.coin, c.network) : c.coin}: {isCoin(c.coin) ? coinAmount(c.amount_micro, c.coin) : c.amount_micro}</span>
                      {c.address_url ? <a className="caption mono-sm truncate" href={c.address_url} target="_blank" rel="noreferrer">{c.address}</a> : <span className="caption muted mono-sm truncate">{c.address}</span>}
                    </div>
                    <span className="caption muted">{c.refund_address_last4 ? `Refunds to ••${c.refund_address_last4}` : "No refund address yet"}</span>
                  </div>
                ))}
              </>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="chat-title">
            <div className="panel-head"><h2 id="chat-title" className="title">Chat</h2>{flagged ? <span className="st-pill warn">{flagged} flagged</span> : null}</div>
            {v.messages.length === 0 ? <p className="caption muted">No messages.</p> : (
              <div className="chat staff-chat">
                {v.messages.map((m: any) => (
                  <div key={m.id} className={`bubble${m.sender_id === deal.seller_id ? " mine" : ""}${m.flagged ? " flagged" : ""}`}>
                    <p className="caption muted">{m.sender_id === deal.buyer_id ? buyer : seller} · {when(new Date(m.at))}{m.flagged ? " · flagged: payment outside NosHen?" : ""}</p>
                    <p className="body">{m.body}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="stack-4">
          {locked || failed.length || v.stuck ? (
            <section className="panel" aria-labelledby="act-title">
              <h2 id="act-title" className="title">Needs you</h2>
              {locked ? (
                <ReasonAction intent="unlock" label="Unlock the release code"
                  help={`Locked after ${code.failed_attempts || 5} wrong tries, until ${when(new Date(code.locked_until))}. Unlock it if the people are together and the buyer is reading the code out.`} />
              ) : null}
              {failed.map((t: any) => (
                <ReasonAction key={t.id} intent="retry" hidden={{ transfer: t.id }} label={`Send the ${t.kind} again`}
                  help={`${naira(t.amount_kobo)} ${t.kind === "payout" ? "to the seller" : "to the buyer"} failed: ${t.failure_reason ?? "no reason given"}. ${t.kind === "payout" ? "It goes to the seller's bank account as it is now." : ""}`} />
              ))}
              {v.stuck ? (
                <ReasonAction intent="check" label="Check its deadlines now"
                  help="This deal is past a deadline. Checking acts on it straight away (for example, telling the buyer they can cancel) instead of waiting for the next 15-minute check." confirmLabel="Check now" />
              ) : null}
            </section>
          ) : null}

          {open ? (
            <section className="panel" aria-labelledby="work-title">
              <h2 id="work-title" className="title">Work on this deal</h2>
              {deadline?.[1] ? <Kv k={deadline[0]} v={when(new Date(deadline[1]))} /> : null}
              {deal.state === "disputed" && dispute ? (
                <p className="caption muted">The money is frozen by a dispute. <Link to={`/disputes/${dispute.id}`}>Decide it from the dispute</Link>.</p>
              ) : null}
              {deal.state === "held" && deal.review_hold ? (
                <p className="caption muted">The payment is held for review. <Link to={`/holds/${deal.id}`}>Clear the hold or send the money back</Link> before it can be released.</p>
              ) : null}
              {deal.state === "accepted" || deal.state === "held" ? (
                <ReasonAction intent="time" confirmLabel="Give more time"
                  label={deal.state === "accepted" ? "Give more time to pay" : deal.delivered_at ? "Give the buyer more time to check" : "Give more time for the hand-over"}
                  help="Added to the current deadline, or to now if it has passed. Both people are told the new time.">
                  <Select name="days" label="How much more" defaultValue="1" options={[{ value: "1", label: "1 day" }, { value: "2", label: "2 days" }, { value: "3", label: "3 days" }]} />
                </ReasonAction>
              ) : null}
              {deal.state === "held" ? (
                <ReasonAction intent="dispute" confirmLabel="Open the dispute" label="Open a dispute for the buyer"
                  help="When the buyer reports a problem to support, for example by phone. The money freezes at once, both people can add photos and notes, then a reviewer decides."
                  reasonLabel="What the buyer told you" reasonHint="Saved as the buyer's description of the problem, and in the audit log.">
                  <Select name="problem" label="What's wrong" options={DISPUTE_REASONS.map(([value, label]) => ({ value, label }))} />
                </ReasonAction>
              ) : null}
              {deal.state === "held" ? (
                <ReasonAction intent="refund" danger confirmLabel={`Refund ${naira(held)}`} label="Refund the buyer"
                  help={`Sends ${naira(held)} back to where it came from and closes the deal. For when the seller can't hand over, or both agree to stop.`}
                  reasonHint="Both people see this. It's kept in the audit log with your name." />
              ) : null}
              {deal.state === "held" && !deal.review_hold ? (v.isAdmin ? (
                <ReasonAction intent="release" danger confirmLabel={`Release ${naira(deal.seller_share_kobo)}`} label="Release to the seller"
                  help="For when the buyer has told NosHen they have the item but can't confirm in the app. The payout starts at once and can't be undone."
                  reasonHint="Both people see this. It's kept in the audit log with your name." />
              ) : (
                <p className="caption muted">Releasing to the seller outside a dispute needs an admin.</p>
              )) : null}
              {deal.state === "requested" || deal.state === "accepted" ? (
                <ReasonAction intent="cancel" danger confirmLabel="Cancel the deal" label="Cancel the deal"
                  help="Nothing is held yet. The deal ends and both people are told. Money that arrives later goes back to whoever sent it."
                  reasonHint="Both people see this. It's kept in the audit log with your name." />
              ) : null}
              <ReasonAction intent="note" confirmLabel="Send" label="Send both a note"
                help="Goes to the buyer and seller as a message from NosHen, in their alerts and on their phones."
                reasonLabel="Note" reasonHint="Both people see this exactly as written." />
            </section>
          ) : null}

          <section className="panel" aria-labelledby="time-title">
            <h2 id="time-title" className="title">What happened</h2>
            <ol className="timeline">
              {v.events.filter((e: any) => e.to_state || e.type !== "state_changed").map((e: any, i: number) => (
                <li key={i} className="done">
                  <span className="dot"><Icon name="check" size={12} /></span>
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="body">{e.to_state ? EVENT_TEXT[e.to_state] ?? e.to_state : e.type.replace(/_/g, " ")}</span>
                    <span className="caption muted">{when(new Date(e.at))} · {who(e.actor)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel" aria-labelledby="staff-title">
            <div className="panel-head"><h2 id="staff-title" className="title">Staff actions</h2><Link to={`/audit?target=${deal.id}`} className="caption">In the audit log</Link></div>
            {v.actions.length === 0 ? <p className="caption muted">None yet.</p> : v.actions.map((a: any, i: number) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <span className="label">{actionLabel(a.action)}</span>
                <span className="caption muted">{a.name} · {when(new Date(a.at))}</span>
                <span className="caption">{a.reason}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
