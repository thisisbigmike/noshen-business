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
import { useT } from "@noshen/ui/i18n";

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
  const t = useT();
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
      <TopBar title={t("Buy request")} back={`/l/${l.id}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Buy request")}</h1>
        <div className="card row">
          <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "var(--canvas)", flex: "none" }}>
            {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" width={56} height={56} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="camera" />}
          </div>
          <div className="grow"><p className="title">{l.title}</p><p className="caption muted">{name} · {placeLabel(l.area, l.state)}</p></div>
        </div>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("How do you want to get it?")}</legend>
          <label className="choice">
            <input type="radio" name="handover" value="meetup" checked={handover === "meetup"} onChange={() => setHandover("meetup")} />
            <span className="stack"><span className="title row"><Icon name="map-pin" size={18} />{t("Meet-up")}<span className="caption muted" style={{ marginLeft: "auto" }}>{t("Free")}</span></span>
              <span className="caption muted">{t("Meet {name} in a public place in {area}. Check the {thing} before you give your code.", { name, area: l.area, thing: noun })}</span></span>
          </label>
          <label className={`choice${delivers ? "" : " disabled"}`}>
            <input type="radio" name="handover" value="delivery" checked={handover === "delivery"} disabled={!delivers} onChange={() => setHandover("delivery")} />
            <span className="stack"><span className="title row"><Icon name="truck-delivery" size={18} />{t("Delivery")}</span>
              <span className="caption muted">{delivers
                ? t("{name} sends it within {time} of your payment, with photos of it packed. Check it when it arrives, before you confirm.", { name, time: sendWithin(sendHours, t) })
                : t("{name} only does meet-ups for this {thing}.", { name, thing: noun })}</span>
              {delivers ? <span className="caption">{deliveryZones(l, t).map((z) => `${z.label}: ${deliveryPriceLabel(z.kobo, t)}`).join(" · ")}</span> : null}</span>
          </label>
        </fieldset>

        {handover === "delivery" ? (
          <div className="stack">
            <Select name="delivery_state" label={t("Deliver to")} value={to} onChange={setTo}
              options={[...(to ? [] : [{ value: "", label: t("Choose your state") }]), ...NIGERIA_STATES.map((st) => ({ value: st, label: stateLabel(st) }))]} />
            {to && delivery === null ? <Info icon="alert-triangle" tone="warn">{t("{name} doesn't deliver to {state}. Choose meet-up instead.", { name, state: stateLabel(to) })}</Info>
              : <p className="caption muted">{t("You'll share your address with {name} in the deal chat once you've paid.", { name })}</p>}
          </div>
        ) : null}

        <section className="card">
          <p className="label">{t("What you'll pay")}</p>
          <Kv k={t("Price")} v={naira(price)} />
          {handover === "delivery" && delivery !== null ? <Kv k={t("Delivery to {state}", { state: stateLabel(to) })} v={deliveryPriceLabel(delivery, t)} /> : null}
          <Kv k={t("NosHen fee")} v={naira(fee)} />
          <Kv k={t("Total")} v={naira(price + fee + (delivery ?? 0))} total />
          {handover === "delivery" && delivery !== null ? <p className="caption muted">{t("Delivery is paid with the price and held with it. If it never comes, you get it back. Don't pay a rider anything extra.")}</p> : null}
        </section>

        <TextArea label={t("Note to {name} (optional)", { name })} name="note" placeholder={handover === "delivery" ? t("Anything they should know about the delivery?") : t("When and where works for you?")} maxLength={500} />
        <Info icon="shield-check">{t("You pay nothing until {name} accepts. Then you pay NosHen, and we hold the money until you have the {thing}.", { name, thing: noun })}</Info>
        <p className="caption muted">{t.rich("Sending a request means you agree to the <terms>Protected Deal Terms</terms>.", { terms: (s) => <Link to="/deal-terms">{s}</Link> })}</p>
        <ErrorText>{actionData?.error}</ErrorText>
        {actionData?.needsId ? <Link to={`/account/verify?next=/l/${l.id}/buy`}>{t("Verify your ID")}</Link> : null}
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy || cantDeliver}>{busy ? t("Sending…") : t("Send request")}</Button></BottomAction>
      </main>
    </Form>
  );
}
