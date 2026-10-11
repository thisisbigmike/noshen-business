import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/browse";
import { withApp } from "../../server/web";
import { browse, statesWithListings } from "@noshen/engine/queries";
import { Button, Icon, ListingCard, ProtectionBadge, Select, Wordmark } from "@noshen/ui/ui";
import { ago } from "@noshen/shared/time";
import { CATEGORIES, categoryOf, isCategory } from "@noshen/shared/categories";
import { photoUrl } from "@noshen/shared/photos";
import { ThemeToggle } from "@noshen/ui/theme";
import { NIGERIA_STATES, comingSoonList, isState, placeLabel, stateLabel } from "@noshen/shared/locations";

export const meta: Route.MetaFunction = () => [
  { title: "NosHen: buy and sell anything in Nigeria, protected" },
  { name: "description", content: "Every deal is protected: your money is held until you have the item." },
];

export async function loader({ request }: Route.LoaderArgs) {
  const u = new URL(request.url);
  const state = u.searchParams.get("state") ?? "";
  const f = { cat: u.searchParams.get("cat") ?? "", state: isState(state) ? state : "", sort: u.searchParams.get("sort") ?? "", q: u.searchParams.get("q") ?? "" };
  return withApp(async (d) => ({ listings: await browse(d.db, f), states: await statesWithListings(d.db), f }));
}

export default function Browse({ loaderData }: Route.ComponentProps) {
  const { listings, states, f } = loaderData;
  const counts = new Map(states.map((s) => [s.state, s.n]));
  const where = f.state ? stateLabel(f.state) : "Nigeria";
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
      <Form method="get" className="stack">
        {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
        {f.q ? <input type="hidden" name="q" value={f.q} /> : null}
        {f.sort ? <input type="hidden" name="sort" value={f.sort} /> : null}
        <Select name="state" label="Location" submitOnChange defaultValue={f.state} options={[
          { value: "", label: "All of Nigeria" },
          ...NIGERIA_STATES.map((st) => ({ value: st, label: counts.get(st) ? `${stateLabel(st)} (${counts.get(st)})` : stateLabel(st) })),
        ]} />
        <p className="caption muted">{comingSoonList()} are coming soon.</p>
      </Form>

    </div>
  );
  const search = (
    <Form method="get" className="search-pill" role="search">
      {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
      {f.state ? <input type="hidden" name="state" value={f.state} /> : null}
      {f.sort ? <input type="hidden" name="sort" value={f.sort} /> : null}
      <Icon name="search" size={20} />
      <label className="sr-only" htmlFor="q">Search listings</label>
      <input id="q" name="q" type="search" defaultValue={f.q} placeholder="Search phones, cars, hair… or a town" autoComplete="off" />
      {f.q ? <Link to={link("q", "")} className="search-clear" aria-label="Clear search"><Icon name="x" size={16} /></Link> : null}
    </Form>
  );
  return (
    <>
      <header className="pill-bar browse-top mobile-only">
        <Link to="/" aria-label="NosHen home" style={{ textDecoration: "none" }}><Wordmark size="sm" /></Link>
        <span className="row" style={{ gap: 4 }}><ProtectionBadge>Every deal protected</ProtectionBadge><ThemeToggle /></span>
      </header>
      <main className="page">
        <div className="browse-layout">
          <aside className="desktop-only card filter-card">{filters}</aside>
          <div className="stack-4">
            <div className="browse-head">
              <div className="stack">
                <h1 className="heading">{f.q ? `Results for “${f.q}”` : isCategory(f.cat) ? `${categoryOf(f.cat).label} in ${where}` : f.state ? `For sale in ${where}` : "For sale across Nigeria"}</h1>
                <p className="caption muted">{listings.length} listing{listings.length === 1 ? "" : "s"}. Every deal is protected: your money is held until you have the item.</p>
              </div>
              <div className="row browse-tools">
                {search}
                <Form method="get" className="row">
                  {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
                  {f.state ? <input type="hidden" name="state" value={f.state} /> : null}
                  {f.q ? <input type="hidden" name="q" value={f.q} /> : null}
                  <Select name="sort" label="Sort" hideLabel pill submitOnChange defaultValue={f.sort} options={[
                    { value: "", label: "Newest first" },
                    { value: "price_asc", label: "Price: low to high" },
                    { value: "price_desc", label: "Price: high to low" },
                  ]} />
                </Form>
              </div>
            </div>
            <div className="mobile-only">{filters}</div>
            {listings.length === 0 ? (
              <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
                <span className="empty-icon"><Icon name="search" size={26} /></span>
                <p className="title">Nothing here yet</p>
                <p className="body muted">{f.state ? `Nothing in ${where} yet. Try all of Nigeria, another search, or list something yourself.` : "Try another search, or list something yourself."}</p>
                <Button variant="primary" pill to="/sell" icon="plus">Sell something</Button>
              </div>
            ) : (
              <div className="grid-cards">
                {listings.map((l: any) => (
                  <ListingCard key={l.id} href={`/l/${l.id}`} title={l.title} priceKobo={l.price_kobo} area={placeLabel(l.area, l.state)}
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
