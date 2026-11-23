import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/buy";
import { requireUser, withApp, messageOf } from "../../server/web";
import { listingView } from "@noshen/engine/queries";
import { settingsOf } from "@noshen/engine/core";
import { requestDeal } from "@noshen/engine/deals";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, Kv, Select, TextArea, TextField, TopBar, Info } from "@noshen/ui/ui";
import { feeFor, naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { photoUrl } from "@noshen/shared/photos";
import { categoryOf, isService } from "@noshen/shared/categories";
import type { Stage } from "@noshen/shared/stages";
import { NIGERIA_STATES, placeLabel, stateLabel } from "@noshen/shared/locations";
import { deliveryFee, deliveryPriceLabel, deliveryZones, offersDelivery, sendWithin } from "@noshen/shared/delivery";
import { useT } from "@noshen/ui/i18n";
import { StagesCard } from "../lib/stages";

export const handle = { tabs: false };
export const meta = () => [{ title: "Buy request · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await listingView(d.db, params.id);
    if (!v || v.listing.status !== "live") throw data("Not found", { status: 404 });
    if (v.listing.seller_id === user.id) throw redirect(`/l/${params.id}`);
    const s = await settingsOf(d);
    const safeListing = { ...v.listing, imei_or_serial: v.listing.imei_or_serial ? "REDACTED" : null };
    const safeSeller = { ...v.seller, name: firstName(v.seller.name) };
    return { listing: safeListing, seller: safeSeller, fee: feeFor(Number(v.listing.price_kobo), s.fee), feeRule: s.fee, minKobo: s.deal_min_kobo, sendHours: s.handover_window_hours };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const dealId = await withApp(async (d) => {
      const user = await requireUser(request, d);
      const makeOffer = form.get("price_mode") === "offer";
      const offerRaw = Number(String(form.get("offer_naira") ?? "").replace(/[₦,\s]/g, ""));
      const offerKobo = makeOffer && Number.isFinite(offerRaw) && offerRaw > 0 ? Math.round(offerRaw * 100) : null;
      return requestDeal(d, user.id, {
        listingId: params.id,
        handover: form.get("handover") === "delivery" ? "delivery" : "meetup",
        deliveryState: String(form.get("delivery_state") ?? ""),
        note: String(form.get("note") ?? ""),
        offerKobo,
      });
    });
    // From a checkout link the request is accepted at once: straight on to paying.
    const state = await withApp(async (d) => (await one<{ state: string }>(d.db, "select state from deals where id = $1", [dealId]))?.state);
    return redirect(state === "accepted" ? `/d/${dealId}/pay` : `/d/${dealId}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = messageOf(e);
    return { error: msg, needsId: msg.includes("verify your ID") };
  }
}

export default function Buy({ loaderData, actionData }: Route.ComponentProps) {
  const { listing: l, seller, fee: listedFee, feeRule, minKobo, sendHours } = loaderData;
  const t = useT();
  const noun = categoryOf(l.category).noun;
  const busy = useNavigation().state !== "idle";
  const name = firstName(seller.name);
  const listedPrice = Number(l.price_kobo);
  const canOffer = l.visibility === "public" && listedPrice > minKobo;
  const [priceMode, setPriceMode] = useState<"listed" | "offer">("listed");
  const [offerStr, setOfferStr] = useState(String(Math.round(listedPrice / 100)));
  const minOfferKobo = Math.max(minKobo, Math.ceil(listedPrice * 0.5));
  const parsedOfferKobo = Math.round((Number(offerStr.replace(/[₦,\s]/g, "")) || 0) * 100);
  const price = canOffer && priceMode === "offer" && parsedOfferKobo >= minOfferKobo && parsedOfferKobo <= listedPrice ? parsedOfferKobo : listedPrice;
  const fee = price === listedPrice ? listedFee : feeFor(price, feeRule);
  const delivers = offersDelivery(l);
  const [handover, setHandover] = useState<"meetup" | "delivery">("meetup");
  // Most buyers are in the same state as the item: start there when the seller delivers within it.
  const [to, setTo] = useState<string>(l.delivery_local_kobo !== null ? l.state ?? "" : "");
  const delivery = handover === "delivery" && to ? deliveryFee(l, to) : null;
  const cantDeliver = handover === "delivery" && (!to || delivery === null);
  // A job has no handover to choose: it's paid in stages as the work is done.
  const job = isService(l.category);
  const heading = job ? t("Book this job") : t("Buy request");
  return (
    <Form method="post">
      <TopBar title={heading} back={`/l/${l.id}`} />
      <main className="page sell-page no-tabs stack-4">
        <h1 className="heading desktop-only">{heading}</h1>

        <div className="sell-flow sell-flow-wide">
          <div className="sell-main">
            <div className="card row mobile-only">
              <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "var(--canvas)", flex: "none" }}>
                {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" width={56} height={56} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="camera" />}
              </div>
              <div className="grow"><p className="title">{l.title}</p><p className="caption muted">{name} · {placeLabel(l.area, l.state)}</p></div>
            </div>

            {job ? <><input type="hidden" name="handover" value="meetup" /><StagesCard stages={l.stages as Stage[]} priceKobo={price} seller={name} /></> : <section className="sell-card stack">
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
            </section>}

            {canOffer ? (
              <section className="sell-card stack">
                <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label" style={{ marginBottom: 8 }}>{t("Price")}</legend>
                  <label className="choice">
                    <input type="radio" name="price_mode" value="listed" checked={priceMode === "listed"} onChange={() => setPriceMode("listed")} />
                    <span className="stack">
                      <span className="title">{t("Buy at listed price")} ({naira(listedPrice)})</span>
                      <span className="caption muted">{t("Fastest way for {name} to accept.", { name })}</span>
                    </span>
                  </label>
                  <label className="choice">
                    <input type="radio" name="price_mode" value="offer" checked={priceMode === "offer"} onChange={() => setPriceMode("offer")} />
                    <span className="stack">
                      <span className="title">{t("Make an offer")}</span>
                      <span className="caption muted">{t("Propose a lower price (at least {min}). {name} can accept or decline.", { min: naira(minOfferKobo), name })}</span>
                    </span>
                  </label>
                  {priceMode === "offer" ? (
                    <TextField
                      label={t("Your offer (₦)")}
                      name="offer_naira"
                      inputMode="numeric"
                      value={offerStr}
                      onChange={(e) => setOfferStr(e.target.value)}
                      hint={t("Between {min} and {max}.", { min: naira(minOfferKobo), max: naira(listedPrice) })}
                      required
                    />
                  ) : null}
                </fieldset>
              </section>
            ) : null}

            <section className="sell-card stack">
              <TextArea label={t("Note to {name} (optional)", { name })} name="note" placeholder={job ? t("What do you need done, where, and by when?") : handover === "delivery" ? t("Anything they should know about the delivery?") : t("When and where works for you?")} maxLength={500} />
            </section>
          </div>

          <aside className="sell-side">
            <div className="sell-cta-card stack-4">
              <div className="row desktop-only">
                <div style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", background: "var(--canvas)", flex: "none" }}>
                  {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" width={56} height={56} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="camera" />}
                </div>
                <div className="grow"><p className="title">{l.title}</p><p className="caption muted">{name} · {placeLabel(l.area, l.state)}</p></div>
              </div>
              <section className="stack" style={{ gap: 2 }}>
                <p className="label">{t("What you'll pay")}</p>
                <div>
                  <Kv k={t("Price")} v={naira(price)} />
                  {handover === "delivery" && delivery !== null ? <Kv k={t("Delivery to {state}", { state: stateLabel(to) })} v={deliveryPriceLabel(delivery, t)} /> : null}
                  <Kv k={t("NosHen fee")} v={naira(fee)} />
                  <Kv k={t("Total")} v={naira(price + fee + (delivery ?? 0))} total />
                </div>
                {handover === "delivery" && delivery !== null ? <p className="caption muted">{t("Delivery is paid with the price and held with it. If it never comes, you get it back. Don't pay a rider anything extra.")}</p> : null}
              </section>
              <ErrorText>{actionData?.error}</ErrorText>
              {actionData?.needsId ? <Link to={`/account/verify?next=/l/${l.id}/buy`}>{t("Verify your ID")}</Link> : null}
              <BottomAction>
                {/* On phones the summary above is out of sight, so the total sits right on the button bar. */}
                <p className="bottom-total mobile-only"><span className="muted">{t("Total")}</span><span className="tabular">{naira(price + fee + (delivery ?? 0))}</span></p>
                <Button type="submit" variant="primary" size="lg" block disabled={busy || cantDeliver}>{busy ? t("Sending…") : l.visibility === "link" ? t("Continue to pay") : t("Send request")}</Button>
              </BottomAction>
              <p className="caption muted">{t.rich("Sending a request means you agree to the <terms>Protected Deal Terms</terms>.", { terms: (s) => <Link to="/deal-terms">{s}</Link> })}</p>
            </div>
            <Info icon="shield-check">{job
              ? (l.visibility === "link"
                ? t("{name} shared this checkout link, so there's no waiting: you pay NosHen the whole price next, and {name} is paid each stage only when you release it.", { name })
                : t("You pay nothing until {name} accepts. Then you pay NosHen the whole price, and {name} is paid each stage only when you release it.", { name }))
              : l.visibility === "link"
              ? t("{name} shared this checkout link, so there's no waiting: you pay NosHen next, and we hold the money until you have the {thing}.", { name, thing: noun })
              : t("You pay nothing until {name} accepts. Then you pay NosHen, and we hold the money until you have the {thing}.", { name, thing: noun })}</Info>
            <Info icon="scale">{job
              ? t("If the work isn't what you agreed, the money still held doesn't move: report it, and a real person reviews it within 72 hours and tells you both why.")
              : t("If it's not what was listed, your money doesn't move: report it, and a real person reviews it within 72 hours and tells you both why.")}</Info>
          </aside>
        </div>
      </main>
    </Form>
  );
}
