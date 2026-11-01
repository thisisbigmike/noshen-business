import { useRef, useState } from "react";
import { Link, data } from "react-router";
import type { Route } from "./+types/listing";
import { optionalUser, withApp } from "../../server/web";
import { listingView } from "@noshen/engine/queries";
import { settingsOf } from "@noshen/engine/core";
import { Avatar, BottomAction, Button, Icon, Info, Kv, PhotoViewer, ProtectionBadge, TopBar, Wordmark } from "@noshen/ui/ui";
import { feeFor, naira } from "@noshen/shared/money";
import { CONDITIONS, firstName } from "@noshen/shared/deal";
import { categoryOf, isService } from "@noshen/shared/categories";
import type { Stage } from "@noshen/shared/stages";
import { ago } from "@noshen/shared/time";
import { clock, photoUrl } from "@noshen/shared/photos";
import { placeLabel } from "@noshen/shared/locations";
import { sizeLabel, sizeRuleFor } from "@noshen/shared/sizes";
import { overLimit, sellerLimit } from "@noshen/engine/deals";
import { sellerLimitText } from "@noshen/shared/limits";
import { ShareButton } from "../lib/share";
import { SellerRecord } from "../lib/track-record";
import { useLite, useT } from "@noshen/ui/i18n";
import { DeliveryCard } from "../lib/delivery";
import { StagesCard } from "../lib/stages";
import { VideoSlide } from "../lib/listing-video";
import { deliverySummary } from "@noshen/shared/delivery";

export const handle = { tabs: false };

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const v = await listingView(d.db, params.id);
    if (!v || ["draft", "removed", "blocked"].includes(v.listing.status)) throw data("Not found", { status: 404 });
    const s = await settingsOf(d);
    const user = await optionalUser(request, d);
    const price = Number(v.listing.price_kobo);
    const mine = user?.id === v.listing.seller_id;
    // Sellers who haven't verified can only take deals up to a limit. Say so here, before a buyer starts, not at the last step.
    const limit = await sellerLimit(d.db, v.listing.seller_id, s);
    return { ...v, fee: feeFor(price, s.fee), mine, limit: overLimit(price, limit) ? limit : null, sendHours: s.handover_window_hours, origin: new URL(request.url).origin };
  });
}

// Link previews on WhatsApp and Facebook (PRD R4): photo, price and "Protected by NosHen".
export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [{ title: "Listing not found · NosHen" }];
  const l = d.listing;
  const title = `${l.title} · ${naira(l.price_kobo)}`;
  const desc = isService(l.category)
    ? `${placeLabel(l.area, l.state)}. Protected by NosHen: paid stage by stage, as the work is done.`
    : `${placeLabel(l.area, l.state)}. Protected by NosHen: your money is held until you have the item.`;
  const img = l.photo_keys?.[0] ? `${d.origin}${photoUrl(l.photo_keys[0])}` : undefined;
  return [
    { title: `${title} · NosHen` },
    { name: "description", content: desc },
    { property: "og:title", content: title },
    { property: "og:description", content: desc },
    { property: "og:type", content: "product" },
    { property: "og:url", content: `${d.origin}/l/${l.id}` },
    ...(img ? [{ property: "og:image", content: img }] : []),
    { name: "twitter:card", content: "summary_large_image" },
  ];
};

export default function Listing({ loaderData }: Route.ComponentProps) {
  const { listing: l, seller, fee, mine, limit, sendHours } = loaderData;
  const t = useT();
  // Data saver: the photos on the page are the small copies; tapping one still opens it full size.
  const lite = useLite();
  const [photo, setPhoto] = useState(0);
  const photos: string[] = l.photo_keys ?? [];
  // The video, when there is one, is the second slide: the cover photo still comes first.
  const video = l.video_key ? { key: l.video_key as string, seconds: l.video_seconds === null ? null : Number(l.video_seconds) } : null;
  const slides: ({ kind: "photo"; key: string; i: number } | { kind: "video"; key: string })[] = photos.map((key, i) => ({ kind: "photo", key, i }));
  if (video) slides.splice(Math.min(1, slides.length), 0, { kind: "video", key: video.key });
  const videoAt = slides.findIndex((s) => s.kind === "video");
  const slideOf = (photoIndex: number) => Math.max(0, slides.findIndex((s) => s.kind === "photo" && s.i === photoIndex));
  const playVideo = useRef<(() => void) | null>(null);
  // Tapping a photo opens it full size; closing comes back to the photo they ended on.
  const [viewing, setViewing] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeViewer = (at: number) => {
    setViewing(null);
    const el = trackRef.current;
    if (el) el.scrollTo({ left: slideOf(at) * el.clientWidth });
  };
  // "Watch video" on another slide: glide to the video and start it, while the tap still counts as the buyer's.
  const watchVideo = () => {
    const el = trackRef.current;
    if (el) el.scrollTo({ left: videoAt * el.clientWidth, behavior: "smooth" });
    playVideo.current?.();
  };
  const sellerName = firstName(seller.name);
  const condition = CONDITIONS.find(([k]) => k === l.condition);
  const conditionWord = condition ? t(condition[1]) : "";
  const price = Number(l.price_kobo);
  const cat = categoryOf(l.category);
  const job = isService(l.category);
  const stages = (Array.isArray(l.stages) ? l.stages : []) as Stage[];
  const size = sizeLabel(l.category, l.size_system, l.size);
  const left = Math.max(0, Number(l.quantity ?? 1) - Number(l.sold_count ?? 0));
  const limitText = limit ? sellerLimitText(limit, mine ? "seller" : "buyer", t) : null;
  // How many are left, when there was more than one; "Sold" once they've all gone.
  const stock = l.status === "sold" ? <span className="nh-status nh-status-sold label">{t("Sold")}</span>
    : Number(l.quantity) > 1 && l.status === "live" ? <span className="nh-status nh-status-awaiting label">{left === 1 ? t("Last one") : t("{n} available", { n: left })}</span> : null;
  const status = l.status !== "live" ? (l.status === "sold" ? (job ? t("This job is fully booked.") : t("This item has been sold.")) : t("This listing is paused.")) : null;
  // A job shows the stages it's paid in where an item shows its condition.
  const kindChip = job ? <span className="nh-status nh-status-awaiting label">{t("Paid in {n} stages", { n: stages.length })}</span>
    : <span className="nh-status nh-status-awaiting label">{t("{condition} condition", { condition: conditionWord })}</span>;
  const delivery = deliverySummary(l, t);

  const buy = mine ? (
    <Button variant="secondary" size="lg" block to="/sell">{t("This is your listing")}</Button>
  ) : status || limitText ? (
    <Button size="lg" block to="/browse">{t("See more listings")}</Button>
  ) : (
    <Button variant="primary" size="lg" block icon="shield-check" to={`/l/${l.id}/buy`}>{job ? t("Book with protection") : t("Buy with protection")}</Button>
  );

  // The same words as the share screen after publishing.
  const shareText = t("{title} · {price}. {place}. Your money is held until you have it.", { title: l.title, price: naira(price), place: placeLabel(l.area, l.state) });
  const share = (kind: "button" | "icon") => <ShareButton kind={kind} path={`/l/${l.id}`} title={`${l.title} · ${naira(price)}`} text={shareText} />;

  return (
    <div className="listing-screen">
      <TopBar title={<Wordmark size="sm" />} back="/browse" right={share("icon")} />
      <main className="page flush no-tabs">
        <nav className="desktop-only caption muted" aria-label={t("Breadcrumb")}><Link to="/browse">{t("Browse")}</Link> / <Link to={`/browse?cat=${cat.key}`}>{t(cat.label)}</Link> / {placeLabel(l.area, l.state)}</nav>
        <div className="two-col">
          <div className="stack-4">
            <div className="carousel bleed">
              <div className="track" ref={trackRef} tabIndex={0} role="region" onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
                aria-label={video
                  ? t("Photos and a video, {n} in all. Use the arrow keys to move between them, and Enter to see a photo full size or play the video.", { n: slides.length })
                  : t("Photos, {n} in all. Use the arrow keys to move between them, and Enter to see one full size.", { n: photos.length || 0 })}>
                {slides.length ? slides.map((s) => s.kind === "video" ? (
                  <VideoSlide key={s.key} videoKey={s.key} seconds={video?.seconds ?? null} lite={lite} title={l.title} playRef={playVideo}
                    backdrop={photos[0] ? photoUrl(photos[0], "small") : undefined} />
                ) : (
                  <button key={s.key} type="button" className="photo-open" aria-label={t("Photo {n} of {total}. See it full size", { n: s.i + 1, total: photos.length })} onClick={() => setViewing(s.i)}>
                    <img src={photoUrl(s.key, lite ? "small" : undefined)} alt="" loading={s.i === 0 ? "eager" : "lazy"} decoding="async" />
                  </button>
                )) : <div className="nh-listing-photo" style={{ width: "100%" }}><Icon name="camera" size={32} label={t("No photo yet")} /></div>}
              </div>
              {slides.length ? <span className={`count caption${photo === videoAt ? " on-video" : ""}`}>{photo + 1} / {slides.length}</span> : null}
              {video && photo !== videoAt ? (
                <button type="button" className="video-jump caption" onClick={watchVideo}>
                  <Icon name="player-play" size={14} className="filled" />{video.seconds !== null ? `${t("Watch video")} · ${clock(video.seconds)}` : t("Watch video")}
                </button>
              ) : null}
              {slides.length > 1 ? <span className={`dots${photo === videoAt ? " on-video" : ""}`} aria-hidden="true">{slides.map((s, i) => <span key={s.key} className={[i === photo && "on", s.kind === "video" && "video"].filter(Boolean).join(" ") || undefined} />)}</span> : null}
            </div>
            <div className="stack mobile-only">
              <h1 className="title">{l.title}</h1>
              <p className="big-amount">{naira(price)}</p>
              <div className="row wrap">{kindChip}{size ? <span className="nh-status nh-status-awaiting label">{size}</span> : null}{stock}<span className="caption muted row"><Icon name="map-pin" size={16} />{placeLabel(l.area, l.state)} · {ago(l.published_at)}</span></div>
              <div className="row"><ProtectionBadge /></div>
            </div>
            {status ? <p className="info warn">{status}</p> : null}
            {l.visibility === "link" && !status ? <Info icon="link">{job
              ? t("This is {seller}'s protected checkout link. Book here and you go straight to paying: NosHen holds the money and pays {seller} stage by stage, as you release each one.", { seller: sellerName })
              : t("This is {seller}'s protected checkout link. Buy here and you go straight to paying: NosHen holds the money until you have the item.", { seller: sellerName })}</Info> : null}
            {!status && limitText ? <div className="mobile-only"><Info icon="info-circle">{limitText}</Info></div> : null}
            <SellerRecord person={seller} area={placeLabel(l.area, l.state)} />
            {job ? <StagesCard stages={stages} priceKobo={price} seller={sellerName} />
              : <DeliveryCard l={l} seller={sellerName} sendHours={sendHours} editTo={mine && ["live", "paused"].includes(l.status) ? `/sell/${l.id}/delivery` : undefined} />}
            <section className="card stack-4" aria-labelledby="how">
              <h2 id="how" className="title">{t("How protection works")}</h2>
              <div className="steps4">
                {(job ? [t("You pay NosHen"), t("Money is held"), t("You check each stage"), t("{seller} is paid stage by stage", { seller: sellerName })]
                  : [t("You pay NosHen"), t("Money is held"), t("You check the item"), t("{seller} is paid", { seller: sellerName })]).map((step, i) => (
                  <div key={step} className="stack" style={{ alignItems: "center" }}><span className="step-n">{i + 1}</span><span className="caption">{step}</span></div>
                ))}
              </div>
              <p className="body">{t.rich("<b>If it's not what was listed, your money doesn't move.</b> Report it before you release the money: a real person reviews it within 72 hours and tells you both why.", { b: (s) => <strong>{s}</strong> })}</p>
            </section>
            <section className="card stack">
              <h2 className="title">{t("About this {thing}", { thing: cat.noun })}</h2>
              <Kv k={t("Category")} v={t(cat.label)} />
              {job ? null : <Kv k={t("Condition")} v={condition ? `${conditionWord}: ${t(condition[2])}` : ""} />}
              {size ? <Kv k={t(sizeRuleFor(l.category)?.label ?? "Size")} v={size} /> : null}
              {Number(l.quantity) > 1 ? <Kv k={t("Available")} v={l.status === "sold" ? t("All {n} sold", { n: l.quantity }) : t("{left} of {n}", { left, n: l.quantity })} /> : null}
              <Kv k={t("Location")} v={placeLabel(l.area, l.state)} />
              {cat.id && l.imei_or_serial ? <Kv k={t(cat.id.label).replace(/ \(.*\)$/, "")} v={t("Shown to you after you pay, so you can check it at the hand-over")} /> : null}
              {l.description ? <><p className="label" style={{ marginTop: 8 }}>{t("From {seller}", { seller: sellerName })}</p><p className="body">{l.description}</p></> : null}
            </section>
          </div>
          <aside className="side desktop-only card stack-4">
            <h1 className="heading">{l.title}</h1>
            <p className="big-amount">{naira(price)}</p>
            <div className="row wrap">{kindChip}{size ? <span className="nh-status nh-status-awaiting label">{size}</span> : null}{stock}<span className="caption muted">{placeLabel(l.area, l.state)} · {ago(l.published_at)}</span></div>
            <ProtectionBadge />
            <p className="caption muted">{t("If it's not what was listed, your money doesn't move.")}</p>
            {!status && limitText ? <Info icon="info-circle">{limitText}</Info> : null}
            {buy}
            {share("button")}
            <div><Kv k={t("Price")} v={naira(price)} /><Kv k={t("NosHen fee")} v={naira(fee)} /><Kv k={t("Total")} v={naira(price + fee)} total /></div>
            {job ? <p className="caption muted row" style={{ gap: 6 }}><Icon name="tool" size={16} />{t("Paid stage by stage, as the work is done")}</p>
              : <p className="caption muted row" style={{ gap: 6 }}><Icon name="truck-delivery" size={16} />{delivery ? `${delivery}. ${t("Meet-up is free.")}` : t("Meet-up only")}</p>}
            {limitText ? null : <p className="caption muted">{t("You pay nothing until {seller} accepts.", { seller: sellerName })}</p>}
          </aside>
        </div>
      </main>
      {viewing !== null ? (
        <PhotoViewer label={t("Photos of {title}", { title: l.title })} start={viewing} onClose={closeViewer}
          photos={photos.map((k, i) => ({ src: photoUrl(k), alt: t("{title}, photo {n} of {total}", { title: l.title, n: i + 1, total: photos.length }) }))} />
      ) : null}
      <aside className="mobile-only" aria-label={job ? t("Book this job") : t("Buy this item")}>
        <BottomAction staticOnDesktop={false}>
          {limitText ? null : <p className="caption muted" style={{ textAlign: "center" }}>{t("You pay nothing until {seller} accepts.", { seller: sellerName })}</p>}
          {buy}
        </BottomAction>
      </aside>
    </div>
  );
}
