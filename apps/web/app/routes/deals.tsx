import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/deals";
import { requireUser, withApp } from "../../server/web";
import { dealsFor, needsAction } from "@noshen/engine/queries";
import { DealCard, Button } from "@noshen/ui/ui";
import { dealText } from "../lib/deal-text";

export const meta = () => [{ title: "Deals · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const deals = await dealsFor(d.db, user.id);
    return { me: user.full_name ?? "", deals: deals.map((x) => ({ ...x, action: needsAction(x) })) };
  });
}

export default function Deals({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const all = loaderData.deals;
  const defaultTab = all.some((x) => x.role === "seller" && x.action) && !all.some((x) => x.role === "buyer" && x.action) ? "selling" : "buying";
  const tab = params.get("tab") === "selling" || params.get("tab") === "buying" ? params.get("tab")! : defaultTab;
  const list = all.filter((x) => (tab === "selling" ? x.role === "seller" : x.role === "buyer"));
  const now = new Date();
  const card = (x: (typeof list)[number]) => {
    const names = x.role === "buyer" ? { buyer: loaderData.me, seller: x.other } : { buyer: x.other, seller: loaderData.me };
    const t = dealText(x, x.role, names, Number(x.amount_due_kobo), { decisionDue: x.decision_due_at, endedBy: x.ended_by }, now);
    return <DealCard key={x.id} href={`/d/${x.id}`} state={t.chip.state} word={t.chip.word} amountKobo={t.amountKobo} item={x.title}
      counterpart={x.other.split(" ")[0]} deadline={t.deadline} nextStep={x.action ? t.next : undefined} />;
  };
  const needs = list.filter((x) => x.action);
  const rest = list.filter((x) => !x.action);
  return (
    <main className="page narrow stack-4">
      <h1 className="heading">Deals</h1>
      <div className="chips" role="tablist">
        <Link to="?tab=buying" className="chip" role="tab" aria-current={tab === "buying" ? "true" : undefined}>Buying</Link>
        <Link to="?tab=selling" className="chip" role="tab" aria-current={tab === "selling" ? "true" : undefined}>Selling</Link>
      </div>
      {list.length === 0 ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          {tab === "selling" ? <><p className="body">You're not selling anything yet. List something and share the link.</p><Button variant="primary" to="/sell">Sell something</Button></>
            : <><p className="body">You haven't bought anything with NosHen yet.</p><Button to="/browse">Browse listings</Button></>}
        </div>
      ) : null}
      {needs.length ? <section className="stack"><h2 className="label muted">Needs you</h2>{needs.map(card)}</section> : null}
      {rest.length ? <section className="stack"><h2 className="label muted">{needs.length ? "Earlier" : "Your deals"}</h2>{rest.map(card)}</section> : null}
    </main>
  );
}
