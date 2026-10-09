import { useEffect, useState } from "react";
import { Form, Link, data, redirect, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/deal";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { acceptDeal, cancelDeal, confirmReceived, declineDeal, markDelivered, rate, sendMessage } from "../../server/engine/deals";
import { disputeReasonLabel } from "../../server/engine/disputes";
import { BottomAction, Button, ErrorText, Icon, Info, Kv, MoneyStatus, TextArea, Timeline, TopBar } from "../components/ui";
import { dealSteps, dealText } from "../lib/deal-text";
import { naira } from "../../shared/money";
import { firstName, isOpen } from "../../shared/deal";
import { when } from "../../shared/time";
import { photoUrl } from "../../shared/photos";

export const handle = { tabs: false };
export const meta: Route.MetaFunction = ({ loaderData: d }) => [{ title: d ? `Deal with ${firstName(d.otherName)} · NosHen` : "Deal · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || (v.deal.buyer_id !== user.id && v.deal.seller_id !== user.id)) throw data("This deal isn't yours.", { status: 404 });
    const role = v.deal.buyer_id === user.id ? ("buyer" as const) : ("seller" as const);
    const paid = v.payments.reduce((s: number, p: any) => s + Number(p.amount_kobo), 0);
    return {
      me: user.id, role, paid,
      deal: v.deal, listing: { id: v.listing.id, title: v.listing.title, category: v.listing.category, area: v.listing.area, photo: v.listing.photo_keys?.[0] ?? null },
      names: { buyer: v.buyer.name, seller: v.seller.name }, otherName: role === "buyer" ? v.seller.name : v.buyer.name,
      events: v.events, messages: v.messages, dispute: v.dispute, evidence: v.evidence, ratings: v.ratings,
      bankLast4: role === "seller" ? v.sellerBank?.account_last4 ?? null : null,
      myRating: v.ratings.find((r: any) => r.rater_id === user.id) ?? null,
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      switch (intent) {
        case "accept": return acceptDeal(d, user.id, params.id);
        case "decline": return declineDeal(d, user.id, params.id);
        case "cancel": return cancelDeal(d, user.id, params.id);
        case "delivered": return markDelivered(d, user.id, params.id);
        case "received": return confirmReceived(d, user.id, params.id);
        case "message": return sendMessage(d, user.id, params.id, String(form.get("body") ?? ""));
        case "rate": return rate(d, user.id, params.id, Number(form.get("stars")), String(form.get("comment") ?? ""));
      }
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
  return intent === "message" ? { ok: true, intent } : redirect(`/d/${params.id}`);
}

export default function Deal({ loaderData: x, actionData }: Route.ComponentProps) {
  const { deal, role, names, listing } = x;
  const busy = useNavigation().state !== "idle";
  const [cancelOpen, setCancelOpen] = useState(false);
  const other = firstName(x.otherName);
  const t = dealText(deal, role, names, x.paid, { decisionDue: x.dispute?.decision_due_at, evidenceDue: x.dispute?.evidence_due_at, bankLast4: x.bankLast4 });
  const steps = dealSteps(deal, role, names, x.events, x.dispute);

  // Keep the page current while waiting on the other person or the bank.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isOpen(deal.state)) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, 10_000);
    return () => clearInterval(id);
  }, [deal.state]);

  const canCancel = (deal.state === "requested" || deal.state === "accepted" || (deal.state === "held" && !deal.delivered_at));
  const actions = actionsFor(x, other, () => setCancelOpen(true), canCancel);

  return (
    <div>
      <TopBar title={`Deal with ${other}`} back="/deals" />
      <main className="page no-tabs">
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/deals">Deals</Link> / {role === "buyer" ? "Buying" : "Selling"} / {listing.title}</nav>
        <div className="two-col">
          <div className="stack-4">
            <section className="card stack" aria-label="Where the money is">
              <div className="row-between wrap">
                <MoneyStatus state={t.chip.state}>{t.chip.word}</MoneyStatus>
                {t.deadline ? <span className="caption muted row"><Icon name="clock" size={16} />{t.deadline}</span> : null}
              </div>
              <p className="big-amount">{naira(t.amountKobo)}{t.amountSuffix ? ` ${t.amountSuffix}` : ""}</p>
              <p className="body muted">{listing.title} · {other} · {deal.handover === "meetup" ? "Meet-up" : "Delivery"}</p>
              <p className="body">{t.next}</p>
            </section>

            {deal.state === "held" && !deal.review_hold && role === "buyer" ? (
              <Info icon="lock">Our licensed partner holds your money. {other} can't get it until you {deal.handover === "meetup" ? "give your code" : "confirm you received it"}. If something is wrong, report it and the money stays held.</Info>
            ) : null}
            {deal.state === "held" && role === "seller" ? (
              <section className="card">
                <Kv k={`${firstName(names.buyer)} paid`} v={naira(x.paid)} />
                <Kv k={`NosHen fee, paid by ${deal.fee_payer === "buyer" ? firstName(names.buyer) : "you"}`} v={naira(deal.fee_kobo)} />
                <Kv k="You get" v={naira(deal.seller_share_kobo)} total />
                {x.bankLast4 ? <Kv k="Paid to" v={`Your bank ••${x.bankLast4}`} /> : null}
              </section>
            ) : null}
            {deal.state === "held" && role === "seller" && deal.handover === "meetup" ? (
              <Info icon="shield-lock">Only {firstName(names.buyer)}'s phone shows the code. Nobody from NosHen will ever ask you for it.</Info>
            ) : null}

            {x.dispute ? <DisputeSummary x={x} /> : null}

            {(deal.state === "released" || deal.state === "paid_out") ? <RateBox x={x} other={other} busy={busy} error={actionData?.intent === "rate" ? actionData.error : undefined} /> : null}

            <ErrorText>{actionData && actionData.intent !== "message" && actionData.intent !== "rate" ? (actionData as any).error : null}</ErrorText>
            {actions.length ? <div className="desktop-only stack">{actions}</div> : null}

            <section className="card stack-4" aria-labelledby="steps">
              <h2 id="steps" className="label muted">Deal steps</h2>
              <Timeline steps={steps} />
            </section>
          </div>
          <aside className="side">
            <Chat x={x} other={other} busy={busy} error={actionData?.intent === "message" ? (actionData as any).error : undefined} />
          </aside>
        </div>
      </main>
      {actions.length ? <div className="mobile-only"><BottomAction staticOnDesktop={false}>{actions}</BottomAction></div> : null}

      {cancelOpen ? (
        <div className="sheet-backdrop" onClick={() => setCancelOpen(false)}>
          <Form method="post" className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="cancel-title">
            <input type="hidden" name="intent" value="cancel" />
            <h2 id="cancel-title" className="heading">Cancel this deal?</h2>
            <p className="body">{deal.state === "held"
              ? (role === "buyer" ? `You get all ${naira(x.paid)} back, fee included, to the account you paid from.` : `${firstName(names.buyer)} gets all their money back. You won't be paid for this deal.`)
              : "Nothing has been paid, so there's nothing to refund."}</p>
            <Button type="submit" variant="danger" size="lg" block disabled={busy}>Cancel deal</Button>
            <Button size="lg" block onClick={() => setCancelOpen(false)}>Keep the deal</Button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

type View = Route.ComponentProps["loaderData"];

function actionsFor(x: View, other: string, openCancel: () => void, canCancel: boolean) {
  const { deal, role } = x;
  const out: React.ReactNode[] = [];
  const post = (intent: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary") => (
    <Form method="post" key={intent}><input type="hidden" name="intent" value={intent} /><Button type="submit" variant={variant} size={variant === "primary" ? "lg" : "md"} block>{label}</Button></Form>
  );
  const cancel = canCancel ? <Button key="cancel" block onClick={openCancel}>{deal.state === "requested" && role === "buyer" ? "Cancel request" : "Cancel deal"}</Button> : null;
  if (deal.state === "requested") {
    if (role === "seller") out.push(post("accept", "Accept request", "primary"), post("decline", "Decline"));
    else out.push(cancel);
  } else if (deal.state === "accepted") {
    if (role === "buyer") out.push(<Button key="pay" variant="primary" size="lg" block to={`/d/${deal.id}/pay`}>Pay {naira(deal.amount_due_kobo)}</Button>);
    out.push(cancel);
  } else if (deal.state === "held" && !deal.review_hold) {
    if (deal.handover === "meetup") {
      if (role === "buyer") out.push(<Button key="code" variant="primary" size="lg" block icon="lock" to={`/d/${deal.id}/code`}>Show release code</Button>,
        <Button key="report" block to={`/d/${deal.id}/report`}>Report a problem</Button>);
      else out.push(<Button key="enter" variant="primary" size="lg" block to={`/d/${deal.id}/enter-code`}>Enter release code</Button>);
      out.push(cancel);
    } else if (!deal.delivered_at) {
      if (role === "seller") out.push(post("delivered", "Mark delivered", "primary"));
      out.push(cancel);
    } else if (role === "buyer") {
      out.push(post("received", "I received it: release the money", "primary"), <Button key="report" block to={`/d/${deal.id}/report`}>Report a problem</Button>);
    }
  } else if (deal.state === "disputed" && x.dispute?.state === "collecting_evidence") {
    out.push(<Button key="ev" variant="primary" size="lg" block to={`/d/${deal.id}/evidence`}>Add photos or notes</Button>);
  } else if ((deal.state === "released" || deal.state === "paid_out") && role === "seller") {
    out.push(<Button key="sell" block to="/sell">Sell something else</Button>);
  }
  return out.filter(Boolean);
}

function DisputeSummary({ x }: { x: View }) {
  const d = x.dispute!;
  const decided = d.state === "decided";
  return (
    <section className="card stack" aria-label="The problem reported">
      <p className="label muted">{x.role === "buyer" ? "Your report" : `${firstName(x.names.buyer)}'s report`}</p>
      <p className="title">{disputeReasonLabel(d.reason)}</p>
      {d.description ? <p className="body">{d.description}</p> : null}
      <p className="caption muted">{when(new Date(d.created_at))} · {x.evidence.length} piece{x.evidence.length === 1 ? "" : "s"} of evidence</p>
      {x.evidence.length ? (
        <div className="photo-grid">
          {x.evidence.map((e: any, i: number) => e.file_key
            ? <div key={i} className="photo-slot"><img src={photoUrl(e.file_key)} alt="Evidence photo" /></div>
            : <div key={i} className="photo-slot" style={{ padding: 8, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", color: "var(--ink)" }}>{e.note}</div>)}
        </div>
      ) : null}
      {decided ? (
        <Info icon="scale">Decision: {d.decision === "refund_buyer" ? "refunded to the buyer" : "released to the seller"}. Reason: {d.decision_reason}</Info>
      ) : (
        <p className="caption muted">If the item isn't as listed, the buyer is refunded in full. If it is, the money is released to the seller.</p>
      )}
    </section>
  );
}

function RateBox({ x, other, busy, error }: { x: View; other: string; busy: boolean; error?: string }) {
  const [stars, setStars] = useState<number>(x.myRating?.stars ?? 0);
  if (x.myRating) return <Info icon="star">You rated {other} {x.myRating.stars} star{x.myRating.stars > 1 ? "s" : ""}. Thank you.</Info>;
  const labels = ["Tap a star", "Poor", "Not great", "Okay", "Good", "Very good"];
  return (
    <Form method="post" className="card stack">
      <input type="hidden" name="intent" value="rate" />
      <p className="title">How was {other}?</p>
      <p className="caption muted">Your rating helps other {x.role === "buyer" ? "buyers" : "sellers"} decide.</p>
      <div className="stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} aria-label={`${n} star${n > 1 ? "s" : ""}`}>
            <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} />
            <svg width="32" height="32" viewBox="0 0 24 24" fill={n <= stars ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
            </svg>
          </label>
        ))}
      </div>
      <p className="caption muted">{labels[stars]}</p>
      <TextArea label="Anything to add? (optional)" name="comment" maxLength={500} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" block disabled={busy || !stars}>Rate {other}</Button>
    </Form>
  );
}

function Chat({ x, other, busy, error }: { x: View; other: string; busy: boolean; error?: string }) {
  const open = isOpen(x.deal.state);
  const flagged = x.messages.some((m: any) => m.flagged);
  return (
    <section className="card stack-4" id="chat" aria-labelledby="chat-title">
      <div className="row"><span className="avatar" aria-hidden="true">{other[0]}</span><div><h2 id="chat-title" className="title">{other}</h2><p className="caption muted">Keep everything about this deal in this chat.</p></div></div>
      <div className="chat" aria-live="polite">
        {x.messages.length === 0 ? <p className="caption muted">No messages yet.</p> : null}
        {x.messages.map((m: any) => (
          <div key={m.id} className={`bubble ${m.sender_id === x.me ? "mine" : ""} ${m.flagged ? "flagged" : ""}`}>
            <p className="body">{m.body}</p>
            <p className="caption muted">{when(new Date(m.at))}</p>
          </div>
        ))}
      </div>
      {flagged ? <Info icon="alert-triangle" tone="warn"><strong>Only pay through NosHen.</strong> Money sent straight to someone's account isn't protected. If something goes wrong, we can't get it back for you.</Info> : null}
      {open ? (
        <Form method="post" className="chat-form" key={x.messages.length}>
          <input type="hidden" name="intent" value="message" />
          <label className="sr-only" htmlFor="body">Message {other}</label>
          <input id="body" name="body" className="nh-input grow" placeholder={`Message ${other}`} maxLength={2000} autoComplete="off" required />
          <Button type="submit" icon="send" disabled={busy}>Send</Button>
        </Form>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

