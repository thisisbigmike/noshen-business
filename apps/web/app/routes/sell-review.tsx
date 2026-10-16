import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-review";
import { requireUser, withApp, messageOf } from "../../server/web";
import { publish, sellerReady } from "@noshen/engine/sellers";
import { DealError, settingsOf } from "@noshen/engine/core";
import { sellerLimit } from "@noshen/engine/deals";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, Info, Kv, ProtectionBadge, TopBar } from "@noshen/ui/ui";
import { CONDITIONS } from "@noshen/shared/deal";
import { categoryOf } from "@noshen/shared/categories";
import { feeFor, naira } from "@noshen/shared/money";
import { photoUrl } from "@noshen/shared/photos";
import { placeLabel } from "@noshen/shared/locations";
import { overLimit, sellerLimitText } from "@noshen/shared/limits";
import { sizeLabel, sizeProblem, sizeRuleFor } from "@noshen/shared/sizes";
import { deliveryPriceLabel, deliveryZones, offersDelivery } from "@noshen/shared/delivery";

export const handle = { tabs: false };
export const meta = () => [{ title: "Review · Sell · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(d.db, "select * from listings where id = $1", [params.id]);
    if (!l || l.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (l.status !== "draft") throw redirect(`/sell/${l.id}/share`);
    // Each step must be done before the review: photos, then the details.
    if ((l.photo_keys ?? []).length < 3) throw redirect(`/sell/${l.id}/photos`);
    if (l.title === "Untitled listing" || !l.state || !l.area?.trim() || sizeProblem(l.category, l.size_system, l.size)) throw redirect(`/sell/${l.id}/details`);
    const s = await settingsOf(d);
    const price = Number(l.price_kobo);
    const limit = await sellerLimit(d.db, user.id, s);
    return {
      listing: l, fee: feeFor(price, s.fee),
      limitText: overLimit(price, limit) ? sellerLimitText(limit, "seller") : null,
      ready: (await sellerReady(d, user.id)).ready,
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  if (f.get("confirm") !== "yes") return { error: "Tick the box to confirm the item is yours to sell and described honestly." };
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      try {
        await publish(d, user.id, params.id);
      } catch (e) {
        // Not verified yet: do the checks, then come back here to publish.
        if (e instanceof DealError && e.code === "seller_checks") throw redirect(`/account/verify?next=${encodeURIComponent(`/sell/${params.id}/review`)}`);
        throw e;
      }
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/sell/${params.id}/share`);
}

/** Step 4 of selling: everything the buyer will see, with a way back to each part, before it goes live. */
export default function SellReview({ loaderData: { listing: l, fee, limitText, ready }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const c = categoryOf(l.category);
  const photos: string[] = l.photo_keys ?? [];
  const price = Number(l.price_kobo);
  const condition = CONDITIONS.find(([v]) => v === l.condition);
  const edit = (step: "photos" | "details", what: string) => <Link to={`/sell/${l.id}/${step}`} className="caption tap edit-link" aria-label={`Edit ${what}`}>Edit</Link>;
  return (
    <Form method="post">
      <TopBar title={<span>Review <span className="caption muted">Step 4 of 4</span></span>} back={`/sell/${l.id}/details`} />
      <main className="page narrow stack-4">
        <div className="stack">
          <h1 className="heading">Check your listing</h1>
          <p className="body muted">This is what buyers will see. Tap Edit to change anything before it goes live.</p>
        </div>

        <section className="card flat review-preview" aria-label="How buyers see it">
          <div className="review-photos" tabIndex={0} role="region" aria-label={`${photos.length} photos (scrolls sideways)`}>
            {photos.map((k, i) => (
              <div key={k} className="review-photo"><img src={photoUrl(k)} alt={`Photo ${i + 1}`} />{i === 0 ? <span className="tag">Cover</span> : null}</div>
            ))}
          </div>
          <div className="stack" style={{ padding: "var(--space-4)" }}>
            <p className="title">{l.title}</p>
            <p className="big-amount">{naira(price)}</p>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="nh-status nh-status-awaiting label">{condition?.[1]} condition</span>
              {sizeLabel(l.category, l.size_system, l.size) ? <span className="nh-status nh-status-awaiting label">{sizeLabel(l.category, l.size_system, l.size)}</span> : null}
              <span className="caption muted row" style={{ gap: 4 }}><Icon name="map-pin" size={16} />{placeLabel(l.area, l.state)}</span>
            </div>
            <div className="row"><ProtectionBadge /></div>
          </div>
        </section>

        <section className="card stack" aria-labelledby="r-photos">
          <div className="row-between"><h2 id="r-photos" className="label">Photos</h2>{edit("photos", "photos")}</div>
          <p className="body">{photos.length} photos. The first is the cover.</p>
        </section>

        <section className="card" aria-labelledby="r-item">
          <div className="row-between"><h2 id="r-item" className="label">The item</h2>{edit("details", "the item")}</div>
          <Kv k="Category" v={c.label} />
          <Kv k="Title" v={l.title} />
          <Kv k="Condition" v={condition ? `${condition[1]}: ${condition[2]}` : l.condition} />
          {sizeRuleFor(l.category) ? <Kv k={sizeRuleFor(l.category)!.label} v={sizeLabel(l.category, l.size_system, l.size) ?? <span className="muted">Not given</span>} /> : null}
          <Kv k="How many" v={Number(l.quantity) > 1 ? `${l.quantity} for sale, one per buyer` : "1"} />
          {c.id && l.imei_or_serial ? <Kv k={c.id.label.replace(" (optional)", "")} v={<span>{l.imei_or_serial}<br /><span className="caption muted">Buyers see it only after they pay.</span></span>} /> : null}
        </section>

        <section className="card" aria-labelledby="r-price">
          <div className="row-between"><h2 id="r-price" className="label">Price</h2>{edit("details", "the price")}</div>
          <Kv k="Your price" v={naira(price)} />
          <Kv k="NosHen fee, paid by the buyer" v={naira(fee)} />
          <Kv k="Buyer pays" v={naira(price + fee)} />
          <Kv k="You get" v={naira(price)} total />
        </section>
        {limitText ? <Info icon="alert-triangle" tone="warn">{limitText}</Info> : null}

        <section className="card" aria-labelledby="r-place">
          <div className="row-between"><h2 id="r-place" className="label">Where it is</h2>{edit("details", "where it is")}</div>
          <Kv k="Area" v={placeLabel(l.area, l.state)} />
          <p className="caption muted">Buyers see the area, never your address.</p>
        </section>

        <section className="card" aria-labelledby="r-delivery">
          <div className="row-between"><h2 id="r-delivery" className="label">Getting it</h2>{edit("details", "delivery")}</div>
          <Kv k="Meet-up" v="Free" />
          {deliveryZones(l).map((z) => <Kv key={z.zone} k={`Delivery ${z.label}`} v={deliveryPriceLabel(z.kobo)} />)}
          <p className="caption muted">{offersDelivery(l)
            ? "The buyer pays delivery with the price. You get it when the deal closes, and you send the item with photos of it packed."
            : "Meet-up only. You can add delivery prices later from your listing."}</p>
        </section>

        <section className="card stack" aria-labelledby="r-desc">
          <div className="row-between"><h2 id="r-desc" className="label">Description</h2>{edit("details", "the description")}</div>
          {l.description ? <p className="body" style={{ whiteSpace: "pre-line" }}>{l.description}</p> : <p className="body muted">None. A few words on its condition and what comes with it help it sell.</p>}
        </section>

        {!ready ? (
          <Info icon="shield-check">Before it goes live, NosHen checks your ID and bank account. Tapping Publish takes you there, then straight back here.</Info>
        ) : null}

        <label className="check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span className="body">This is mine to sell, it's described honestly, and it isn't a <Link to="/prohibited-items">prohibited item</Link>.</span>
        </label>

        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction>
          <Button type="submit" variant="primary" size="lg" block icon="shield-check" disabled={busy}>{busy ? "Publishing…" : ready ? "Publish listing" : "Verify, then publish"}</Button>
        </BottomAction>
      </main>
    </Form>
  );
}
