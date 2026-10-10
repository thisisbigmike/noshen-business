import { useState } from "react";
import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/report";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { reportProblem } from "../../server/engine/disputes";
import { storePhoto } from "../../server/photos";
import { BottomAction, Button, ErrorText, Info, MoneyStatus, TextArea, TopBar, useEscape, PhotoPicker } from "../components/ui";
import { naira } from "../../shared/money";
import { disputeReasonLabel, firstName, type DisputeReason } from "../../shared/deal";
import { reasonsFor, reportExample } from "../../shared/categories";
import { when, addHours } from "../../shared/time";

export const handle = { tabs: false };
export const meta = () => [{ title: "Report a problem · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "held") throw redirect(`/d/${params.id}`);
    const paid = v.payments.reduce((s: number, p: any) => s + Number(p.amount_kobo), 0);
    return { dealId: v.deal.id, paid, seller: firstName(v.seller.name), category: v.listing.category as string, handover: v.deal.handover as string };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const keys: string[] = [];
      for (const f of form.getAll("photos")) if (f instanceof File && f.size > 0) keys.push(await storePhoto(`evidence/${params.id}`, f));
      await reportProblem(d, user.id, params.id, {
        reason: String(form.get("reason")) as DisputeReason, description: String(form.get("description") ?? ""), photoKeys: keys,
      });
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/d/${params.id}`);
}

export default function Report({ loaderData: x, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [reason, setReason] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  useEscape(confirm, () => setConfirm(false), busy);
  const label = reason ? disputeReasonLabel(reason) : undefined;
  const now = new Date();
  return (
    <Form method="post" encType="multipart/form-data">
      <TopBar title="Report a problem" back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Report a problem</h1>
        <div className="row"><MoneyStatus state="held">{naira(x.paid)} held</MoneyStatus></div>
        <Info icon="lock">The money stays held while a reviewer looks at this. {x.seller} can't be paid until they decide.</Info>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>What's wrong?</legend>
          {reasonsFor(x.category).filter((k) => k !== "not_delivered" || x.handover === "delivery").map((k) => (
            <label key={k} className="choice"><input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} required /><span className="body">{disputeReasonLabel(k)}</span></label>
          ))}
        </fieldset>
        <TextArea label="What happened" name="description" maxLength={2000} placeholder={reportExample(x.category)} />
        <PhotoPicker name="photos" label="Photos (optional)" hint="A photo of the problem helps the reviewer decide faster." />
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button variant="danger" size="lg" block disabled={!reason} onClick={() => setConfirm(true)}>Report and freeze the money</Button></BottomAction>
      </main>
      {confirm ? (
        <div className="sheet-backdrop" onClick={() => setConfirm(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="freeze-title">
            <MoneyStatus state="dispute">Freeze {naira(x.paid)}</MoneyStatus>
            <h2 id="freeze-title" className="heading">Freeze the money?</h2>
            <p className="body">{x.seller} won't be paid while a reviewer looks at this. You both have until {when(addHours(now, 24), now)} to add photos or notes. A reviewer decides by {when(addHours(now, 72), now)}.</p>
            <p className="body"><span className="muted">Reason:</span> {label}</p>
            <Button type="submit" variant="danger" size="lg" block disabled={busy}>Report and freeze the money</Button>
            <Button size="lg" block autoFocus disabled={busy} onClick={() => setConfirm(false)}>Go back</Button>
          </div>
        </div>
      ) : null}
    </Form>
  );
}
