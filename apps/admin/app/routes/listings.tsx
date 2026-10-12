import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Form, Link, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/listings";
import { env } from "cloudflare:workers";
import { messageOf, requireStaff, withApp } from "../../server/web";
import { staffListings } from "@noshen/engine/queries";
import { deleteSoldListings, moderateListing } from "@noshen/engine/staff";
import { Button, CheckedForm, ErrorText, Icon, Info, Select, TextArea, useEscape } from "@noshen/ui/ui";
import { CATEGORIES, categoryOf } from "@noshen/shared/categories";
import { photoUrl } from "@noshen/shared/photos";
import { naira } from "@noshen/shared/money";
import { ago } from "@noshen/shared/time";
import { placeLabel } from "@noshen/shared/locations";

export const meta = () => [{ title: "Listings · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireStaff(request);
  const url = new URL(request.url);
  const f = { q: url.searchParams.get("q") ?? "", status: url.searchParams.get("status") ?? "", cat: url.searchParams.get("cat") ?? "" };
  return { ...(await withApp((d) => staffListings(d.db, f))), f, appUrl: env.APP_URL };
}

export async function action({ request }: Route.ActionArgs) {
  const staff = await requireStaff(request);
  const f = await request.formData();
  const raw = String(f.get("act"));
  const act = raw === "approve" ? "approve" : raw === "delete" ? "delete" : raw === "delete_all" ? "delete_all" : "remove";
  const id = String(f.get("listing") ?? "");
  const reason = String(f.get("reason") ?? "").trim();
  try {
    if (act === "delete" || act === "delete_all") {
      const n = await withApp((d) => deleteSoldListings(d, staff, act === "delete_all" ? "all" : [id], reason || undefined));
      return { ok: true as const, id, act, n };
    }
    await withApp((d) => moderateListing(d, staff.id, id, act, reason));
  } catch (e) {
    return { ok: false as const, id, error: messageOf(e) };
  }
  return { ok: true as const, id, act, n: 1 };
}

const STATUS: Record<string, { label: string; tone: string }> = {
  live: { label: "Live", tone: "ok" }, paused: { label: "Paused", tone: "muted" }, sold: { label: "Sold", tone: "brand" },
  removed: { label: "Removed", tone: "bad" }, blocked: { label: "Held for checks", tone: "warn" },
};
const FILTERS = ["", "live", "blocked", "paused", "sold", "removed"];

type Row = { id: string; title: string; category: string; price_kobo: string; status: string; area: string | null; state: string | null; photo_keys: string[] | null; published_at: string | null; created_at: string; seller_id: string; seller: string; quantity?: number; sold_count?: number; seller_email: string; open_deals: string };

export default function Listings({ loaderData: { rows, counts, f, appUrl } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const fetcher = useFetcher<typeof action>({ key: "moderate" });
  const [target, setTarget] = useState<{ row: Row; act: "remove" | "approve" | "delete" | "delete_all" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  useEscape(!!target, () => setTarget(null), busy);
  // Close the dialog once the change is saved, and say what happened.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok || !target || fetcher.data.id !== target.row.id) return;
    const seller = target.row.seller.split(" ")[0];
    setDone(fetcher.data.act === "approve" ? `Approved "${target.row.title}". It's live, and ${seller} has been told.`
      : fetcher.data.act === "delete" ? `Deleted "${target.row.title}". It's off NosHen; its deals stay on record.`
      : fetcher.data.act === "delete_all" ? `Deleted ${fetcher.data.n} sold listing${fetcher.data.n === 1 ? "" : "s"}. Their deals stay on record.`
      : `Removed "${target.row.title}". ${seller} has been told why.`);
    setTarget(null);
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const withParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  const list = rows as Row[];
  const error = fetcher.data && !fetcher.data.ok && target && fetcher.data.id === target.row.id ? fetcher.data.error : null;

  return (
    <>
      <header className="console-head">
        <div className="stack">
          <h1 className="heading">Listings</h1>
          <p className="body muted">Everything people have put up for sale. Take down anything on the prohibited items list, and check listings held for review.</p>
        </div>
      </header>
      {done ? <Info icon="circle-check">{done} <Link to="/audit">See audit log</Link></Info> : null}

      <Form method="get" className="console-filters" role="search">
        {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
        <label className="search-pill">
          <Icon name="search" size={20} />
          <span className="sr-only">Search listings</span>
          <input type="search" name="q" defaultValue={f.q} placeholder="Search by title or seller" />
        </label>
        <div className="console-filter-select">
          <Select name="cat" label="Category" hideLabel pill submitOnChange defaultValue={f.cat}
            options={[{ value: "", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c.key, label: c.label }))]} />
        </div>
        <Button type="submit" variant="primary" pill>Search</Button>
      </Form>
      {counts.sold ? (
        <div className="row-between wrap sold-bar">
          <p className="caption muted">{counts.sold} sold listing{counts.sold === 1 ? "" : "s"} still showing. Buyers see sold items in Browse for two weeks.</p>
          <Button size="sm" variant="danger" onClick={() => { setDone(null); setTarget({ row: { id: "all", title: "all sold listings", seller: "" } as Row, act: "delete_all" }); }}>Delete all sold ({counts.sold})</Button>
        </div>
      ) : null}
      <nav className="chips" aria-label="Filter by status">
        {FILTERS.map((s) => (
          <Link key={s || "all"} to={withParam("status", s)} className="chip" aria-current={f.status === s ? "true" : undefined} preventScrollReset>
            {s ? STATUS[s].label : "All"}<span className="chip-count">{s ? counts[s] ?? 0 : total}</span>
          </Link>
        ))}
      </nav>

      <section className="panel" aria-label="Listings">
        <div className="panel-head"><p className="caption muted">{list.length === 200 ? "Showing the newest 200. Search to narrow it down." : `${list.length} listing${list.length === 1 ? "" : "s"}`}</p></div>
        {list.length === 0 ? (
          <div className="empty-mini"><Icon name="tag" size={28} /><p className="label">No listings match</p><p className="caption muted">Try another status, category or search.</p></div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Listings (scrolls sideways)">
            <table className="table">
              <thead><tr><th>Listing</th><th>Seller</th><th>Price</th><th>Status</th><th>Posted</th><th className="cell-action"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{list.map((l) => {
                const cat = categoryOf(l.category);
                const open = Number(l.open_deals);
                const st = STATUS[l.status] ?? { label: l.status, tone: "muted" };
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-listing">
                        <span className="thumb">{l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0])} alt="" loading="lazy" /> : <Icon name={cat.icon} size={20} />}</span>
                        <div style={{ minWidth: 0 }}>
                          <p className="body">{l.title}</p>
                          <p className="caption muted">{cat.label}{l.area || l.state ? ` · ${placeLabel(l.area, l.state)}` : ""}{open ? ` · ${open} open deal${open === 1 ? "" : "s"}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td><Link to={`/users/${l.seller_id}`} className="body ink-link">{l.seller}</Link><p className="caption muted">{l.seller_email}</p></td>
                    <td className="tabular">{naira(l.price_kobo)}{Number(l.quantity) > 1 ? <p className="caption muted">{l.sold_count} of {l.quantity} sold</p> : null}</td>
                    <td><span className={`st-pill ${st.tone}`}>{st.label}</span></td>
                    <td className="caption" style={{ whiteSpace: "nowrap" }}>{ago(l.published_at ?? l.created_at)}</td>
                    <td className="cell-action">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {l.status === "live" || l.status === "paused" ? <a href={`${appUrl}/l/${l.id}`} target="_blank" rel="noreferrer" className="icon-btn" aria-label={`Open "${l.title}" on the customer site, in a new tab`}><Icon name="external-link" size={18} /></a> : null}
                        {l.status === "blocked" ? <Button size="sm" variant="primary" onClick={() => { setDone(null); setTarget({ row: l, act: "approve" }); }}>Approve</Button> : null}
                        {["live", "paused", "blocked"].includes(l.status) ? <Button size="sm" variant="danger" onClick={() => { setDone(null); setTarget({ row: l, act: "remove" }); }}>Remove</Button> : null}
                        {l.status === "sold" ? <Button size="sm" variant="danger" onClick={() => { setDone(null); setTarget({ row: l, act: "delete" }); }}>Delete</Button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {/* Rendered on <body>, so the console's entrance animation can't pin it inside the main column. */}
      {target ? createPortal(
        <div className="sheet-backdrop" onClick={() => !busy && setTarget(null)}>
          <CheckedForm method="post" navigate={false} fetcherKey="moderate" className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="mod-title">
            <input type="hidden" name="listing" value={target.row.id} />
            <input type="hidden" name="act" value={target.act} />
            <h2 id="mod-title" className="heading">{target.act === "remove" ? "Remove this listing?" : target.act === "delete" ? "Delete this sold listing?" : target.act === "delete_all" ? `Delete all ${counts.sold} sold listings?` : "Approve this listing?"}</h2>
            {target.act === "delete" || target.act === "delete_all" ? (
              <p className="body">{target.act === "delete" ? <><strong>{target.row.title}</strong> by {target.row.seller}. </> : null}It comes off NosHen for good: out of Browse and the seller's page. Its deals, payments and photos stay on record.</p>
            ) : <p className="body">
              <strong>{target.row.title}</strong> by {target.row.seller}.{" "}
              {target.act === "remove" ? "It comes off NosHen straight away and can't be bought. The seller is told your reason by email and in the app." : "It goes live straight away. The seller is told by email and in the app."}
            </p>}
            {target.act === "remove" && Number(target.row.open_deals) ? (
              <Info icon="alert-triangle" tone="warn">It has {target.row.open_deals} open deal{target.row.open_deals === "1" ? "" : "s"}. They carry on. If the item is prohibited, check them in the dashboard queues.</Info>
            ) : null}
            {target.act === "delete" || target.act === "delete_all" ? (
              <TextArea name="reason" label="Note for the audit log (optional)" rows={2} maxLength={500} placeholder="Sold. Taken off NosHen by staff." />
            ) : <TextArea name="reason" label={target.act === "remove" ? "Reason (the seller sees this)" : "What you checked"} rows={3} required minLength={5} maxLength={500} autoFocus
              missing={target.act === "remove" ? "Write why you're removing it. The seller will see this." : "Write what you checked, for the audit log."}
              placeholder={target.act === "remove" ? "For example: counterfeit designer goods are on the prohibited items list" : "For example: chassis number matches the papers"} />}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" variant={target.act === "approve" ? "primary" : "danger"} size="lg" block disabled={busy}>
              {busy ? "Saving…" : target.act === "remove" ? "Remove listing" : target.act === "delete" ? "Delete listing" : target.act === "delete_all" ? `Delete ${counts.sold} listings` : "Approve listing"}
            </Button>
            <Button size="lg" block disabled={busy} onClick={() => setTarget(null)}>Keep as it is</Button>
          </CheckedForm>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
