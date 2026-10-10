import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/hold";
import { requireStaff, withApp, messageOf } from "../../../server/web";
import { holdReview } from "../../../server/engine/queries";
import { resolveReviewHold } from "../../../server/engine/disputes";
import { Button, ErrorText, Info, MoneyStatus, TextArea } from "../../components/ui";
import { naira } from "../../../shared/money";
import { firstName } from "../../../shared/deal";
import { ago, when } from "../../../shared/time";

export const meta = () => [{ title: "Review hold · NosHen staff" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireStaff(request);
  const v = await withApp((d) => holdReview(d.db, params.id));
  if (!v) throw data("Not found", { status: 404 });
  return v;
}

export async function action({ request, params }: Route.ActionArgs) {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const act = f.get("act") === "refund" ? "refund" : "clear";
  try {
    await withApp((d) => resolveReviewHold(d, staff.id, params.id, act, String(f.get("reason") ?? "")));
  } catch (e) {
    return { error: messageOf(e) };
  }
  return redirect(`/staff?decided=${encodeURIComponent(act === "clear" ? "hold cleared, the deal continues" : "payment refunded, deal closed")}`);
}

export default function Hold({ loaderData: v, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [act, setAct] = useState("");
  const [reason, setReason] = useState("");
  const pay = v.payments[0];
  const buyer = firstName(v.buyer.name), seller = firstName(v.seller.name);
  const flagged = v.messages.filter((m: any) => m.sender_id === v.deal.buyer_id).slice(-1)[0];
  if (!v.deal.review_hold) return <><nav className="caption muted" aria-label="Breadcrumb"><Link to="/staff">Dashboard</Link> / Review holds</nav><Info icon="circle-check">This hold has been resolved.</Info></>;
  return (
    <>
      <nav className="caption muted" aria-label="Breadcrumb"><Link to="/staff">Dashboard</Link> / Review holds</nav>
      <header className="stack">
        <div className="row"><MoneyStatus state="held">Held · review hold</MoneyStatus></div>
        <p className="caption muted">Deal {v.deal.id.slice(0, 8).toUpperCase()} · {v.listing.title} · {buyer} buying from {seller}</p>
        <h1 className="heading">{v.deal.review_hold_reason?.split(":")[0]}</h1>
        <p className="body">The money arrived, but the deal is paused until a reviewer clears the hold or refunds it.</p>
      </header>
      <div className="two-col">
        <div className="stack-4">
          <table className="table">
            <thead><tr><th>Check</th><th>Expected</th><th>What arrived</th><th /></tr></thead>
            <tbody>
              <tr><td>Amount</td><td className="tabular">{naira(v.deal.amount_due_kobo)}</td><td className="tabular">{pay ? naira(pay.amount_kobo) : "—"}</td><td>{pay?.matches_amount_due ? "Matches" : <span className="error-text">Doesn't match</span>}</td></tr>
              <tr><td>Payer's name</td><td>{v.buyerKycName ?? v.buyer.name}</td><td>{pay?.sender_name ?? "—"}</td><td>{pay?.matches_buyer_name ? "Matches" : <span className="error-text">Doesn't match</span>}</td></tr>
            </tbody>
          </table>
          <div className="card stack">
            <p className="label">{v.buyer.name}, buyer</p>
            <p className="caption muted">Joined {v.buyerSince ? ago(v.buyerSince) : "recently"} · {v.buyerCompleted} completed purchases · {v.buyer.idVerified ? "ID verified" : "ID not verified"}</p>
          </div>
          {flagged ? <div className="card stack"><p className="label">Latest message from {buyer} in the deal chat</p><p className="body">“{flagged.body}”</p><p className="caption muted">{when(new Date(flagged.at))}</p></div> : null}
        </div>
        <Form method="post" className="side card stack">
          <p className="title">Your decision</p>
          <label className="choice"><input type="radio" name="act" value="clear" checked={act === "clear"} onChange={() => setAct("clear")} /><span className="stack" style={{ gap: 0 }}><span className="body">Clear the hold</span><span className="caption muted">The deal continues; {seller} can hand over.</span></span></label>
          <label className="choice"><input type="radio" name="act" value="refund" checked={act === "refund"} onChange={() => setAct("refund")} /><span className="stack" style={{ gap: 0 }}><span className="body">Refund the payment</span><span className="caption muted">Back to the account it came from; the deal closes.</span></span></label>
          <TextArea label="Reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} hint="Saved to the audit log. Both people see a short summary." />
          <ErrorText>{actionData?.error}</ErrorText>
          <Button type="submit" variant="primary" block disabled={busy || !act || reason.trim().length < 5}>Record decision</Button>
        </Form>
      </div>
    </>
  );
}

