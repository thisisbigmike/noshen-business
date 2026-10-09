import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/browse";
import { withApp } from "../../server/web";
import { browse, areasWithListings } from "../../server/engine/queries";
import { ListingCard, ProtectionBadge } from "../components/ui";
import { ago } from "../../shared/time";
import { photoUrl } from "../../shared/photos";

export const meta: Route.MetaFunction = () => [
  { title: "NosHen: buy and sell phones and laptops in Lagos, protected" },
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
  const cats: [string, string][] = [["", "All"], ["phone", "Phones"], ["laptop", "Laptops"]];
  const filters = (
    <div className="stack-4">
      <div className="stack">
        <p className="label">Category</p>
        <div className="chips">{cats.map(([v, l]) => <Link key={v} to={link("cat", v)} className="chip" aria-current={f.cat === v ? "true" : undefined}>{l}</Link>)}</div>
      </div>
      <div className="stack">
        <p className="label">Area</p>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          <Link to={link("area", "")} className="chip" aria-current={!f.area ? "true" : undefined}>All of Lagos</Link>
          {areas.map((a) => <Link key={a} to={link("area", a)} className="chip" aria-current={f.area === a ? "true" : undefined}>{a}</Link>)}
        </div>
      </div>
      <p className="caption muted">Deals start at ₦20,000.</p>
    </div>
  );
  return (
    <main className="page">
      <div className="browse-layout">
        <aside className="desktop-only card">{filters}</aside>
        <div className="stack-4">
          <div className="row-between wrap">
            <div className="stack">
              <h1 className="heading">Phones and laptops in Lagos</h1>
              <p className="caption muted">{listings.length} listing{listings.length === 1 ? "" : "s"}. Every deal is protected: your money is held until you have the item.</p>
            </div>
            <Form method="get" className="row" role="search">
              {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
              {f.area ? <input type="hidden" name="area" value={f.area} /> : null}
              <label className="sr-only" htmlFor="sort">Sort</label>
              <select id="sort" name="sort" className="nh-input" defaultValue={f.sort} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                <option value="">Newest first</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </Form>
          </div>
          <div className="mobile-only stack-4">{filters}</div>
          {listings.length === 0 ? (
            <div className="card stack" style={{ alignItems: "flex-start" }}>
              <p className="title">Nothing here yet</p>
              <p className="body muted">Try another area, or list something yourself.</p>
              <Link to="/sell">Sell a phone or laptop</Link>
            </div>
          ) : (
            <div className="grid-cards">
              {listings.map((l: any) => (
                <ListingCard key={l.id} href={`/l/${l.id}`} title={l.title} priceKobo={l.price_kobo} area={`${l.area}, Lagos`}
                  posted={ago(l.published_at)} imageUrl={l.photo_keys?.[0] ? photoUrl(l.photo_keys[0]) : undefined} />
              ))}
            </div>
          )}
          <div className="row"><ProtectionBadge>Every deal protected</ProtectionBadge></div>
        </div>
      </div>
    </main>
  );
}
