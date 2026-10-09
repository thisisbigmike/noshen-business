import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/evidence";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { addEvidence } from "../../server/engine/disputes";
import { storePhoto } from "../../server/photos";
import { BottomAction, Button, ErrorText, Info, TextArea, TopBar } from "../components/ui";
import { when } from "../../shared/time";

export const handle = { tabs: false };
export const meta = () => [{ title: "Add evidence · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || (v.deal.buyer_id !== user.id && v.deal.seller_id !== user.id)) throw data("Not found", { status: 404 });
    if (!v.dispute || v.dispute.state !== "collecting_evidence") throw redirect(`/d/${params.id}`);
    return { dealId: v.deal.id, due: v.dispute.evidence_due_at, decision: v.dispute.decision_due_at };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
      const note = String(form.get("note") ?? "");
      if (!files.length) return addEvidence(d, user.id, params.id, { note });
      for (const [i, f] of files.entries()) await addEvidence(d, user.id, params.id, { fileKey: await storePhoto(`evidence/${params.id}`, f), note: i === 0 ? note : undefined });
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/d/${params.id}`);
}

export default function Evidence({ loaderData: x, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" encType="multipart/form-data">
      <TopBar title="Add photos or notes" back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <Info icon="clock">You can add evidence until {when(new Date(x.due))}. A reviewer decides by {when(new Date(x.decision))}.</Info>
        <TextArea label="Note" name="note" maxLength={2000} placeholder="What happened, in your own words." />
        <div className="nh-field" style={{ maxWidth: "none" }}>
          <label className="nh-field-label label" htmlFor="photos">Photos</label>
          <input id="photos" name="photos" type="file" accept="image/*" multiple className="nh-input" style={{ paddingTop: 10 }} />
        </div>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Add evidence</Button></BottomAction>
      </main>
    </Form>
  );
}
