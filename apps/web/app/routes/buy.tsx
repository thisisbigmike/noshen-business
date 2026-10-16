import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/buy";
import { requireUser, withApp, messageOf } from "../../server/web";
import { listingView } from "@noshen/engine/queries";
import { settingsOf } from "@noshen/engine/core";
import { requestDeal } from "@noshen/engine/deals";
import { BottomAction, Button, ErrorText, Icon, Kv, Select, TextArea, TopBar, Info } from "@noshen/ui/ui";
import { feeFor, naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { photoUrl } from "@noshen/shared/photos";
import { categoryOf } from "@noshen/shared/categories";
import { NIGERIA_STATES, placeLabel, stateLabel } from "@noshen/shared/locations";
import { deliveryFee, deliveryPriceLabel, deliveryZones, offersDelivery, sendWithin } from "@noshen/shared/delivery";

export const handle = { tabs: false };
export const meta = () => [{ title: "Buy request · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await listingView(d.db, params.id);
    if (!v || v.listing.status !== "live") throw data("Not found", { status: 404 });
    if (v.listing.seller_id === user.id) throw redirect(`/l/${params.id}`);
    const s = await settingsOf(d);
    return { ...v, fee: feeFor(Number(v.listing.price_kobo), s.fee), sendHours: s.handover_window_hours };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const dealId = await withApp(async (d) => {
      const user = await requireUser(request, d);
      return requestDeal(d, user.id, {
        listingId: params.id,
        handover: form.get("handover") === "delivery" ? "delivery" : "meetup",
        deliveryState: String(form.get("delivery_state") ?? ""),
        note: String(form.get("note") ?? ""),
      });
    });
    return redirect(`/d/${dealId}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = messageOf(e);
    return { error: msg, needsId: msg.includes("verify your ID") };
  }
}

export default function Buy({ loaderData, actionData }: Route.ComponentProps) {
  const { listing: l, seller, fee, sendHours } = loaderData;
  const noun = categoryOf(l.category).noun;
  const busy = useNavigation().state !== "idle";
  const name = firstName(seller.name);
  const price = Number(l.price_kobo);
  const delivers = offersDelivery(l);
  const [handover, setHandover] = useState<"meetup" | "delivery">("meetup");
  // Most buyers are in the same state as the item: start there when the seller delivers within it.
  const [to, setTo] = useState<string>(l.delivery_local_kobo !== null ? l.state ?? "" : "");
  const delivery = handover === "delivery" && to ? deliveryFee(l, to) : null;
  const cantDeliver = handover === "delivery" && (!to || delivery === null);
  return (
    <Form method="post">
      <TopBar title="Buy request" back={`/l/${l.id}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Buy request</h1>
        <div className="card row">
          <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "var(--canvas)", flex: "none" }}>
            {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0])} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="camera" />}
          </div>
          <div className="grow"><p className="title">{l.title}</p><p className="caption muted">{name} · {placeLabel(l.area, l.state)}</p></div>
        </div>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>How do you want to get it?</legend>
          <label className="choice">
            <input type="radio" name="handover" value="meetup" checked={handover === "meetup"} onChange={() => setHandover("meetup")} />
            <span className="stack"><span className="title row"><Icon name="map-pin" size={18} />Meet-up<span className="caption muted" style={{ marginLeft: "auto" }}>Free</span></span>
              <span className="caption muted">Meet {name} in a public place in {l.area}. Check the {noun} before you give your code.</span></span>
          </label>
          <label className={`choice${delivers ? "" : " disabled"}`}>
            <input type="radio" name="handover" value="delivery" checked={handover === "delivery"} disabled={!delivers} onChange={() => setHandover("delivery")} />
            <span className="stack"><span className="title row"><Icon name="truck-delivery" size={18} />Delivery</span>
              <span className="caption muted">{delivers
                ? `${name} sends it within ${sendWithin(sendHours)} of your payment, with photos of it packed. Check it when it arrives, before you confirm.`
                : `${name} only does meet-ups for this ${noun}.`}</span>
              {delivers ? <span className="caption">{deliveryZones(l).map((z) => `${z.label[0].toUpperCase()}${z.label.slice(1)}: ${deliveryPriceLabel(z.kobo)}`).join(" · ")}</span> : null}</span>
          </label>
        </fieldset>

        {handover === "delivery" ? (
          <div className="stack">
            <Select name="delivery_state" label="Deliver to" value={to} onChange={setTo}
              options={[...(to ? [] : [{ value: "", label: "Choose your state" }]), ...NIGERIA_STATES.map((st) => ({ value: st, label: stateLabel(st) }))]} />
            {to && delivery === null ? <Info icon="alert-triangle" tone="warn">{name} doesn't deliver to {stateLabel(to)}. Choose meet-up instead.</Info>
              : <p className="caption muted">You'll share your address with {name} in the deal chat once you've paid.</p>}
          </div>
        ) : null}

        <section className="card">
          <p className="label">What you'll pay</p>
          <Kv k="Price" v={naira(price)} />
          {handover === "delivery" && delivery !== null ? <Kv k={`Delivery to ${stateLabel(to)}`} v={deliveryPriceLabel(delivery)} /> : null}
          <Kv k="NosHen fee" v={naira(fee)} />
          <Kv k="Total" v={naira(price + fee + (delivery ?? 0))} total />
          {handover === "delivery" && delivery !== null ? <p className="caption muted">Delivery is paid with the price and held with it. If it never comes, you get it back. Don't pay a rider anything extra.</p> : null}
        </section>

        <TextArea label={`Note to ${name} (optional)`} name="note" placeholder={handover === "delivery" ? "Anything they should know about the delivery?" : "When and where works for you?"} maxLength={500} />
        <Info icon="shield-check">You pay nothing until {name} accepts. Then you pay NosHen, and we hold the money until you have the {noun}.</Info>
        <p className="caption muted">Sending a request means you agree to the <Link to="/deal-terms">Protected Deal Terms</Link>.</p>
        <ErrorText>{actionData?.error}</ErrorText>
        {actionData?.needsId ? <Link to={`/account/verify?next=/l/${l.id}/buy`}>Verify your ID</Link> : null}
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy || cantDeliver}>{busy ? "Sending…" : "Send request"}</Button></BottomAction>
      </main>
    </Form>
  );
}
