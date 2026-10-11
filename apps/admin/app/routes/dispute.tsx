import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/dispute";
import { requireStaff, withApp, messageOf } from "../../server/web";
import { disputeReview } from "@noshen/engine/queries";
import { decideDispute } from "@noshen/engine/disputes";
import { Button, ErrorText, Info, Kv, MoneyStatus, TextArea } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { CONDITIONS, disputeReasonLabel, firstName } from "@noshen/shared/deal";
import { left, when } from "@noshen/shared/time";
import { photoUrl } from "@noshen/shared/photos";
import { categoryOf } from "@noshen/shared/categories";
import { placeLabel } from "@noshen/shared/locations";

export const meta = () => [{ title: "Dispute · NosHen staff" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireStaff(request);
  const v = await withApp((d) => disputeReview(d.db, params.id));
  if (!v) throw data("Not found", { status: 404 });
  return v;
}

export async function action({ request, params }: Route.ActionArgs) {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const decision = f.get("decision") === "release_to_seller" ? "release_to_seller" : "refund_buyer";
  try {
    await withApp((d) => decideDispute(d, staff.id, params.id, decision, String(f.get("reason") ?? "")));
  } catch (e) {
    return { error: messageOf(e) };
  }
  return redirect(`/?decided=${encodeURIComponent(decision === "refund_buyer" ? "refund to the buyer" : "release to the seller")}`);
}

const EVENT_TEXT: Record<string, string> = { requested: "Buy request sent", accepted: "Seller accepted", held: "Payment held", disputed: "Problem reported: money frozen", released: "Released", paid_out: "Paid out", refunded: "Refunded", declined: "Declined" };

export default function Dispute({ loaderData: v, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const d = v.dispute;
  const [choice, setChoice] = useState<"refund_buyer" | "release_to_seller" | "">("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const buyer = firstName(v.buyer.name), seller = firstName(v.seller.name);
  const paid = v.payments.filter((p: any) => !p.sent_back).reduce((s: number, p: any) => s + Number(p.amount_kobo), 0);
  const decided = d.state === "decided";
  const evidenceOpen = new Date(d.evidence_due_at) > new Date();
  const who = (id: string | null) => (id === v.deal.buyer_id ? `${buyer} (buyer)` : id === v.deal.seller_id ? `${seller} (seller)` : "NosHen");
  const outcome = choice === "refund_buyer" ? `Refund ${buyer} ${naira(paid)}` : `Release ${naira(v.deal.seller_share_kobo)} to ${seller}`;
  return (
    <>
      <nav className="caption muted" aria-label="Breadcrumb"><Link to="/">Dashboard</Link> / Disputes</nav>
      <header className="stack">
        <p className="caption muted">Deal {v.deal.id.slice(0, 8).toUpperCase()} · {v.deal.handover === "meetup" ? "Meet-up" : "Delivery"} · {placeLabel(v.listing.area, v.listing.state)}</p>
        <h1 className="heading">{v.listing.title}: {buyer} vs {seller}</h1>
        <p className="body">{buyer} reported: “{disputeReasonLabel(d.reason)}{d.description ? `: ${d.description}` : ""}”</p>
        <div className="row wrap" style={{ gap: 16 }}>
          <MoneyStatus state="dispute">Held {naira(paid)}</MoneyStatus>
          <span className="caption">Evidence deadline {when(new Date(d.evidence_due_at))} · {evidenceOpen ? "open" : "passed, evidence is closed"}</span>
          <span className="caption">Decide by {when(new Date(d.decision_due_at))} · <strong>{left(d.decision_due_at)}</strong></span>
        </div>
      </header>
      <div className="three-col">
        <section className="stack-4">
          <div className="card stack">
            <p className="label">Timeline</p>
            {v.events.filter((e: any) => e.to_state || e.type !== "state_changed").map((e: any, i: number) => (
              <div key={i} className="kv" style={{ flexDirection: "column", gap: 0 }}>
                <span className="caption muted">{when(new Date(e.at))} · {e.actor === "buyer" ? buyer : e.actor === "seller" ? seller : e.actor === "partner" ? "Partner bank" : e.actor === "staff" ? "NosHen staff" : "NosHen"}</span>
                <span className="body">{e.to_state ? EVENT_TEXT[e.to_state] ?? e.to_state : e.type.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
          <div className="card stack">
            <p className="label">Listing when bought</p>
            <div className="photo-grid">{(v.listing.photo_keys ?? []).slice(0, 3).map((k: string) => <div key={k} className="photo-slot"><img src={photoUrl(k)} alt="Listing photo" /></div>)}</div>
            <p className="body">{v.listing.title}</p>
            <p className="caption muted">{naira(v.listing.price_kobo)} · {CONDITIONS.find(([c]) => c === v.listing.condition)?.[1]} condition · {placeLabel(v.listing.area, v.listing.state)}</p>
            {v.listing.description ? <p className="body">“{v.listing.description}”</p> : null}
            <Kv k="Category" v={categoryOf(v.listing.category).label} />
            <Kv k={categoryOf(v.listing.category).id?.label.replace(" (optional)", "") ?? "ID number"} v={v.listing.imei_or_serial ?? "—"} />
          </div>
        </section>
        <section className="stack-4">
          <div className="card stack">
            <p className="label">Evidence</p>
            {v.evidence.length === 0 ? <p className="caption muted">No evidence added.</p> : v.evidence.map((e: any, i: number) => (
              <div key={i} className="kv" style={{ flexDirection: "column", gap: 4 }}>
                <span className="caption muted">{who(e.uploader_id)} · {when(new Date(e.at))}</span>
                {e.file_key ? <a href={photoUrl(e.file_key)} target="_blank" rel="noreferrer"><img src={photoUrl(e.file_key)} alt="Evidence" style={{ maxHeight: 180, borderRadius: 8 }} /></a> : null}
                {e.note ? <p className="body">{e.note}</p> : null}
              </div>
            ))}
          </div>
          <div className="card stack">
            <div className="row-between"><p className="label">Deal chat</p>{v.messages.some((m: any) => m.flagged) ? <span className="caption error-text">{v.messages.filter((m: any) => m.flagged).length} flagged</span> : null}</div>
            {v.messages.length === 0 ? <p className="caption muted">No messages.</p> : v.messages.map((m: any) => (
              <div key={m.id} className={`bubble ${m.flagged ? "flagged" : ""}`} style={{ maxWidth: "100%" }}>
                <p className="caption muted">{who(m.sender_id)} · {when(new Date(m.at))}{m.flagged ? " · flagged: payment outside NosHen" : ""}</p>
                <p className="body">{m.body}</p>
              </div>
            ))}
          </div>
        </section>
        <aside className="stack-4">
          {decided ? (
            <Info icon="scale">Decided by {v.decidedBy}: {d.decision === "refund_buyer" ? "refund to the buyer" : "release to the seller"}. Reason: {d.decision_reason}</Info>
          ) : (
            <Form method="post" className="card stack">
              <p className="title">Your decision</p>
              <p className="caption muted">Decide by {when(new Date(d.decision_due_at))}. You can't undo it.</p>
              <label className="choice"><input type="radio" name="decision" value="refund_buyer" checked={choice === "refund_buyer"} onChange={() => setChoice("refund_buyer")} />
                <span className="stack" style={{ gap: 0 }}><span className="body">Refund {buyer} {naira(paid)}</span><span className="caption muted">The full amount, fee included, to the account it came from.</span></span></label>
              <label className="choice"><input type="radio" name="decision" value="release_to_seller" checked={choice === "release_to_seller"} onChange={() => setChoice("release_to_seller")} />
                <span className="stack" style={{ gap: 0 }}><span className="body">Release {naira(v.deal.seller_share_kobo)} to {seller}</span><span className="caption muted">The seller's share; NosHen keeps the fee.</span></span></label>
              <TextArea label="Reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="Both people will see this." maxLength={1000} />
              <ErrorText>{actionData?.error}</ErrorText>
              {confirm ? (
                <div className="stack">
                  <Info icon="alert-triangle" tone="warn">Confirm: {outcome}. Saved to the audit log as your decision.</Info>
                  <Button type="submit" variant="primary" block disabled={busy}>Confirm decision</Button>
                  <Button block onClick={() => setConfirm(false)}>Go back</Button>
                </div>
              ) : (
                <Button variant="primary" block disabled={!choice || reason.trim().length < 5} onClick={() => setConfirm(true)}>Review decision</Button>
              )}
            </Form>
          )}
          {[["Buyer", v.buyer, v.buyerDisputes], ["Seller", v.seller, v.sellerDisputes]].map(([label, p, n]: any) => (
            <div key={label} className="card stack">
              <p className="label">{label}: {p.name}</p>
              <p className="caption muted">{p.idVerified ? "ID verified" : "ID not verified"} · {p.completedDeals} completed sales · rating {p.rating ?? "none yet"} · {n} other dispute{n === 1 ? "" : "s"}</p>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
