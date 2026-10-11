import { useEffect, useState } from "react";
import { Form, Link, data, redirect, useNavigation, useRevalidator, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/pay-usdt";
import { messageOf, requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { isDev } from "@noshen/engine/context";
import { prepareUsdtPayment, usdtPaymentFor } from "@noshen/engine/usdt";
import { BottomAction, Button, CheckedForm, ErrorText, Info, Kv, MoneyStatus, TextField, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { QUOTE_MINUTES, groupAddress, isNetwork, networkLabel, networkOf, usdt, usdtAddressProblem, usdtPlain } from "@noshen/shared/payments";
import { CopyButton } from "../lib/copy-button";

export const handle = { tabs: false };
export const meta: Route.MetaFunction = ({ params }) =>
  [{ title: `Pay with USDT on ${isNetwork(params.network) ? networkOf(params.network).name : "crypto"} · NosHen` }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const network = params.network;
  if (!isNetwork(network)) throw data("Not found", { status: 404 });
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    if (!d.crypto) throw redirect(`/d/${params.id}/pay`);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "accepted") throw redirect(`/d/${params.id}`);
    const { payment, refundAddress } = await usdtPaymentFor(d, user.id, v.deal.id, network);
    // Before they continue: roughly what they'll send. The exact amount is fixed when the address is shown.
    const estimate = payment ? null : await d.crypto.quote(Number(v.deal.amount_due_kobo), new Date());
    return {
      deal: { id: v.deal.id as string, due: v.deal.amount_due_kobo as string, payBy: v.deal.payment_due_at as string | null, handover: v.deal.handover as string },
      title: v.listing.title as string, seller: firstName(v.seller.name), network, payment, refundAddress,
      estimate: estimate ? { usdtMicro: estimate.usdtMicro, rateKoboPerUsdt: estimate.rateKoboPerUsdt } : null,
      qr: payment ? renderSVG(payment.address, { ecc: "M", border: 2, pixelSize: 6, blackColor: "#000", whiteColor: "#fff" }) : null,
      test: d.crypto.test, dev: isDev(), now: Date.now(),
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  const intent = String(f.get("intent"));
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await prepareUsdtPayment(d, user.id, params.id, params.network, intent === "start" ? String(f.get("refund") ?? "") : undefined);
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
  return redirect(`/d/${params.id}/pay/usdt/${params.network}`);
}

/** Seconds until a time, ticking. Starts from the server's clock so the first render matches. */
function useSecondsLeft(until: Date | string | null | undefined, serverNow: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    setNow(Date.now());
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000)) : 0;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function PayUsdt({ loaderData: x, actionData }: Route.ComponentProps) {
  const n = networkOf(x.network);
  const [params] = useSearchParams();
  const p = x.payment;
  const editing = !p || params.has("edit");
  const busy = useNavigation().state !== "idle";
  const left = useSecondsLeft(p?.expiresAt, x.now);
  const expired = !!p && left <= 0;
  const [devMsg, setDevMsg] = useState<string | null>(null);

  // "This page updates when the network confirms your payment": check every 5 seconds once there's an address.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!p) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, 5000);
    return () => clearInterval(id);
  }, [!!p]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (short: boolean) => {
    setDevMsg("Sending…");
    const r = await fetch("/api/dev/crypto/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dealId: x.deal.id, network: x.network, short }) });
    setDevMsg(r.ok ? "The test wallet sent it, and the crypto partner's webhook arrived. This page will update." : ((await r.json()) as { error?: string }).error ?? "Something went wrong.");
    revalidator.revalidate();
  };

  return (
    <div>
      <TopBar title="Pay with USDT" back={`/d/${x.deal.id}/pay`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Pay with USDT on {n.name}</h1>
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/deals">Deals</Link> / <Link to={`/d/${x.deal.id}`}>{x.title}</Link> / <Link to={`/d/${x.deal.id}/pay`}>Pay</Link> / USDT on {n.name}</nav>

        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" />{x.deal.payBy ? <span className="caption muted">Pay by {when(new Date(x.deal.payBy))}</span> : null}</div>
          <p className="big-amount tabular">{p && !editing && !expired ? usdt(p.usdtMicro) : naira(x.deal.due)}</p>
          <p className="body muted">{p && !editing && !expired ? `${naira(x.deal.due)} · ` : ""}{x.title} · {x.seller} accepted</p>
          <p className="row" style={{ gap: 8 }}><span className={`pay-chain sm chain-${n.id}`} aria-hidden="true">{n.tag}</span><span className="body">USDT on {networkLabel(n)}</span></p>
        </section>

        {editing ? (
          <CheckedForm method="post" className="stack-4" replace>
            <input type="hidden" name="intent" value="start" />
            <section className="card stack">
              <h2 className="title">{p ? "Change where refunds go" : "First, where should refunds go?"}</h2>
              <p className="body muted">If the deal is cancelled, or a problem is decided in your favour, we send your money back as USDT on {n.name} to this address.</p>
              <TextField label={`Your USDT address on ${n.name}`} name="refund" className="mono-field" defaultValue={x.refundAddress ?? ""} required
                missing={usdtAddressProblem(n.id, "") ?? undefined} validate={(v) => usdtAddressProblem(n.id, v)}
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                hint="Copy it from your wallet. For an exchange account, use the exchange's USDT deposit address on this network." />
            </section>
            {x.estimate ? (
              <Info icon="coin">You'll send about <strong>{usdt(x.estimate.usdtMicro)}</strong> ({naira(x.estimate.rateKoboPerUsdt)} per USDT{x.test ? ", a test rate" : ""}). When you continue, the exact amount is fixed for {QUOTE_MINUTES} minutes.</Info>
            ) : null}
            <ErrorText>{actionData?.intent === "start" ? actionData.error : null}</ErrorText>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Getting the address…" : p ? "Save" : "Show where to send"}</Button>
            {p ? <Button block to={`/d/${x.deal.id}/pay/usdt/${n.id}`}>Keep the address ending {p.refundLast4}</Button> : null}
          </CheckedForm>
        ) : expired ? (
          <section className="card stack-4">
            <Info icon="clock"><strong>This amount has run out.</strong> USDT prices move, so we fix the amount for {QUOTE_MINUTES} minutes at a time.</Info>
            <p className="body">Already sent it? Don't send it again. When it arrives, we'll check it and email you.</p>
            <Form method="post" replace>
              <input type="hidden" name="intent" value="refresh" />
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Getting a new amount…" : "Get a new amount"}</Button>
            </Form>
            <ErrorText>{actionData?.intent === "refresh" ? actionData.error : null}</ErrorText>
          </section>
        ) : (
          <>
            {x.test ? <Info icon="alert-triangle" tone="warn"><strong>Test mode: don't send real USDT.</strong> This address is pretend, so wallets won't accept it. Use the test buttons below instead.</Info> : null}
            <section className="card stack-4" aria-label="Where to send">
              <div className="stack">
                <span className="label muted">Send to this address</span>
                <div className="pay-address">
                  {x.qr ? <span className="pay-qr" role="img" aria-label="QR code of the address" dangerouslySetInnerHTML={{ __html: x.qr }} /> : null}
                  <code className="pay-addr">{groupAddress(p!.address)}</code>
                </div>
                <div><CopyButton text={p!.address} label="Copy address" /></div>
              </div>
              <div>
                <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">Exact amount</span><span className="title tabular">{usdt(p!.usdtMicro)}</span></span><CopyButton text={usdtPlain(p!.usdtMicro)} /></div>
                <Kv k="Network" v={networkLabel(n)} />
                <Kv k="Rate" v={`${naira(p!.rateKoboPerUsdt)} per USDT${x.test ? " (test rate)" : ""}`} />
                <Kv k="This amount holds for" v={<span className="tabular" aria-live="off">{mmss(left)}</span>} />
                <Kv k="Refunds go to" v={<span>Address ending {p!.refundLast4} · <Link to="?edit=1">Change</Link></span>} />
              </div>
            </section>
            <Info icon="alert-triangle" tone="warn"><strong>Send only USDT on {n.name}.</strong> Another coin, or USDT on another network, can't be recovered.</Info>
            <Info icon="coin">Make sure exactly {usdt(p!.usdtMicro)} arrives. If your exchange takes its fee out of what you send, add the fee on top.</Info>
            <p className="caption muted">Our crypto partner turns the USDT into {naira(x.deal.due)} for this deal, and our licensed partner holds it. {x.seller} can't touch it until you {x.deal.handover === "meetup" ? "give your release code" : "confirm you received the item"}.</p>
            {x.dev ? (
              <div className="dev stack">
                <p className="label">Test mode: no real USDT moves. Pretend to be your wallet:</p>
                <div className="row wrap"><Button onClick={() => send(false)}>Send {usdt(p!.usdtMicro)}</Button><Button onClick={() => send(true)}>Send too little</Button></div>
                {devMsg ? <p className="caption">{devMsg}</p> : null}
              </div>
            ) : null}
            <BottomAction>
              <CopyButton text={p!.address} label="Copy address" />
              <p className="caption muted" style={{ textAlign: "center" }}>This page updates when the network confirms your payment. <Link to={`/d/${x.deal.id}/pay`}>Pay another way</Link></p>
            </BottomAction>
          </>
        )}
      </main>
    </div>
  );
}
