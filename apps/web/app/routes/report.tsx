import { useState } from "react";
import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/report";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { reportProblem } from "@noshen/engine/disputes";
import { photosFrom, storePhoto } from "@noshen/engine/photos";
import { useT } from "@noshen/ui/i18n";
import { BottomAction, Button, ErrorText, Info, MoneyStatus, TextArea, TopBar, useEscape, PhotoPicker } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { disputeReasonLabel, firstName, type DisputeReason } from "@noshen/shared/deal";
import { reasonsFor, reportExample } from "@noshen/shared/categories";
import { when, addHours } from "@noshen/shared/time";

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
      for (const p of photosFrom(form, "photos")) keys.push(await storePhoto(`evidence/${params.id}`, p.file, p.small));
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
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const [reason, setReason] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  useEscape(confirm, () => setConfirm(false), busy);
  const label = reason ? t(disputeReasonLabel(reason)) : undefined;
  const now = new Date();
  return (
    <Form method="post" encType="multipart/form-data">
      <TopBar title={t("Report a problem")} back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Report a problem")}</h1>
        <div className="row"><MoneyStatus state="held">{t("{amount} held", { amount: naira(x.paid) })}</MoneyStatus></div>
        <Info icon="lock">{t("The money stays held while a reviewer looks at this. {name} can't be paid until they decide.", { name: x.seller })}</Info>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("What's wrong?")}</legend>
          {reasonsFor(x.category).filter((k) => k !== "not_delivered" || x.handover === "delivery").map((k) => (
            <label key={k} className="choice"><input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} required /><span className="body">{t(disputeReasonLabel(k))}</span></label>
          ))}
        </fieldset>
        <TextArea label={t("What happened")} name="description" maxLength={2000} placeholder={reportExample(x.category, t)} />
        <PhotoPicker name="photos" label={t("Photos (optional)")} hint={t("A photo of the problem helps the reviewer decide faster.")} />
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button variant="danger" size="lg" block disabled={!reason} onClick={() => setConfirm(true)}>{t("Report and freeze the money")}</Button></BottomAction>
      </main>
      {confirm ? (
        <div className="sheet-backdrop" onClick={() => setConfirm(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="freeze-title">
            <MoneyStatus state="dispute">{t("Freeze {amount}", { amount: naira(x.paid) })}</MoneyStatus>
            <h2 id="freeze-title" className="heading">{t("Freeze the money?")}</h2>
            <p className="body">{t("{name} won't be paid while a reviewer looks at this. You both have until {evidence} to add photos or notes. A reviewer decides by {decision}.", { name: x.seller, evidence: when(addHours(now, 24), now), decision: when(addHours(now, 72), now) })}</p>
            <p className="body"><span className="muted">{t("Reason:")}</span> {label}</p>
            <Button type="submit" variant="danger" size="lg" block disabled={busy}>{t("Report and freeze the money")}</Button>
            <Button size="lg" block autoFocus disabled={busy} onClick={() => setConfirm(false)}>{t("Go back")}</Button>
          </div>
        </div>
      ) : null}
    </Form>
  );
}
