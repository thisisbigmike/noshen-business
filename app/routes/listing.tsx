import { useState } from "react";
import { Link, data } from "react-router";
import type { Route } from "./+types/listing";
import { optionalUser, withApp } from "../../server/web";
import { listingView } from "../../server/engine/queries";
import { settingsOf } from "../../server/engine/core";
import { Avatar, BottomAction, Button, Icon, Kv, ProtectionBadge, TopBar, Wordmark } from "../components/ui";
import { feeFor, naira } from "../../shared/money";
import { CONDITIONS, firstName } from "../../shared/deal";
import { categoryOf } from "../../shared/categories";
import { ago } from "../../shared/time";
import { photoUrl } from "../../shared/photos";

export const handle = { tabs: false };

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const v = await listingView(d.db, params.id);
    if (!v || ["draft", "removed", "blocked"].includes(v.listing.status)) throw data("Not found", { status: 404 });
    const s = await settingsOf(d);
    const user = await optionalUser(request, d);
    const price = Number(v.listing.price_kobo);
    return { ...v, fee: feeFor(price, s.fee), mine: user?.id === v.listing.seller_id, origin: new URL(request.url).origin };
  });
}

// Link previews on WhatsApp and Facebook (PRD R4): photo, price and "Protected by NosHen".
export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [{ title: "Listing not found · NosHen" }];
  const l = d.listing;
  const title = `${l.title} · ${naira(l.price_kobo)}`;
  const desc = `${l.area}, Lagos. Protected by NosHen: your money is held until you have the item.`;
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
  const { listing: l, seller, fee, mine } = loaderData;
  const [photo, setPhoto] = useState(0);
  const photos: string[] = l.photo_keys ?? [];
  const sellerName = firstName(seller.name);
  const condition = CONDITIONS.find(([k]) => k === l.condition);
  const price = Number(l.price_kobo);
  const cat = categoryOf(l.category);
  const status = l.status !== "live" ? (l.status === "sold" ? "This item has been sold." : "This listing is paused.") : null;

  const buy = mine ? (
    <Button variant="secondary" size="lg" block to="/sell">This is your listing</Button>
  ) : status ? (
    <Button size="lg" block to="/browse">See more listings</Button>
  ) : (
    <Button variant="primary" size="lg" block icon="shield-check" to={`/l/${l.id}/buy`}>Buy with protection</Button>
  );

  return (
    <div>
      <TopBar title={<Wordmark size="sm" />} back="/browse" right={<Link className="caption" style={{ padding: "0 8px" }} to="/browse">See more listings</Link>} />
      <main className="page flush no-tabs">
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/browse">Browse</Link> / <Link to={`/browse?cat=${cat.key}`}>{cat.label}</Link> / {l.area}</nav>
        <div className="two-col">
          <div className="stack-4">
            <div className="carousel bleed">
              <div className="track" onScroll={(e) => setPhoto(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
                {photos.length ? photos.map((k, i) => <img key={k} src={photoUrl(k)} alt={`Photo ${i + 1} of ${photos.length}`} />) : <div className="nh-listing-photo" style={{ width: "100%" }}><Icon name="camera" size={32} label="No photo yet" /></div>}
              </div>
              {photos.length ? <span className="count caption">{photo + 1} / {photos.length}</span> : null}
              {photos.length > 1 ? <span className="dots" aria-hidden="true">{photos.map((k, i) => <span key={k} className={i === photo ? "on" : undefined} />)}</span> : null}
            </div>
            <div className="stack mobile-only">
              <h1 className="title">{l.title}</h1>
              <p className="big-amount">{naira(price)}</p>
              <div className="row wrap"><span className="nh-status nh-status-awaiting label">{condition?.[1]} condition</span><span className="caption muted row"><Icon name="map-pin" size={16} />{l.area}, Lagos · {ago(l.published_at)}</span></div>
              <div className="row"><ProtectionBadge /></div>
            </div>
            {status ? <p className="info warn">{status}</p> : null}
            <SellerCard seller={seller} area={l.area} />
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
              <Kv k="Area" v={`${l.area}, Lagos`} />
              {cat.id && l.imei_or_serial ? <Kv k={cat.id.label.replace(" (optional)", "")} v="Shown to you after you pay, so you can check it at the hand-over" /> : null}
              {l.description ? <><p className="label" style={{ marginTop: 8 }}>From {sellerName}</p><p className="body">{l.description}</p></> : null}
            </section>
          </div>
          <aside className="side desktop-only card stack-4">
            <h1 className="heading">{l.title}</h1>
            <p className="big-amount">{naira(price)}</p>
            <div className="row wrap"><span className="nh-status nh-status-awaiting label">{condition?.[1]} condition</span><span className="caption muted">{l.area}, Lagos · {ago(l.published_at)}</span></div>
            <ProtectionBadge />
            {buy}
            <div><Kv k="Price" v={naira(price)} /><Kv k="NosHen fee" v={naira(fee)} /><Kv k="Total" v={naira(price + fee)} total /></div>
            <p className="caption muted">You pay nothing until {sellerName} accepts.</p>
          </aside>
        </div>
      </main>
      <div className="mobile-only">
        <BottomAction staticOnDesktop={false}>
          <p className="caption muted" style={{ textAlign: "center" }}>You pay nothing until {sellerName} accepts.</p>
          {buy}
        </BottomAction>
      </div>
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
