import { useEffect, useState } from "react";
import { Link, data, redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/pay";
import { requireUser, withApp } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { isDev } from "../../server/context";
import { BottomAction, Button, Info, Kv, MoneyStatus, TopBar } from "../components/ui";
import { naira } from "../../shared/money";
import { firstName } from "../../shared/deal";
import { when } from "../../shared/time";

export const handle = { tabs: false };
export const meta = () => [{ title: "Pay into NosHen · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "accepted") throw redirect(`/d/${params.id}`);
    return {
      deal: v.deal, title: v.listing.title, seller: firstName(v.seller.name), dev: isDev(),
      partnerBank: v.deal.collection_bank_name as string,
    };
  });
}

function CopyButton({ text, label = "Copy", onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Button onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); onCopied?.(); setTimeout(() => setDone(false), 2500); }}
      aria-live="polite">{done ? "Copied" : label}</Button>
  );
}

export default function Pay({ loaderData: x }: Route.ComponentProps) {
  const { deal } = x;
  const [copied, setCopied] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const revalidator = useRevalidator();
  // "This page updates when your bank confirms the money": check every 5 seconds.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, 5000);
    return () => clearInterval(id);
  }, []);
  const due = naira(deal.amount_due_kobo);
  const acct = String(deal.collection_account_number ?? "");
  const grouped = acct.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3");
  const simulate = async (wrongName = false) => {
    setDevMsg("Sending…");
    const r = await fetch("/api/dev/partner/transfer-in", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealId: deal.id, ...(wrongName ? { senderName: "Adebayo Johnson" } : {}) }) });
    setDevMsg(r.ok ? "The test bank sent a payment webhook. This page will update." : ((await r.json()) as { error?: string }).error ?? "Something went wrong.");
    revalidator.revalidate();
  };
  return (
    <div>
      <TopBar title="Pay into NosHen" back={`/d/${deal.id}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Pay into NosHen</h1>
        <nav className="desktop-only caption muted"><Link to="/deals">Deals</Link> / {x.title} / Pay</nav>
        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" /><span className="caption muted">Pay by {when(new Date(deal.payment_due_at))}</span></div>
          <p className="big-amount">{due}</p>
          <p className="body muted">{x.title} · {x.seller} accepted</p>
          <p className="body">Transfer exactly {due} to the deal account below. We hold it until you have the item.</p>
        </section>
        {copied ? <Info icon="clock"><strong>Waiting for your transfer.</strong> Bank transfers usually show within a few minutes. We'll email you when it arrives.</Info> : null}
        <section className="card">
          <Kv k="Bank" v={x.partnerBank} />
          <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">Deal account number</span><span className="heading tabular">{grouped}</span></span><CopyButton text={acct} onCopied={() => setCopied(true)} /></div>
          <Kv k="Account name" v={`NosHen / ${deal.collection_ref ? "deal " + deal.id.slice(0, 4).toUpperCase() : ""}`} />
          <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">Exact amount</span><span className="title tabular">{due}</span></span><CopyButton text={String(Number(deal.amount_due_kobo) / 100)} /></div>
        </section>
        <Info icon="user"><strong>Pay from an account in your own name.</strong> Money from someone else's account is held for checks, and may be sent back. This account number is only for this deal.</Info>
        <p className="caption muted">{x.partnerBank}, our licensed partner, holds the money. {x.seller} can't touch it until you {deal.handover === "meetup" ? "give your release code" : "confirm you received the item"}.</p>
        {x.dev ? (
          <div className="dev stack">
            <p className="label">Development only: pretend to be your bank</p>
            <div className="row wrap"><Button onClick={() => simulate(false)}>Send {due} from my account</Button><Button onClick={() => simulate(true)}>Send from someone else's account</Button></div>
            {devMsg ? <p className="caption">{devMsg}</p> : null}
          </div>
        ) : null}
        <BottomAction>
          <CopyButton text={acct} label="Copy account number" onCopied={() => setCopied(true)} />
          <p className="caption muted" style={{ textAlign: "center" }}>This page updates when your bank confirms the money.</p>
        </BottomAction>
      </main>
    </div>
  );
}
