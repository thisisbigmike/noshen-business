import { useEffect, useState } from "react";
import { Form, Link, data, redirect, useNavigation, useRevalidator, useSearchParams } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/pay-crypto";
import { messageOf, requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { isDev } from "@noshen/engine/context";
import { cryptoPaymentFor, explorerLink, prepareCryptoPayment, saveRefundAddress, watchCrypto } from "@noshen/engine/stablecoins";
import { DealError } from "@noshen/engine/core";
import { BottomAction, Button, ErrorText, Info, Kv, MoneyStatus, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { QUOTE_MINUTES, coinAmount, coinName, cryptoLabel, groupAddress, isCoin, isNetwork, networkLabel, networkOf, plainAmount } from "@noshen/shared/payments";
import { CryptoLogo } from "../lib/crypto-logo";
import { RefundAddressForm } from "../lib/refund-address";
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
    const mode = d.crypto.mode(network);
    // On a network NosHen reads itself (Solana), look at the chain now: this page refreshes every few seconds while
    // the buyer pays, so the payment shows moments after the network confirms it.
    if (mode !== "pretend") await watchCrypto(d, params.id).catch((e) => console.error("chain check", e));
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "accepted") throw redirect(`/d/${params.id}`);
    // The deal's address for this coin and network is made the first time the buyer opens it: nothing to fill in first.
    let found = await cryptoPaymentFor(d, user.id, v.deal.id, coin, network);
    if (!found.payment) {
      try {
        await prepareCryptoPayment(d, user.id, v.deal.id, coin, network);
      } catch (e) {
        if (e instanceof DealError) throw redirect(`/d/${params.id}`);
        throw e;
      }
      found = await cryptoPaymentFor(d, user.id, v.deal.id, coin, network);
    }
    const { payment, refundAddress } = found;
    return {
      deal: { id: v.deal.id as string, due: v.deal.amount_due_kobo as string, payBy: v.deal.payment_due_at as string | null, handover: v.deal.handover as string },
      title: v.listing.title as string, seller: firstName(v.seller.name), coin, network, payment, refundAddress,
      qr: payment ? renderSVG(payment.address, { ecc: "M", border: 2, pixelSize: 6, blackColor: "#000", whiteColor: "#fff" }) : null,
      test: d.crypto.test, mode, dev: isDev(), now: Date.now(),
      addressUrl: explorerLink(d, network, "address", payment?.address),
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  const intent = String(f.get("intent"));
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      if (intent === "refund") await saveRefundAddress(d, user.id, params.id, params.coin, params.network, String(f.get("address") ?? ""));
      else await prepareCryptoPayment(d, user.id, params.id, params.coin, params.network, { refresh: true });
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
  const addingRefund = params.has("refund");
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
    const body = (await r.json().catch(() => ({}))) as { error?: string; explorer?: string };
    if (!r.ok) setDevMsg(body.error ?? "Something went wrong.");
    else if (body.explorer) { setDevTx(body.explorer); setDevMsg("Sent on Solana devnet. This page moves on by itself once the network confirms it, usually within a few seconds."); }
    else setDevMsg("The test wallet sent it, and the crypto partner's webhook arrived. This page will update.");
    revalidator.revalidate();
  };
  const [devTx, setDevTx] = useState<string | null>(null);
  const onChain = x.mode !== "pretend";

  return (
    <div>
      <TopBar title={`Pay with ${c}`} back={`/d/${x.deal.id}/pay`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Pay with {c} on {n.name}</h1>
        <nav className="desktop-only caption muted" aria-label="Breadcrumb"><Link to="/deals">Deals</Link> / <Link to={`/d/${x.deal.id}`}>{x.title}</Link> / <Link to={`/d/${x.deal.id}/pay`}>Pay</Link> / {c} on {n.name}</nav>

        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" />{x.deal.payBy ? <span className="caption muted">Pay by {when(new Date(x.deal.payBy))}</span> : null}</div>
          <p className="big-amount tabular">{p && !expired ? coinAmount(p.micro, x.coin) : naira(x.deal.due)}</p>
          <p className="body muted">{p && !expired ? `${naira(x.deal.due)} · ` : ""}{x.title} · {x.seller} accepted</p>
          <p className="row" style={{ gap: 10 }}><CryptoLogo coin={x.coin} network={x.network} size={28} lead="coin" /><span className="body">{c} on {networkLabel(n)}</span></p>
        </section>

        {!p ? null : expired ? (
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
            {/* Read before sending: these come first, above the address. */}
            {x.mode === "pretend" ? <Info icon="alert-triangle" tone="warn"><strong>Test mode: don't send real {c}.</strong> This address is pretend, so wallets won't accept it. Use the test buttons below instead.</Info> : null}
            {x.mode === "devnet" ? <Info icon="alert-triangle" tone="warn"><strong>Solana devnet: test tokens, not real money.</strong> This is a real Solana address on the test network. Pay from a wallet set to Devnet, or with NosHen's demo wallet below. Never send mainnet {c} here.</Info> : null}
            <Info icon="alert-triangle" tone="warn"><strong>Send only {c} on {n.name}.</strong> Another coin, or {c} on another network, can't be recovered.</Info>
            <Info icon="coin">Make sure exactly {coinAmount(p!.micro, x.coin)} arrives. If your exchange takes its fee out of what you send, add the fee on top.</Info>
            <section className="card stack-4" aria-label="Where to send">
              <div className="stack">
                <span className="label muted">Send to this address</span>
                <div className="pay-address">
                  {x.qr ? <span className="pay-qr" role="img" aria-label="QR code of the address" dangerouslySetInnerHTML={{ __html: x.qr }} /> : null}
                  <code className="pay-addr">{groupAddress(p!.address)}</code>
                </div>
                <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
                  <CopyButton text={p!.address} label="Copy address" />
                  {x.addressUrl ? <a className="caption" href={x.addressUrl} target="_blank" rel="noreferrer">See it on Solana Explorer</a> : null}
                </div>
              </div>
              <div>
                <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">Exact amount</span><span className="title tabular">{coinAmount(p!.micro, x.coin)}</span></span><CopyButton text={plainAmount(p!.micro)} /></div>
                <Kv k="Network" v={networkLabel(n)} />
                <Kv k="Rate" v={`${naira(p!.rateKobo)} per ${c}${x.test ? " (test rate)" : ""}`} />
                <Kv k="This amount holds for" v={<span className="tabular" aria-live="off">{mmss(left)}</span>} />
              </div>
            </section>
            <section className="card stack" aria-labelledby="refunds">
              <h2 id="refunds" className="title">Refunds</h2>
              {addingRefund ? (
                <>
                  <p className="body muted">If the deal is cancelled, or a problem is decided in your favour, we send your money back as {c} on {n.name} to this address.</p>
                  <RefundAddressForm coin={x.coin} network={x.network} defaultValue={x.refundAddress} submitLabel="Save address"
                    error={actionData?.intent === "refund" ? actionData.error : null} busy={busy} />
                  <Button block to={`/d/${x.deal.id}/pay/${x.coin}/${n.id}`}>{p!.refundLast4 ? `Keep the address ending ${p!.refundLast4}` : "Not now"}</Button>
                </>
              ) : p!.refundLast4 ? (
                <Kv k="Refunds go to" v={<span>Your address ending {p!.refundLast4} · <Link to="?refund=1" replace>Change</Link></span>} />
              ) : (
                <>
                  <p className="body muted">If the deal is cancelled, we send your money back as {c} to your own address on {n.name}. Add it now, or later if a refund is ever due.</p>
                  <div><Button to="?refund=1">Add my address</Button></div>
                </>
              )}
            </section>
            {onChain ? (
              <p className="caption muted">The {c} stays at this deal's own address, and {x.seller} can't touch it until you {x.deal.handover === "meetup" ? "give your release code" : "confirm you received the item"}. Then it moves to NosHen, which pays {x.seller} {naira(x.deal.due)} less the fee.</p>
            ) : (
              <p className="caption muted">Our crypto partner turns the {c} into {naira(x.deal.due)} for this deal, and our licensed partner holds it. {x.seller} can't touch it until you {x.deal.handover === "meetup" ? "give your release code" : "confirm you received the item"}.</p>
            )}
            {x.dev ? (
              <div className="dev stack">
                <p className="label">{onChain ? `Devnet: pay from NosHen's demo wallet. A real Solana transaction, with test ${c}:` : `Test mode: no real ${c} moves. Pretend to be your wallet:`}</p>
                <div className="row wrap">
                  <Button onClick={() => send(false)}>{onChain ? `Send ${coinAmount(p!.micro, x.coin)} from the demo wallet` : `Send ${coinAmount(p!.micro, x.coin)}`}</Button>
                  <Button onClick={() => send(true)}>Send too little</Button>
                </div>
                {devMsg ? <p className="caption">{devMsg}{devTx ? <> <a href={devTx} target="_blank" rel="noreferrer">See the transaction</a></> : null}</p> : null}
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
