import { useEffect, useState } from "react";
import { Form, Link, data, redirect, useNavigation, useRevalidator, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/pay-crypto";
import { messageOf, requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { isDev } from "@noshen/engine/context";
import { cryptoPaymentFor, prepareCryptoPayment } from "@noshen/engine/stablecoins";
import { BottomAction, Button, CheckedForm, ErrorText, Info, Kv, MoneyStatus, TextField, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { QUOTE_MINUTES, addressProblem, coinAmount, coinName, cryptoLabel, groupAddress, isCoin, isNetwork, networkLabel, networkOf, plainAmount } from "@noshen/shared/payments";
import { CryptoLogo } from "../lib/crypto-logo";
import { CopyButton } from "../lib/copy-button";

export const handle = { tabs: false };
export const meta: Route.MetaFunction = ({ params }) =>
  [{ title: `Pay with ${isCoin(params.coin) && isNetwork(params.network) ? cryptoLabel(params.coin, params.network) : "crypto"} · NosHen` }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { coin, network } = params;
  if (!isCoin(coin) || !isNetwork(network)) throw data("Not found", { status: 404 });
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    if (!d.crypto) throw redirect(`/d/${params.id}/pay`);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "accepted") throw redirect(`/d/${params.id}`);
    const { payment, refundAddress } = await cryptoPaymentFor(d, user.id, v.deal.id, coin, network);
    // Before they continue: roughly what they'll send. The exact amount is fixed when the address is shown.
    const estimate = payment ? null : await d.crypto.quote(Number(v.deal.amount_due_kobo), coin, new Date());
    return {
      deal: { id: v.deal.id as string, due: v.deal.amount_due_kobo as string, payBy: v.deal.payment_due_at as string | null, handover: v.deal.handover as string },
      title: v.listing.title as string, seller: firstName(v.seller.name), coin, network, payment, refundAddress,
      estimate: estimate ? { micro: estimate.micro, rateKobo: estimate.rateKobo } : null,
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
      await prepareCryptoPayment(d, user.id, params.id, params.coin, params.network, intent === "start" ? String(f.get("refund") ?? "") : undefined);
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
  return redirect(`/d/${params.id}/pay/${params.coin}/${params.network}`);
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

export default function PayCrypto({ loaderData: x, actionData }: Route.ComponentProps) {
  const n = networkOf(x.network);
  const c = coinName(x.coin);
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
    const r = await fetch("/api/dev/crypto/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dealId: x.deal.id, coin: x.coin, network: x.network, short }) });
    setDevMsg(r.ok ? "The test wallet sent it, and the crypto partner's webhook arrived. This page will update." : ((await r.json()) as { error?: string }).error ?? "Something went wrong.");
    revalidator.revalidate();
  };

  return (
    <div>
      <TopBar title={`Pay with ${c}`} back={`/d/${x.deal.id}/pay`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Pay with {c} on {n.name}</h1>
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/deals">Deals</Link> / <Link to={`/d/${x.deal.id}`}>{x.title}</Link> / <Link to={`/d/${x.deal.id}/pay`}>Pay</Link> / {c} on {n.name}</nav>

        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" />{x.deal.payBy ? <span className="caption muted">Pay by {when(new Date(x.deal.payBy))}</span> : null}</div>
          <p className="big-amount tabular">{p && !editing && !expired ? coinAmount(p.micro, x.coin) : naira(x.deal.due)}</p>
          <p className="body muted">{p && !editing && !expired ? `${naira(x.deal.due)} · ` : ""}{x.title} · {x.seller} accepted</p>
          <p className="row" style={{ gap: 10 }}><CryptoLogo coin={x.coin} network={x.network} size={28} lead="coin" /><span className="body">{c} on {networkLabel(n)}</span></p>
        </section>

        {editing ? (
          <CheckedForm method="post" className="stack-4" replace>
            <input type="hidden" name="intent" value="start" />
            <section className="card stack">
              <h2 className="title">{p ? "Change where refunds go" : "First, where should refunds go?"}</h2>
              <p className="body muted">If the deal is cancelled, or a problem is decided in your favour, we send your money back as {c} on {n.name} to this address.</p>
              <TextField label={`Your ${c} address on ${n.name}`} name="refund" className="mono-field" defaultValue={x.refundAddress ?? ""} required
                missing={addressProblem(x.coin, n.id, "") ?? undefined} validate={(v) => addressProblem(x.coin, n.id, v)}
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                hint={`Copy it from your wallet. For an exchange account, use the exchange's ${c} deposit address on this network.`} />
            </section>
            {x.estimate ? (
              <Info icon="coin">You'll send about <strong>{coinAmount(x.estimate.micro, x.coin)}</strong> ({naira(x.estimate.rateKobo)} per {c}{x.test ? ", a test rate" : ""}). When you continue, the exact amount is fixed for {QUOTE_MINUTES} minutes.</Info>
            ) : null}
            <ErrorText>{actionData?.intent === "start" ? actionData.error : null}</ErrorText>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Getting the address…" : p ? "Save" : "Show where to send"}</Button>
            {p ? <Button block to={`/d/${x.deal.id}/pay/${x.coin}/${n.id}`}>Keep the address ending {p.refundLast4}</Button> : null}
          </CheckedForm>
        ) : expired ? (
          <section className="card stack-4">
            <Info icon="clock"><strong>This amount has run out.</strong> {c} prices move against the naira, so we fix the amount for {QUOTE_MINUTES} minutes at a time.</Info>
            <p className="body">Already sent it? Don't send it again. When it arrives, we'll check it and email you.</p>
            <Form method="post" replace>
              <input type="hidden" name="intent" value="refresh" />
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Getting a new amount…" : "Get a new amount"}</Button>
            </Form>
            <ErrorText>{actionData?.intent === "refresh" ? actionData.error : null}</ErrorText>
          </section>
        ) : (
          <>
            {x.test ? <Info icon="alert-triangle" tone="warn"><strong>Test mode: don't send real {c}.</strong> This address is pretend, so wallets won't accept it. Use the test buttons below instead.</Info> : null}
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
                <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">Exact amount</span><span className="title tabular">{coinAmount(p!.micro, x.coin)}</span></span><CopyButton text={plainAmount(p!.micro)} /></div>
                <Kv k="Network" v={networkLabel(n)} />
                <Kv k="Rate" v={`${naira(p!.rateKobo)} per ${c}${x.test ? " (test rate)" : ""}`} />
                <Kv k="This amount holds for" v={<span className="tabular" aria-live="off">{mmss(left)}</span>} />
                <Kv k="Refunds go to" v={<span>Address ending {p!.refundLast4} · <Link to="?edit=1">Change</Link></span>} />
              </div>
            </section>
            <Info icon="alert-triangle" tone="warn"><strong>Send only {c} on {n.name}.</strong> Another coin, or {c} on another network, can't be recovered.</Info>
            <Info icon="coin">Make sure exactly {coinAmount(p!.micro, x.coin)} arrives. If your exchange takes its fee out of what you send, add the fee on top.</Info>
            <p className="caption muted">Our crypto partner turns the {c} into {naira(x.deal.due)} for this deal, and our licensed partner holds it. {x.seller} can't touch it until you {x.deal.handover === "meetup" ? "give your release code" : "confirm you received the item"}.</p>
            {x.dev ? (
              <div className="dev stack">
                <p className="label">Test mode: no real {c} moves. Pretend to be your wallet:</p>
                <div className="row wrap"><Button onClick={() => send(false)}>Send {coinAmount(p!.micro, x.coin)}</Button><Button onClick={() => send(true)}>Send too little</Button></div>
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
