import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-review";
import { SellSteps } from "../lib/sell-steps";
import { SellHelp } from "../lib/sell-help";
import { requireUser, withApp, messageOf } from "../../server/web";
import { publish, sellerReady } from "@noshen/engine/sellers";
import { DealError, settingsOf } from "@noshen/engine/core";
import { sellerLimit } from "@noshen/engine/deals";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, Info, Kv, ProtectionBadge, TopBar } from "@noshen/ui/ui";
import { CONDITIONS } from "@noshen/shared/deal";
import { categoryOf, isService } from "@noshen/shared/categories";
import type { Stage } from "@noshen/shared/stages";
import { feeFor, naira } from "@noshen/shared/money";
import { clock, photoUrl, posterUrl } from "@noshen/shared/photos";
import { placeLabel } from "@noshen/shared/locations";
import { overLimit, sellerLimitText } from "@noshen/shared/limits";
import { sizeLabel, sizeProblem, sizeRuleFor } from "@noshen/shared/sizes";
import { deliveryPriceLabel, deliveryZones, offersDelivery } from "@noshen/shared/delivery";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { StagesCard } from "../lib/stages";

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
    if (l.title === "Untitled listing" || !l.state || !l.area?.trim() || sizeProblem(l.category, l.size_system, l.size)
      || (isService(l.category) && !(Array.isArray(l.stages) && l.stages.length))) throw redirect(`/sell/${l.id}/details`);
    const s = await settingsOf(d);
    const price = Number(l.price_kobo);
    const limit = await sellerLimit(d.db, user.id, s);
    return {
      listing: l, fee: feeFor(price, s.fee),
      limit: overLimit(price, limit) ? limit : null,
      ready: (await sellerReady(d, user.id)).ready,
      help: s.support_whatsapp,
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  if (f.get("confirm") !== "yes") return { error: msg("Tick the box to confirm the item is yours to sell and described honestly.") };
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      try {
        await publish(d, user.id, params.id, f.get("visibility") === "link" ? "link" : "public");
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
export default function SellReview({ loaderData: { listing: l, fee, limit, ready, help }, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const c = categoryOf(l.category);
  const photos: string[] = l.photo_keys ?? [];
  const price = Number(l.price_kobo);
  const condition = CONDITIONS.find(([v]) => v === l.condition);
  const size = sizeLabel(l.category, l.size_system, l.size);
  const limitText = limit ? sellerLimitText(limit, "seller", t) : null;
  const job = isService(l.category);
  const edit = (step: "photos" | "details", what: string) => <Link to={`/sell/${l.id}/${step}`} className="caption tap edit-link" aria-label={t("Edit {what}", { what })}>{t("Edit")}</Link>;
  return (
    <Form method="post">
      <TopBar title={t("Publish")} back={`/sell/${l.id}/details`} />
      <main className="page narrow stack-4">
        <SellSteps at={4} id={l.id} />
        <div className="stack">
          <h1 className="heading">{t("Check your listing")}</h1>
          <p className="body muted">{t("This is what buyers will see. Tap Edit to change anything before it goes live.")}</p>
        </div>

        <section className="card flat review-preview" aria-label={t("How buyers see it")}>
          <div className="review-photos" tabIndex={0} role="region" aria-label={t("{n} photos (scrolls sideways)", { n: photos.length })}>
            {photos.map((k, i) => [
              <div key={k} className="review-photo"><img src={photoUrl(k, "small")} alt={t("Photo {n}", { n: i + 1 })} />{i === 0 ? <span className="tag">{t("Cover")}</span> : null}</div>,
              // The video comes second, as on the listing.
              i === 0 && l.video_key ? (
                <div key="video" className="review-photo review-video" style={{ backgroundImage: `url("${posterUrl(l.video_key)}")` }} role="img" aria-label={t("Your video")}>
                  <span className="review-video-play" aria-hidden="true"><Icon name="player-play" size={18} className="filled" /></span>
                  {l.video_seconds !== null ? <span className="tag">{clock(l.video_seconds)}</span> : null}
                </div>
              ) : null,
            ])}
          </div>
          <div className="stack" style={{ padding: "var(--space-4)" }}>
            <p className="title">{l.title}</p>
            <p className="big-amount">{naira(price)}</p>
            <div className="row wrap" style={{ gap: 8 }}>
              {job ? <span className="nh-status nh-status-awaiting label">{t("Paid in {n} stages", { n: l.stages.length })}</span>
                : <span className="nh-status nh-status-awaiting label">{t("{condition} condition", { condition: condition ? t(condition[1]) : "" })}</span>}
              {size ? <span className="nh-status nh-status-awaiting label">{size}</span> : null}
              <span className="caption muted row" style={{ gap: 4 }}><Icon name="map-pin" size={16} />{placeLabel(l.area, l.state)}</span>
            </div>
            <div className="row"><ProtectionBadge /></div>
          </div>
        </section>

        <section className="card stack" aria-labelledby="r-photos">
          <div className="row-between"><h2 id="r-photos" className="label">{t("Photos")}</h2>{edit("photos", t("photos"))}</div>
          <p className="body">{t("{n} photos. The first is the cover.", { n: photos.length })}</p>
        </section>

        <section className="card" aria-labelledby="r-item">
          <div className="row-between"><h2 id="r-item" className="label">{job ? t("The job") : t("The item")}</h2>{edit("details", job ? t("the job") : t("the item"))}</div>
          <Kv k={t("Category")} v={t(c.label)} />
          <Kv k={t("Title")} v={l.title} />
          {job ? null : <Kv k={t("Condition")} v={condition ? `${t(condition[1])}: ${t(condition[2])}` : l.condition} />}
          {sizeRuleFor(l.category) ? <Kv k={t(sizeRuleFor(l.category)!.label)} v={size ?? <span className="muted">{t("Not given")}</span>} /> : null}
          <Kv k={t("How many")} v={Number(l.quantity) > 1 ? (job ? t("{n} buyers can book it", { n: l.quantity }) : t("{n} for sale, one per buyer", { n: l.quantity })) : "1"} />
          {c.id && l.imei_or_serial ? <Kv k={t(c.id.label).replace(/ \(.*\)$/, "")} v={<span>{l.imei_or_serial}<br /><span className="caption muted">{t("Buyers see it only after they pay.")}</span></span>} /> : null}
        </section>

        <section className="card" aria-labelledby="r-price">
          <div className="row-between"><h2 id="r-price" className="label">{t("Price")}</h2>{edit("details", t("the price"))}</div>
          <Kv k={t("Your price")} v={naira(price)} />
          <Kv k={t("NosHen fee, paid by the buyer")} v={naira(fee)} />
          <Kv k={t("Buyer pays")} v={naira(price + fee)} />
          <Kv k={t("You get")} v={naira(price)} total />
        </section>
        {limitText ? <Info icon="alert-triangle" tone="warn">{limitText}</Info> : null}
        {job ? <StagesCard stages={l.stages as Stage[]} priceKobo={price} editTo={`/sell/${l.id}/details`} /> : null}

        <section className="card" aria-labelledby="r-place">
          <div className="row-between"><h2 id="r-place" className="label">{job ? t("Where you work") : t("Where it is")}</h2>{edit("details", job ? t("where you work") : t("where it is"))}</div>
          <Kv k={t("Area")} v={placeLabel(l.area, l.state)} />
          <p className="caption muted">{t("Buyers see the area, never your address.")}</p>
        </section>

        {job ? null : <section className="card" aria-labelledby="r-delivery">
          <div className="row-between"><h2 id="r-delivery" className="label">{t("Getting it")}</h2>{edit("details", t("delivery"))}</div>
          <Kv k={t("Meet-up")} v={t("Free")} />
          {deliveryZones(l, t).map((z) => <Kv key={z.zone} k={z.label} v={deliveryPriceLabel(z.kobo, t)} />)}
          <p className="caption muted">{offersDelivery(l)
            ? t("The buyer pays delivery with the price. You get it when the deal closes, and you send the item with photos of it packed.")
            : t("Meet-up only. You can add delivery prices later from your listing.")}</p>
        </section>}

        <section className="card stack" aria-labelledby="r-desc">
          <div className="row-between"><h2 id="r-desc" className="label">{t("Description")}</h2>{edit("details", t("the description"))}</div>
          {l.description ? <p className="body" style={{ whiteSpace: "pre-line" }}>{l.description}</p> : <p className="body muted">{job ? t("None. A few words on what you do and what's included help buyers choose you.") : t("None. A few words on its condition and what comes with it help it sell.")}</p>}
        </section>

        {!ready ? (
          <Info icon="shield-check">{t("Before it goes live, NosHen checks your ID and bank account. Tapping Publish takes you there, then straight back here.")}</Info>
        ) : null}

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("Who can find it?")}</legend>
          <label className="choice">
            <input type="radio" name="visibility" value="public" defaultChecked />
            <span className="stack" style={{ gap: 0 }}><span className="body">{t("Everyone on NosHen")}</span><span className="caption muted">{t("It shows in Browse and search, and you can share its link too. You accept each buyer.")}</span></span>
          </label>
          <label className="choice">
            <input type="radio" name="visibility" value="link" />
            <span className="stack" style={{ gap: 0 }}><span className="body">{t("Only people with the link")}</span><span className="caption muted">{t("A protected checkout link for your Instagram, WhatsApp or Facebook. It doesn't show in Browse, and buyers who open it go straight to paying.")}</span></span>
          </label>
        </fieldset>

        <label className="check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span className="body">{t.rich("This is mine to sell, it's described honestly, and it isn't a <list>prohibited item</list>.", { list: (s) => <Link to="/prohibited-items">{s}</Link> })}</span>
        </label>

        <ErrorText>{actionData?.error}</ErrorText>
        <SellHelp whatsapp={help} step={t("Publish")} />
        <BottomAction>
          <Button type="submit" variant="primary" size="lg" block icon="shield-check" disabled={busy}>{busy ? t("Publishing…") : ready ? t("Publish listing") : t("Verify, then publish")}</Button>
        </BottomAction>
      </main>
    </Form>
  );
}
