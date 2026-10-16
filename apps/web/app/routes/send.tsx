import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/send";
import { requireUser, withApp, messageOf } from "../../server/web";
import { markSent } from "@noshen/engine/deals";
import { storePhoto } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";
import { DealError, settingsOf } from "@noshen/engine/core";
import { BottomAction, Button, ErrorText, Info, PhotoPicker, TextField, TopBar } from "@noshen/ui/ui";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { stateLabel } from "@noshen/shared/locations";
import { COURIERS, PACKING_PHOTOS_MAX, PACKING_PHOTOS_MIN, deliveryZone, packingHint, sendingProblem } from "@noshen/shared/delivery";

export const handle = { tabs: false };
export const meta = () => [{ title: "Send it · NosHen" }];

/** The seller sends a delivery: packing photos, who's delivering it, and the tracking number. */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const x = await one(d.db,
      `select dl.id, dl.seller_id, dl.state, dl.handover, dl.sent_at, dl.review_hold, dl.delivery_state, dl.handover_due_at,
              l.title, l.category, l.state as item_state, b.full_name as buyer
         from deals dl join listings l on l.id = dl.listing_id join users b on b.id = dl.buyer_id where dl.id = $1`, [params.id]);
    if (!x || x.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (x.state !== "held" || x.handover !== "delivery" || x.sent_at || x.review_hold) throw redirect(`/d/${params.id}`);
    return {
      dealId: x.id as string, title: x.title as string, category: x.category as string, buyer: firstName(x.buyer),
      zone: x.delivery_state ? deliveryZone(x.item_state, x.delivery_state) : ("local" as const),
      to: x.delivery_state ? stateLabel(x.delivery_state) : null, due: x.handover_due_at as Date,
      confirmHours: (await settingsOf(d)).delivery_confirm_hours,
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const courier = String(form.get("courier") ?? "");
  const trackingRef = String(form.get("tracking") ?? "");
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const x = await one<{ seller_id: string; delivery_state: string | null; item_state: string | null }>(d.db,
        "select dl.seller_id, dl.delivery_state, l.state as item_state from deals dl join listings l on l.id = dl.listing_id where dl.id = $1", [params.id]);
      if (!x || x.seller_id !== user.id) throw data("Not found", { status: 404 });
      // Check everything before storing the photos, so a missing tracking number doesn't leave photos behind.
      const problem = sendingProblem(x.delivery_state ? deliveryZone(x.item_state, x.delivery_state) : "local", courier, trackingRef, files.length);
      if (problem) throw new DealError("sending", problem);
      const keys: string[] = [];
      for (const f of files) {
        // A photo that isn't a JPEG, PNG, WebP or HEIC, or is too big: say which, rather than "something went wrong".
        try { keys.push(await storePhoto(`packing/${params.id}`, f)); } catch (e) { throw new DealError("photo", (e as Error).message); }
      }
      await markSent(d, user.id, params.id, { courier, trackingRef, photoKeys: keys });
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/d/${params.id}`);
}

export default function Send({ loaderData: x, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const other = x.zone === "other";
  return (
    <Form method="post" encType="multipart/form-data">
      <TopBar title="Send it" back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <div className="stack">
          <h1 className="heading">Send it to {x.buyer}</h1>
          <p className="body muted">{x.title}{x.to ? `, to ${x.to}` : ""}. Send it by {when(new Date(x.due))}.</p>
        </div>
        <Info icon="camera"><strong>Take photos as you pack it.</strong> {packingHint(x.category)} {x.buyer} sees them, and they're your proof if anyone says something else arrived.</Info>
        <PhotoPicker name="photos" label="Packing photos" max={PACKING_PHOTOS_MAX}
          hint={`At least ${PACKING_PHOTOS_MIN}, up to ${PACKING_PHOTOS_MAX}.`} />
        <TextField label="Who is delivering it?" name="courier" list="couriers" placeholder="GIG Logistics, a dispatch rider…" maxLength={60} required
          missing="Say who is delivering it, like GIG Logistics or a dispatch rider." autoComplete="off" />
        <datalist id="couriers">{COURIERS.map((c) => <option key={c} value={c} />)}</datalist>
        <TextField label={other ? "Tracking or waybill number" : "Tracking or waybill number (optional)"} name="tracking" maxLength={60} required={other}
          missing="Add the tracking or waybill number from your receipt." autoComplete="off" autoCapitalize="characters"
          hint={other ? `It's on your receipt from the courier or park. ${x.buyer} uses it to follow the package.` : "If your rider or courier gave you one."} />
        <Info icon="shield-check">Once it's sent, the deal can't be cancelled. You're paid when {x.buyer} confirms it arrived, or {x.confirmHours} hours after you mark it delivered if they say nothing.</Info>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block icon="truck-delivery" disabled={busy}>{busy ? "Sending…" : "Mark as sent"}</Button></BottomAction>
      </main>
    </Form>
  );
}
