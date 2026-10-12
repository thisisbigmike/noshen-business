import { useEffect, useState } from "react";
import { Form, Link, useLocation, useSearchParams } from "react-router";
import type { Route } from "./+types/browse";
import { withApp } from "../../server/web";
import { browse, statesWithListings } from "@noshen/engine/queries";
import { Button, Icon, ListingCard, ProtectionBadge, Select, Wordmark, useEscape } from "@noshen/ui/ui";
import { sizeLabel, sizeRuleFor } from "@noshen/shared/sizes";
import { CONDITIONS } from "@noshen/shared/deal";
import { naira } from "@noshen/shared/money";
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
  const cat = u.searchParams.get("cat") ?? "";
  const f = { cat, state: isState(state) ? state : "", sort: u.searchParams.get("sort") ?? "", q: u.searchParams.get("q") ?? "" };
  // The Filters panel: price, condition, size (for things that have sizes) and verified sellers only.
  const naira_ = (k: string) => { const v = Number((u.searchParams.get(k) ?? "").replace(/[^\d]/g, "")); return v > 0 && Number.isSafeInteger(v * 100) ? v : null; };
  const rule = sizeRuleFor(cat);
  const kind = rule?.systems.find((x) => x.id === u.searchParams.get("sk")) ?? null;
  const more = {
    min: naira_("min"), max: naira_("max"),
    cond: u.searchParams.getAll("cond").filter((c) => CONDITIONS.some(([k]) => k === c)),
    sk: kind?.id ?? "", size: kind ? u.searchParams.getAll("size").filter((v) => kind.values.includes(v)) : [],
    verified: u.searchParams.get("verified") === "1",
  };
  const listings = await withApp((d) => browse(d.db, {
    ...f, minKobo: more.min ? more.min * 100 : undefined, maxKobo: more.max ? more.max * 100 : undefined,
    conditions: more.cond, sizeSystem: more.sk || undefined, sizes: more.size, verifiedOnly: more.verified,
  }));
  return { listings, states: await withApp((d) => statesWithListings(d.db)), f, more };
}

export default function Browse({ loaderData }: Route.ComponentProps) {
  const { listings, states, f, more } = loaderData;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setFiltersOpen(false); }, [location.search]);
  useEscape(filtersOpen, () => setFiltersOpen(false));
  // What's on, as chips you can tap to take off.
  const rule = sizeRuleFor(f.cat);
  const active: { label: string; drop: (p: URLSearchParams) => void }[] = [
    ...(more.min || more.max ? [{ label: more.min && more.max ? `${naira(more.min * 100)} to ${naira(more.max * 100)}` : more.min ? `From ${naira(more.min * 100)}` : `Up to ${naira(more.max! * 100)}`, drop: (p: URLSearchParams) => { p.delete("min"); p.delete("max"); } }] : []),
    ...more.cond.map((c) => ({ label: CONDITIONS.find(([k]) => k === c)?.[1] ?? c, drop: (p: URLSearchParams) => { const keep = p.getAll("cond").filter((x) => x !== c); p.delete("cond"); keep.forEach((x) => p.append("cond", x)); } })),
    ...more.size.map((v) => ({ label: sizeLabel(f.cat, more.sk, v) ?? v, drop: (p: URLSearchParams) => { const keep = p.getAll("size").filter((x) => x !== v); p.delete("size"); keep.forEach((x) => p.append("size", x)); if (!keep.length) p.delete("sk"); } })),
    ...(more.verified ? [{ label: "Verified sellers", drop: (p: URLSearchParams) => p.delete("verified") }] : []),
  ];
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
                <p className="caption muted">{(() => { const live = listings.filter((l: any) => l.status !== "sold").length; const sold = listings.length - live; return `${live} for sale${sold ? `, ${sold} sold recently` : ""}.`; })()} Every deal is protected: your money is held until you have the item.</p>
              </div>
              <div className="row browse-tools">
                {search}
                <button type="button" className="nh-btn nh-btn-secondary nh-btn-md nh-btn-pill filter-btn" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
                  <Icon name="adjustments-horizontal" size={18} />Filters{active.length ? <span className="filter-count" aria-label={`, ${active.length} on`}>{active.length}</span> : null}
                </button>
                <Form method="get" className="row">
                  {[...params.entries()].filter(([k]) => k !== "sort").map(([k, v], i) => <input key={`${k}${i}`} type="hidden" name={k} value={v} />)}
                  <Select name="sort" label="Sort" hideLabel pill submitOnChange defaultValue={f.sort} options={[
                    { value: "", label: "Newest first" },
                    { value: "price_asc", label: "Price: low to high" },
                    { value: "price_desc", label: "Price: high to low" },
                  ]} />
                </Form>
              </div>
            </div>
            <div className="mobile-only">{filters}</div>
            {active.length ? (
              <div className="active-filters" aria-label="Filters on">
                {active.map((a) => {
                  const p = new URLSearchParams(params);
                  a.drop(p);
                  return <Link key={a.label} to={`?${p.toString()}`} className="chip active-chip" replace aria-label={`Remove filter: ${a.label}`}>{a.label}<Icon name="x" size={14} /></Link>;
                })}
                <Link to={`?${clearedParams(params).toString()}`} className="caption tap" replace>Clear all</Link>
              </div>
            ) : null}
            {listings.length === 0 ? (
              <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
                <span className="empty-icon"><Icon name="search" size={26} /></span>
                <p className="title">Nothing here yet</p>
                <p className="body muted">{active.length ? "Nothing matches these filters. Try taking one off." : f.state ? `Nothing in ${where} yet. Try all of Nigeria, another search, or list something yourself.` : "Try another search, or list something yourself."}</p>
                <Button variant="primary" pill to="/sell" icon="plus">Sell something</Button>
              </div>
            ) : (
              <div className="grid-cards">
                {listings.map((l: any) => (
                  <ListingCard key={l.id} href={`/l/${l.id}`} title={l.title} priceKobo={l.price_kobo} area={[sizeLabel(l.category, l.size_system, l.size), placeLabel(l.area, l.state)].filter(Boolean).join(" · ")}
                    posted={ago(l.published_at)} imageUrl={l.photo_keys?.[0] ? photoUrl(l.photo_keys[0]) : undefined}
                    sold={l.status === "sold"} left={l.quantity > 1 ? l.quantity - l.sold_count : null} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      {filtersOpen ? <FiltersSheet f={f} more={more} rule={rule} onClose={() => setFiltersOpen(false)} /> : null}
    </>
  );
}

/** The URL with every Filters-panel choice taken off (category, place, search and sort stay). */
function clearedParams(params: URLSearchParams) {
  const p = new URLSearchParams(params);
  for (const k of ["min", "max", "cond", "sk", "size", "verified"]) p.delete(k);
  return p;
}

const PRICE_PRESETS: [string, number | null, number | null][] = [
  ["Under ₦50,000", null, 50_000], ["₦50,000 to ₦200,000", 50_000, 200_000], ["₦200,000 to ₦1M", 200_000, 1_000_000], ["Over ₦1M", 1_000_000, null],
];

type BrowseData = Route.ComponentProps["loaderData"];

/** The Filters panel: a bottom sheet on phones, a dialog on wider screens. Applying it reloads Browse with the choices. */
function FiltersSheet({ f, more, rule, onClose }: { f: BrowseData["f"]; more: BrowseData["more"]; rule: ReturnType<typeof sizeRuleFor>; onClose: () => void }) {
  const [min, setMin] = useState(more.min ? String(more.min) : "");
  const [max, setMax] = useState(more.max ? String(more.max) : "");
  const [kind, setKind] = useState(more.sk || rule?.systems[0]?.id || "");
  const sizes = rule?.systems.find((x) => x.id === kind);
  const keep = { cat: f.cat, state: f.state, q: f.q, sort: f.sort };
  const clear = `?${new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <Form method="get" className="sheet filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filters-title" onClick={(e) => e.stopPropagation()} replace
        onSubmit={(e) => {
          // Keep the address tidy: leave out empty prices, and the kind of size when no size is picked.
          const form = e.currentTarget;
          for (const el of form.querySelectorAll<HTMLInputElement>("input[name=min], input[name=max]")) if (!el.value) el.disabled = true;
          if (!form.querySelector("input[name=size]:checked")) for (const el of form.querySelectorAll<HTMLInputElement>("input[name=sk]")) el.disabled = true;
        }}>
        {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <div className="row-between">
          <h2 id="filters-title" className="heading">Filters</h2>
          <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={onClose}><Icon name="x" size={20} /></button>
        </div>

        <fieldset className="filter-section">
          <legend className="label">Price (₦)</legend>
          <div className="price-row">
            <label className="price-input"><span className="caption muted">Min</span><input name="min" inputMode="numeric" placeholder="0" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d]/g, ""))} /></label>
            <span className="muted" aria-hidden="true">to</span>
            <label className="price-input"><span className="caption muted">Max</span><input name="max" inputMode="numeric" placeholder="Any" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d]/g, ""))} /></label>
          </div>
          <div className="size-kinds">
            {PRICE_PRESETS.map(([label, lo, hi]) => (
              <button key={label} type="button" className="chip" aria-pressed={min === (lo ? String(lo) : "") && max === (hi ? String(hi) : "")}
                onClick={() => { setMin(lo ? String(lo) : ""); setMax(hi ? String(hi) : ""); }}>{label}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-section">
          <legend className="label">Condition</legend>
          <div className="size-kinds">
            {CONDITIONS.map(([k, label]) => (
              <label key={k} className="chip"><input type="checkbox" name="cond" value={k} defaultChecked={more.cond.includes(k)} className="sr-only" />{label}</label>
            ))}
          </div>
        </fieldset>

        {rule && sizes ? (
          <fieldset className="filter-section">
            <legend className="label">{rule.label}</legend>
            {rule.systems.length > 1 ? (
              <div className="size-kinds" role="radiogroup" aria-label={`Kind of ${rule.label.toLowerCase()}`}>
                {rule.systems.map((x) => (
                  <label key={x.id} className="chip kind-chip"><input type="radio" name="sk" value={x.id} checked={kind === x.id} onChange={() => setKind(x.id)} className="sr-only" />{x.label}</label>
                ))}
              </div>
            ) : <input type="hidden" name="sk" value={sizes.id} />}
            <div className="size-kinds" key={sizes.id}>
              {sizes.values.map((v) => (
                <label key={v} className="chip"><input type="checkbox" name="size" value={v} defaultChecked={more.sk === sizes.id && more.size.includes(v)} className="sr-only" />{sizes.prefix && sizes.id !== "waist" ? `${sizes.prefix} ${v}` : v}</label>
              ))}
            </div>
          </fieldset>
        ) : !f.cat ? (
          <p className="caption muted">Choose a category like Shoes or Clothes to filter by size.</p>
        ) : null}

        <fieldset className="filter-section">
          <legend className="label">Seller</legend>
          <label className="choice">
            <input type="checkbox" name="verified" value="1" defaultChecked={more.verified} />
            <span className="stack" style={{ gap: 0 }}><span className="body">Verified sellers only</span><span className="caption muted">Sellers whose ID and bank account NosHen has checked.</span></span>
          </label>
        </fieldset>

        <div className="filter-actions">
          <Link to={clear} className="nh-btn nh-btn-secondary nh-btn-lg" replace>Clear all</Link>
          <Button type="submit" variant="primary" size="lg">Show results</Button>
        </div>
      </Form>
    </div>
  );
}
