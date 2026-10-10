import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/browse";
import { withApp } from "../../server/web";
import { browse, areasWithListings } from "../../server/engine/queries";
import { Button, Icon, ListingCard, ProtectionBadge, Wordmark } from "../components/ui";
import { ago } from "../../shared/time";
import { CATEGORIES, categoryOf, isCategory } from "../../shared/categories";
import { photoUrl } from "../../shared/photos";

export const meta: Route.MetaFunction = () => [
  { title: "NosHen: buy and sell anything in Lagos, protected" },
  { name: "description", content: "Every deal is protected: your money is held until you have the item." },
];

export async function loader({ request }: Route.LoaderArgs) {
  const u = new URL(request.url);
  const f = { cat: u.searchParams.get("cat") ?? "", area: u.searchParams.get("area") ?? "", sort: u.searchParams.get("sort") ?? "", q: u.searchParams.get("q") ?? "" };
  return withApp(async (d) => ({ listings: await browse(d.db, f), areas: await areasWithListings(d.db), f }));
}

export default function Browse({ loaderData }: Route.ComponentProps) {
  const { listings, areas, f } = loaderData;
  const [params] = useSearchParams();
  const link = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    return `?${p.toString()}`;
  };

  const filters = (
    <div className="stack-4">
      <div className="stack">
        <p className="label">Category</p>
        <div className="chips cat-chips">
          <Link to={link("cat", "")} className="chip" aria-current={!f.cat ? "true" : undefined}><Icon name="layout-grid" size={16} />All</Link>
          {CATEGORIES.map((c) => <Link key={c.key} to={link("cat", c.key)} className="chip" aria-current={f.cat === c.key ? "true" : undefined}><Icon name={c.icon} size={16} />{c.label}</Link>)}
        </div>
      </div>
      <div className="stack">
        <p className="label">Area</p>
        <div className="chips">
          <Link to={link("area", "")} className="chip" aria-current={!f.area ? "true" : undefined}>All of Lagos</Link>
          {areas.map((a) => <Link key={a} to={link("area", a)} className="chip" aria-current={f.area === a ? "true" : undefined}>{a}</Link>)}
        </div>
      </div>

    </div>
  );
  const search = (
    <Form method="get" className="search-pill" role="search">
      {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
      {f.area ? <input type="hidden" name="area" value={f.area} /> : null}
      {f.sort ? <input type="hidden" name="sort" value={f.sort} /> : null}
      <Icon name="search" size={20} />
      <label className="sr-only" htmlFor="q">Search listings</label>
      <input id="q" name="q" type="search" defaultValue={f.q} placeholder="Search phones, shoes, cars, sofas…" autoComplete="off" />
      {f.q ? <Link to={link("q", "")} className="search-clear" aria-label="Clear search"><Icon name="x" size={16} /></Link> : null}
    </Form>
  );
  return (
    <>
      <header className="pill-bar browse-top mobile-only">
        <Link to="/" aria-label="NosHen home" style={{ textDecoration: "none" }}><Wordmark size="sm" /></Link>
        <ProtectionBadge>Every deal protected</ProtectionBadge>
      </header>
      <main className="page">
        <div className="browse-layout">
          <aside className="desktop-only card filter-card">{filters}</aside>
          <div className="stack-4">
            <div className="browse-head">
              <div className="stack">
                <h1 className="heading">{f.q ? `Results for “${f.q}”` : isCategory(f.cat) ? `${categoryOf(f.cat).label} in Lagos` : "For sale in Lagos"}</h1>
                <p className="caption muted">{listings.length} listing{listings.length === 1 ? "" : "s"}. Every deal is protected: your money is held until you have the item.</p>
              </div>
              <div className="row browse-tools">
                {search}
                <Form method="get" className="row">
                  {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
                  {f.area ? <input type="hidden" name="area" value={f.area} /> : null}
                  {f.q ? <input type="hidden" name="q" value={f.q} /> : null}
                  <label className="sr-only" htmlFor="sort">Sort</label>
                  <select id="sort" name="sort" className="nh-input sort-select" defaultValue={f.sort} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                    <option value="">Newest first</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                  </select>
                </Form>
              </div>
            </div>
            <div className="mobile-only">{filters}</div>
            {listings.length === 0 ? (
              <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
                <span className="empty-icon"><Icon name="search" size={26} /></span>
                <p className="title">Nothing here yet</p>
                <p className="body muted">Try another search or area, or list something yourself.</p>
                <Button variant="primary" pill to="/sell" icon="plus">Sell something</Button>
              </div>
            ) : (
              <div className="grid-cards">
                {listings.map((l: any) => (
                  <ListingCard key={l.id} href={`/l/${l.id}`} title={l.title} priceKobo={l.price_kobo} area={`${l.area}, Lagos`}
                    posted={ago(l.published_at)} imageUrl={l.photo_keys?.[0] ? photoUrl(l.photo_keys[0]) : undefined} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
