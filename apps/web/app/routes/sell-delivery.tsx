import { data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-delivery";
import { requireUser, withApp, messageOf } from "../../server/web";
import { setDelivery } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, CheckedForm, ErrorText, Info, TopBar } from "@noshen/ui/ui";
import { DeliveryFields, deliveryFromForm } from "../lib/delivery";

export const handle = { tabs: false };
export const meta = () => [{ title: "Delivery prices · NosHen" }];

/** A published listing's delivery prices. A draft sets them in its details step. */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(d.db, "select id, seller_id, title, status, state, delivery_local_kobo, delivery_other_kobo from listings where id = $1", [params.id]);
    if (!l || l.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (l.status === "draft") throw redirect(`/sell/${l.id}/details`);
    if (!["live", "paused"].includes(l.status)) throw redirect(`/l/${l.id}`);
    return { listing: l };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await setDelivery(d, user.id, params.id, deliveryFromForm(f));
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/l/${params.id}`);
}

export default function SellDelivery({ loaderData: { listing: l }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <CheckedForm method="post">
      <TopBar title="Delivery prices" back={`/l/${l.id}`} />
      <main className="page narrow no-tabs stack-4">
        <div className="stack">
          <h1 className="heading desktop-only">Delivery prices</h1>
          <p className="body muted">{l.title}</p>
        </div>
        <DeliveryFields state={l.state ?? ""} local={l.delivery_local_kobo} other={l.delivery_other_kobo} />
        <Info icon="info-circle">New prices apply to new requests. Buyers who've already asked keep the price they saw.</Info>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Saving…" : "Save delivery prices"}</Button></BottomAction>
      </main>
    </CheckedForm>
  );
}
