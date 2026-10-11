import { useRef, useState } from "react";
import { Link, data } from "react-router";
import type { Route } from "./+types/listing";
import { optionalUser, withApp } from "../../server/web";
import { listingView } from "@noshen/engine/queries";
import { settingsOf } from "@noshen/engine/core";
import { Avatar, BottomAction, Button, Icon, Info, Kv, PhotoViewer, ProtectionBadge, TopBar, Wordmark } from "@noshen/ui/ui";
import { feeFor, naira } from "@noshen/shared/money";
import { CONDITIONS, firstName } from "@noshen/shared/deal";
import { categoryOf } from "@noshen/shared/categories";
import { ago } from "@noshen/shared/time";
import { photoUrl } from "@noshen/shared/photos";
import { placeLabel } from "@noshen/shared/locations";
import { overLimit, sellerLimit, sellerLimitText } from "@noshen/engine/deals";

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
    const limitText = overLimit(price, limit) ? sellerLimitText(limit, mine ? "seller" : "buyer") : null;
    return { ...v, fee: feeFor(price, s.fee), mine, limitText, origin: new URL(request.url).origin };
  });
}

// Link previews on WhatsApp and Facebook (PRD R4): photo, price and "Protected by NosHen".
export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [{ title: "Listing not found · NosHen" }];
  const l = d.listing;
  const title = `${l.title} · ${naira(l.price_kobo)}`;
  const desc = `${placeLabel(l.area, l.state)}. Protected by NosHen: your money is held until you have the item.`;
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
  const { listing: l, seller, fee, mine, limitText } = loaderData;
  const [photo, setPhoto] = useState(0);
  const photos: string[] = l.photo_keys ?? [];
  // Tapping a photo opens it full size; closing comes back to the photo they ended on.
  const [viewing, setViewing] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeViewer = (at: number) => {
    setViewing(null);
    const t = trackRef.current;
    if (t) t.scrollTo({ left: at * t.clientWidth });
  };
  const sellerName = firstName(seller.name);
  const condition = CONDITIONS.find(([k]) => k === l.condition);
  const price = Number(l.price_kobo);
  const cat = categoryOf(l.category);
  const status = l.status !== "live" ? (l.status === "sold" ? "This item has been sold." : "This listing is paused.") : null;

  const buy = mine ? (
    <Button variant="secondary" size="lg" block to="/sell">This is your listing</Button>
  ) : status || limitText ? (
    <Button size="lg" block to="/browse">See more listings</Button>
  ) : (
    <Button variant="primary" size="lg" block icon="shield-check" to={`/l/${l.id}/buy`}>Buy with protection</Button>
  );

  return (
    <div>
      <TopBar title={<Wordmark size="sm" />} back="/browse" right={<Link className="caption" style={{ padding: "0 8px" }} to="/browse">See more listings</Link>} />
      <main className="page flush no-tabs">
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/browse">Browse</Link> / <Link to={`/browse?cat=${cat.key}`}>{cat.label}</Link> / {placeLabel(l.area, l.state)}</nav>
        <div className="two-col">
          <div className="stack-4">
            <div className="carousel bleed">
              <div className="track" ref={trackRef} tabIndex={0} role="region" aria-label={`Photos, ${photos.length || 0} in all. Use the arrow keys to move between them, and Enter to see one full size.`} onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
                {photos.length ? photos.map((k, i) => (
                  <button key={k} type="button" className="photo-open" aria-label={`Photo ${i + 1} of ${photos.length}. See it full size`} onClick={() => setViewing(i)}>
                    <img src={photoUrl(k)} alt="" />
                  </button>
                )) : <div className="nh-listing-photo" style={{ width: "100%" }}><Icon name="camera" size={32} label="No photo yet" /></div>}
              </div>
              {photos.length ? <span className="count caption">{photo + 1} / {photos.length}</span> : null}
              {photos.length > 1 ? <span className="dots" aria-hidden="true">{photos.map((k, i) => <span key={k} className={i === photo ? "on" : undefined} />)}</span> : null}
            </div>
            <div className="stack mobile-only">
              <h1 className="title">{l.title}</h1>
              <p className="big-amount">{naira(price)}</p>
              <div className="row wrap"><span className="nh-status nh-status-awaiting label">{condition?.[1]} condition</span><span className="caption muted row"><Icon name="map-pin" size={16} />{placeLabel(l.area, l.state)} · {ago(l.published_at)}</span></div>
              <div className="row"><ProtectionBadge /></div>
            </div>
            {status ? <p className="info warn">{status}</p> : null}
            {!status && limitText ? <div className="mobile-only"><Info icon="info-circle">{limitText}</Info></div> : null}
            <SellerCard seller={seller} area={placeLabel(l.area, l.state)} />
            <section className="card stack-4" aria-labelledby="how">
              <h2 id="how" className="title">How protection works</h2>
              <div className="steps4">
                {["You pay NosHen", "Money is held", "You check the item", `${sellerName} is paid`].map((t, i) => (
                  <div key={t} className="stack" style={{ alignItems: "center" }}><span className="step-n">{i + 1}</span><span className="caption">{t}</span></div>
                ))}
              </div>
            </section>
            <section className="card stack">
              <h2 className="title">About this {cat.noun === "pair" ? "pair" : cat.noun}</h2>
              <Kv k="Category" v={cat.label} />
              <Kv k="Condition" v={`${condition?.[1]}: ${condition?.[2]}`} />
              <Kv k="Location" v={placeLabel(l.area, l.state)} />
              {cat.id && l.imei_or_serial ? <Kv k={cat.id.label.replace(" (optional)", "")} v="Shown to you after you pay, so you can check it at the hand-over" /> : null}
              {l.description ? <><p className="label" style={{ marginTop: 8 }}>From {sellerName}</p><p className="body">{l.description}</p></> : null}
            </section>
          </div>
          <aside className="side desktop-only card stack-4">
            <h1 className="heading">{l.title}</h1>
            <p className="big-amount">{naira(price)}</p>
            <div className="row wrap"><span className="nh-status nh-status-awaiting label">{condition?.[1]} condition</span><span className="caption muted">{placeLabel(l.area, l.state)} · {ago(l.published_at)}</span></div>
            <ProtectionBadge />
            {!status && limitText ? <Info icon="info-circle">{limitText}</Info> : null}
            {buy}
            <div><Kv k="Price" v={naira(price)} /><Kv k="NosHen fee" v={naira(fee)} /><Kv k="Total" v={naira(price + fee)} total /></div>
            {limitText ? null : <p className="caption muted">You pay nothing until {sellerName} accepts.</p>}
          </aside>
        </div>
      </main>
      {viewing !== null ? (
        <PhotoViewer label={`Photos of ${l.title}`} start={viewing} onClose={closeViewer}
          photos={photos.map((k, i) => ({ src: photoUrl(k), alt: `${l.title}, photo ${i + 1} of ${photos.length}` }))} />
      ) : null}
      <aside className="mobile-only" aria-label="Buy this item">
        <BottomAction staticOnDesktop={false}>
          {limitText ? null : <p className="caption muted" style={{ textAlign: "center" }}>You pay nothing until {sellerName} accepts.</p>}
          {buy}
        </BottomAction>
      </aside>
    </div>
  );
}

function SellerCard({ seller, area }: { seller: { name: string; idVerified: boolean; rating: number | null; ratingCount: number; completedDeals: number }; area: string }) {
  return (
    <section className="card stack-4" aria-label="Seller">
      <div className="row"><Avatar name={seller.name} /><div><p className="title">{firstName(seller.name)}</p><p className="caption muted">Seller in {area}</p></div></div>
      <div className="stats">
        <div className="stat"><p className="label">{seller.idVerified ? "ID" : "—"}</p><p className="caption muted">{seller.idVerified ? "Verified" : "Not verified"}</p></div>
        <div className="stat"><p className="label">{seller.rating ?? "New"}</p><p className="caption muted">Rating</p></div>
        <div className="stat"><p className="label">{seller.completedDeals}</p><p className="caption muted">Completed deals</p></div>
      </div>
    </section>
  );
}
