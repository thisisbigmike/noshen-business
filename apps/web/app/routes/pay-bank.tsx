import { useEffect, useState } from "react";
import { Link, data, redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/pay-bank";
import { requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { isDev } from "@noshen/engine/context";
import { BottomAction, Button, Info, Kv, MoneyStatus, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { CopyButton } from "../lib/copy-button";
import { when } from "@noshen/shared/time";
import { useLite, useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Pay by bank transfer · NosHen" }];

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

export default function PayBank({ loaderData: x }: Route.ComponentProps) {
  const { deal } = x;
  const t = useT();
  const lite = useLite();
  const [copied, setCopied] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const revalidator = useRevalidator();
  // "This page updates when your bank confirms the money": check every 5 seconds (15 with data saver on).
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, lite ? 15_000 : 5000);
    return () => clearInterval(id);
  }, [lite]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <TopBar title={t("Pay by bank transfer")} back={`/d/${deal.id}/pay`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Pay by bank transfer")}</h1>
        <nav className="desktop-only caption muted"><Link to="/deals">{t("Deals")}</Link> / <Link to={`/d/${deal.id}`}>{x.title}</Link> / <Link to={`/d/${deal.id}/pay`}>{t("Pay")}</Link> / {t("Bank transfer")}</nav>
        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" /><span className="caption muted">{t("Pay by {time}", { time: when(new Date(deal.payment_due_at)) })}</span></div>
          <p className="big-amount">{due}</p>
          <p className="body muted">{t("{item} · {name} accepted", { item: x.title, name: x.seller })}</p>
          <p className="body">{t("Transfer exactly {amount} to the deal account below. We hold it until you have the item.", { amount: due })}</p>
        </section>
        {copied ? <Info icon="clock">{t.rich("<b>Waiting for your transfer.</b> Bank transfers usually show within a few minutes. We'll email you when it arrives.", { b: (s) => <strong>{s}</strong> })}</Info> : null}
        <section className="card">
          <Kv k={t("Bank")} v={x.partnerBank} />
          <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">{t("Deal account number")}</span><span className="heading tabular">{grouped}</span></span><CopyButton text={acct} onCopied={() => setCopied(true)} /></div>
          <Kv k={t("Account name")} v={`NosHen / ${deal.collection_ref ? "deal " + deal.id.slice(0, 4).toUpperCase() : ""}`} />
          <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">{t("Exact amount")}</span><span className="title tabular">{due}</span></span><CopyButton text={String(Number(deal.amount_due_kobo) / 100)} /></div>
        </section>
        <Info icon="user">{t.rich("<b>Pay from an account in your own name.</b> Money from someone else's account is held for checks, and may be sent back. This account number is only for this deal.", { b: (s) => <strong>{s}</strong> })}</Info>
        <p className="caption muted">{deal.handover === "meetup"
          ? t("{bank}, our licensed partner, holds the money. {name} can't touch it until you give your release code.", { bank: x.partnerBank, name: x.seller })
          : t("{bank}, our licensed partner, holds the money. {name} can't touch it until you confirm you received the item.", { bank: x.partnerBank, name: x.seller })}</p>
        {x.dev ? (
          <div className="dev stack">
            <p className="label">Test mode: no real money moves. Pretend to be your bank:</p>
            <div className="row wrap"><Button onClick={() => simulate(false)}>Send {due} from my account</Button><Button onClick={() => simulate(true)}>Send from someone else's account</Button></div>
            {devMsg ? <p className="caption">{devMsg}</p> : null}
          </div>
        ) : null}
        <BottomAction>
          <CopyButton text={acct} label={t("Copy account number")} onCopied={() => setCopied(true)} />
          <p className="caption muted" style={{ textAlign: "center" }}>{t("This page updates when your bank confirms the money.")} <Link to={`/d/${deal.id}/pay`}>{t("Pay another way")}</Link></p>
        </BottomAction>
      </main>
    </div>
  );
}
