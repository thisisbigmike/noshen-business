// Delivery on the customer site: the seller's prices (selling and editing a listing), what it costs on a listing,
// and the packing photos on a deal.
import { useState } from "react";
import { Link } from "react-router";
import { Icon, Kv, PhotoViewer, TextField } from "@noshen/ui/ui";
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
  const [onLocal, setOnLocal] = useState(local !== null);
  const [onOther, setOnOther] = useState(other !== null);
  const where = state ? stateLabel(state) : "your state";
  const row = (key: "local" | "other", on: boolean, set: (v: boolean) => void, label: string, value: string | number | null, example: string) => (
    <div className="stack" style={{ gap: 0 }}>
      <label className="check">
        <input type="checkbox" name={`deliver_${key}`} value="yes" checked={on} onChange={(e) => set(e.currentTarget.checked)} />
        <span className="body">I deliver {label}</span>
      </label>
      {on ? (
        <TextField label={`Delivery ${label} (₦)`} name={`delivery_${key}`} inputMode="numeric" defaultValue={value === null ? "" : String(Number(value) / 100)}
          placeholder={example} required missing="Enter the delivery price in naira. Use 0 for free delivery." validate={deliveryPriceProblem}
          hint="What it costs you to send it. Use 0 for free delivery." />
      ) : null}
    </div>
  );
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 8 }}>Delivery</legend>
      <p className="caption muted">Meet-up is always free. If you also deliver, set the price, so buyers see the full cost before they ask. They pay it with the price, NosHen holds it, and you get it when the deal closes, to pay the courier.</p>
      {row("local", onLocal, setOnLocal, `within ${where}`, local, "3,000")}
      {row("other", onOther, setOnOther, "to other states", other, "8,000")}
    </fieldset>
  );
}

/** How to get it, and what delivery costs, on a listing. */
export function DeliveryCard({ l, seller, sendHours, editTo }: { l: DeliveryPrices & { area: string }; seller: string; sendHours: number; editTo?: string }) {
  const offered = offersDelivery(l);
  return (
    <section className="card stack" aria-labelledby="getting-it">
      <div className="row-between"><h2 id="getting-it" className="title">Getting it</h2>{editTo ? <Link to={editTo} className="caption tap">Change delivery</Link> : null}</div>
      <div>
        <Kv k={<span className="row" style={{ gap: 6 }}><Icon name="map-pin" size={16} />Meet-up in {placeLabel(l.area, l.state)}</span>} v="Free" />
        {deliveryZones(l).map((z) => (
          <Kv key={z.zone} k={<span className="row" style={{ gap: 6 }}><Icon name="truck-delivery" size={16} />Delivery {z.label}</span>}
            v={z.kobo === null ? <span className="muted">{deliveryPriceLabel(null)}</span> : deliveryPriceLabel(z.kobo)} />
        ))}
      </div>
      <p className="caption muted">{offered
        ? `${seller} sends it within ${sendWithin(sendHours)} of your payment, with photos of it packed. The delivery fee is held with the price, and refunded if it never comes. Never pay a rider extra.`
        : `${seller} only does meet-ups for this item. Check it before you give your code.`}</p>
    </section>
  );
}

/** The seller's packing photos, sent with a delivery. Tap one to see it full size. */
export function PackingPhotos({ keys, title }: { keys: string[]; title: string }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (!keys.length) return null;
  return (
    <>
      <div className="photo-grid">
        {keys.map((k, i) => (
          <button key={k} type="button" className="photo-slot photo-zoom" aria-label={`Packing photo ${i + 1} of ${keys.length}. See it full size`} onClick={() => setViewing(i)}>
            <img src={photoUrl(k)} alt="" />
          </button>
        ))}
      </div>
      {viewing !== null ? (
        <PhotoViewer label={`Packing photos of ${title}`} start={viewing} onClose={() => setViewing(null)}
          photos={keys.map((k, i) => ({ src: photoUrl(k), alt: `${title}, packing photo ${i + 1} of ${keys.length}` }))} />
      ) : null}
    </>
  );
}
