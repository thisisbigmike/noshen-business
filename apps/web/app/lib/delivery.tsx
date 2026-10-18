// Delivery on the customer site: the seller's prices (selling and editing a listing), what it costs on a listing,
// and the packing photos on a deal.
import { useState } from "react";
import { Link } from "react-router";
import { Icon, Kv, PhotoViewer, TextField } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { stateLabel, placeLabel } from "@noshen/shared/locations";
import { photoUrl } from "@noshen/shared/photos";
import { type DeliveryPrices, deliveryPriceLabel, deliveryPriceProblem, deliveryZones, offersDelivery, parseDeliveryPrice, sendWithin } from "@noshen/shared/delivery";

/** The delivery prices from a form with DeliveryFields, for setDelivery or saveDraft. */
export function deliveryFromForm(f: FormData) {
  return {
    localKobo: parseDeliveryPrice(f.get("delivery_local"), f.get("deliver_local") === "yes"),
    otherKobo: parseDeliveryPrice(f.get("delivery_other"), f.get("deliver_other") === "yes"),
  };
}

/** The seller's delivery prices: within the item's state, and to other states. Meet-up is always free. */
export function DeliveryFields({ state, local, other }: { state: string; local: string | number | null; other: string | number | null }) {
  const t = useT();
  const [onLocal, setOnLocal] = useState(local !== null);
  const [onOther, setOnOther] = useState(other !== null);
  const where = state ? stateLabel(state) : t("your state");
  const row = (key: "local" | "other", on: boolean, set: (v: boolean) => void, check: string, field: string, value: string | number | null, example: string) => (
    <div className="stack" style={{ gap: 0 }}>
      <label className="check">
        <input type="checkbox" name={`deliver_${key}`} value="yes" checked={on} onChange={(e) => set(e.currentTarget.checked)} />
        <span className="body">{check}</span>
      </label>
      {on ? (
        <TextField label={field} name={`delivery_${key}`} inputMode="numeric" defaultValue={value === null ? "" : String(Number(value) / 100)}
          placeholder={example} required missing={t("Enter the delivery price in naira. Use 0 for free delivery.")} validate={(v) => deliveryPriceProblem(v, t)}
          hint={t("What it costs you to send it. Use 0 for free delivery.")} />
      ) : null}
    </div>
  );
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 8 }}>{t("Delivery")}</legend>
      <p className="caption muted">{t("Meet-up is always free. If you also deliver, set the price, so buyers see the full cost before they ask. They pay it with the price, NosHen holds it, and you get it when the deal closes, to pay the courier.")}</p>
      {row("local", onLocal, setOnLocal, t("I deliver within {state}", { state: where }), t("Delivery within {state} (₦)", { state: where }), local, "3,000")}
      {row("other", onOther, setOnOther, t("I deliver to other states"), t("Delivery to other states (₦)"), other, "8,000")}
    </fieldset>
  );
}

/** How to get it, and what delivery costs, on a listing. */
export function DeliveryCard({ l, seller, sendHours, editTo }: { l: DeliveryPrices & { area: string }; seller: string; sendHours: number; editTo?: string }) {
  const t = useT();
  const offered = offersDelivery(l);
  return (
    <section className="card stack" aria-labelledby="getting-it">
      <div className="row-between"><h2 id="getting-it" className="title">{t("Getting it")}</h2>{editTo ? <Link to={editTo} className="caption tap">{t("Change delivery")}</Link> : null}</div>
      <div>
        <Kv k={<span className="row" style={{ gap: 6 }}><Icon name="map-pin" size={16} />{t("Meet-up in {place}", { place: placeLabel(l.area, l.state) })}</span>} v={t("Free")} />
        {deliveryZones(l, t).map((z) => (
          <Kv key={z.zone} k={<span className="row" style={{ gap: 6 }}><Icon name="truck-delivery" size={16} />{z.label}</span>}
            v={z.kobo === null ? <span className="muted">{deliveryPriceLabel(null, t)}</span> : deliveryPriceLabel(z.kobo, t)} />
        ))}
      </div>
      <p className="caption muted">{offered
        ? t("{seller} sends it within {time} of your payment, with photos of it packed. The delivery fee is held with the price, and refunded if it never comes. Never pay a rider extra.", { seller, time: sendWithin(sendHours, t) })
        : t("{seller} only does meet-ups for this item. Check it before you give your code.", { seller })}</p>
    </section>
  );
}

/** The seller's packing photos, sent with a delivery: small in the grid, full size when tapped. */
export function PackingPhotos({ keys, title }: { keys: string[]; title: string }) {
  const t = useT();
  const [viewing, setViewing] = useState<number | null>(null);
  if (!keys.length) return null;
  return (
    <>
      <div className="photo-grid">
        {keys.map((k, i) => (
          <button key={k} type="button" className="photo-slot photo-zoom" aria-label={t("Packing photo {n} of {total}. See it full size", { n: i + 1, total: keys.length })} onClick={() => setViewing(i)}>
            <img src={photoUrl(k, "small")} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {viewing !== null ? (
        <PhotoViewer label={t("Packing photos of {title}", { title })} start={viewing} onClose={() => setViewing(null)}
          photos={keys.map((k, i) => ({ src: photoUrl(k), alt: t("{title}, packing photo {n} of {total}", { title, n: i + 1, total: keys.length }) }))} />
      ) : null}
    </>
  );
}
