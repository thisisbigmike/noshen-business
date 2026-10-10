import { Form, Link } from "react-router";
import type { Route } from "./+types/account";
import { requireUser, withApp, messageOf } from "../../server/web";
import { myListings, sellerSummary } from "../../server/engine/queries";
import { sellerReady, setListingStatus } from "../../server/engine/sellers";
import { one } from "../../server/db";
import { Button, ErrorText, Icon, Info, Kv, TopBar } from "../components/ui";
import { naira } from "../../shared/money";
import { LEGAL_NAV } from "../../shared/legal-pages";
import { ThemeSwitch } from "../components/theme";

export const meta = () => [{ title: "Account · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const [ready, summary, listings, bank, kyc] = await Promise.all([
      sellerReady(d, user.id), sellerSummary(d.db, user.id), myListings(d.db, user.id),
      one(d.db, "select account_name, account_last4 from bank_accounts where user_id = $1 and is_default and removed_at is null", [user.id]),
      one(d.db, "select type, verified_name from kyc_checks where user_id = $1 and result = 'verified' order by checked_at desc limit 1", [user.id]),
    ]);
    return { user, ready, summary, listings, bank, kyc };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await setListingStatus(d, user.id, String(f.get("listing")), String(f.get("status")) as "paused" | "live" | "removed");
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

const STATUS_WORD: Record<string, string> = { live: "Live", paused: "Paused", sold: "Sold", draft: "Draft", blocked: "Being checked" };

export default function Account({ loaderData: x, actionData }: Route.ComponentProps) {
  return (
    <div>
      <TopBar title="Account" />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">Account</h1>
        <section className="card">
          <Kv k="Name" v={x.user.full_name ?? "Not added"} />
          <Kv k="Email" v={x.user.email ?? "Not added"} />
          <Kv k="Rating" v={x.summary.rating ? `${x.summary.rating} from ${x.summary.ratingCount}` : "No ratings yet"} />
          <Kv k="Completed sales" v={String(x.summary.completedDeals)} />
        </section>
        <section className="card stack">
          <p className="title">Selling</p>
          <Kv k="ID check" v={x.kyc ? `Verified (${x.kyc.type.toUpperCase()})` : "Not done"} />
          <Kv k="Payout bank" v={x.bank ? `${x.bank.account_name} ••${x.bank.account_last4}` : "Not added"} />
          {!x.ready.ready ? <Button variant="primary" to="/account/verify?next=/account" icon="shield-check">Verify ID and bank</Button>
            : <Info icon="circle-check">You can sell. Buyers see "ID verified" on your listings.</Info>}
        </section>
        {x.listings.length ? (
          <section className="card stack">
            <div className="row-between"><p className="title">My listings</p><Link to="/sell">New listing</Link></div>
            {x.listings.map((l: any) => (
              <div key={l.id} className="kv" style={{ alignItems: "center" }}>
                <span className="stack" style={{ gap: 0 }}>
                  <Link to={l.status === "draft" ? (l.title === "Untitled listing" ? "/sell" : `/sell/${l.id}/details`) : `/l/${l.id}`} className="body">{l.title === "Untitled listing" ? "Draft listing" : l.title}</Link>
                  <span className="caption muted">{STATUS_WORD[l.status] ?? l.status} · {naira(l.price_kobo)}{Number(l.requests) ? ` · ${l.requests} request${Number(l.requests) > 1 ? "s" : ""}` : ""}</span>
                </span>
                {l.status === "live" || l.status === "paused" ? (
                  <Form method="post">
                    <input type="hidden" name="listing" value={l.id} />
                    <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                    <Button type="submit">{l.status === "live" ? "Pause" : "Make live"}</Button>
                  </Form>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        <ErrorText>{(actionData as any)?.error}</ErrorText>
        <section className="card stack" aria-labelledby="appearance">
          <p className="title" id="appearance">Appearance</p>
          <p className="caption muted">Light is the default. Your choice is saved on this device.</p>
          <ThemeSwitch />
        </section>
        <section className="card link-list" aria-label="Help and legal">
          <p className="label muted">Help and legal</p>
          {LEGAL_NAV.map((p) => <Link key={p.slug} to={`/${p.slug}`} className="row-between">{p.title}<Icon name="chevron-right" size={18} /></Link>)}
        </section>
        <Form method="post" action="/signout"><Button type="submit" icon="logout">Sign out</Button></Form>
      </main>
    </div>
  );
}
