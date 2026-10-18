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
import { useLite, useT } from "@noshen/ui/i18n";

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
    // (Also replaces an unused address from a provider that no longer serves this network.)
    try {
      await prepareCryptoPayment(d, user.id, v.deal.id, coin, network);
    } catch (e) {
      if (e instanceof DealError) throw redirect(`/d/${params.id}`);
      throw e;
    }
    const found = await cryptoPaymentFor(d, user.id, v.deal.id, coin, network);
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
  const t = useT();
  const lite = useLite();
  const n = networkOf(x.network);
  const c = coinName(x.coin);
  const [params] = useSearchParams();
  const p = x.payment;
  const addingRefund = params.has("refund");
  const busy = useNavigation().state !== "idle";
  const left = useSecondsLeft(p?.expiresAt, x.now);
  const expired = !!p && left <= 0;
  const [devMsg, setDevMsg] = useState<string | null>(null);

  // "This page updates when the network confirms your payment": check every 5 seconds once there's an address
  // (15 with data saver on).
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!p) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, lite ? 15_000 : 5000);
    return () => clearInterval(id);
  }, [!!p, lite]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (short: boolean) => {
    setDevMsg("Sending…");
    const r = await fetch("/api/dev/crypto/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dealId: x.deal.id, coin: x.coin, network: x.network, short }) });
    const body = (await r.json().catch(() => ({}))) as { error?: string; explorer?: string };
    if (!r.ok) setDevMsg(body.error ?? "Something went wrong.");
    else if (body.explorer) { setDevTx(body.explorer); setDevMsg(`Sent on ${n.testnet}. This page moves on by itself once the network confirms it, usually within a few seconds.`); }
    else setDevMsg("The test wallet sent it, and the crypto partner's webhook arrived. This page will update.");
    revalidator.revalidate();
  };
  const [devTx, setDevTx] = useState<string | null>(null);
  const onChain = x.mode !== "pretend";
  const untilReleased = x.deal.handover === "meetup" ? t("until you give your release code") : t("until you confirm you received the item");

  return (
    <div>
      <TopBar title={t("Pay with {coin}", { coin: c })} back={`/d/${x.deal.id}/pay`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Pay with {coin} on {network}", { coin: c, network: n.name })}</h1>
        <nav className="desktop-only caption muted" aria-label={t("Breadcrumb")}><Link to="/deals">{t("Deals")}</Link> / <Link to={`/d/${x.deal.id}`}>{x.title}</Link> / <Link to={`/d/${x.deal.id}/pay`}>{t("Pay")}</Link> / {t("{coin} on {network}", { coin: c, network: n.name })}</nav>

        <section className="card stack">
          <div className="row-between wrap"><MoneyStatus state="awaiting" />{x.deal.payBy ? <span className="caption muted">{t("Pay by {time}", { time: when(new Date(x.deal.payBy)) })}</span> : null}</div>
          <p className="big-amount tabular">{p && !expired ? coinAmount(p.micro, x.coin) : naira(x.deal.due)}</p>
          <p className="body muted">{p && !expired ? `${naira(x.deal.due)} · ` : ""}{t("{item} · {name} accepted", { item: x.title, name: x.seller })}</p>
          <p className="row" style={{ gap: 10 }}><CryptoLogo coin={x.coin} network={x.network} size={28} lead="coin" /><span className="body">{t("{coin} on {network}", { coin: c, network: networkLabel(n) })}</span></p>
        </section>

        {!p ? null : expired ? (
          <section className="card stack-4">
            <Info icon="clock">{t.rich("<b>This amount has run out.</b> {coin} prices move against the naira, so we fix the amount for {minutes} minutes at a time.", { b: (s) => <strong>{s}</strong> }, { coin: c, minutes: QUOTE_MINUTES })}</Info>
            <p className="body">{t("Already sent it? Don't send it again. When it arrives, we'll check it and email you.")}</p>
            <Form method="post" replace>
              <input type="hidden" name="intent" value="refresh" />
              <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? t("Getting a new amount…") : t("Get a new amount")}</Button>
            </Form>
            <ErrorText>{actionData?.intent === "refresh" ? actionData.error : null}</ErrorText>
          </section>
        ) : (
          <>
            {/* Read before sending: these come first, above the address. */}
            {x.mode === "pretend" ? <Info icon="alert-triangle" tone="warn">{t.rich("<b>Test mode: don't send real {coin}.</b> This address is pretend, so wallets won't accept it. Use the test buttons below instead.", { b: (s) => <strong>{s}</strong> }, { coin: c })}</Info> : null}
            {x.mode === "devnet" ? <Info icon="alert-triangle" tone="warn">{t.rich("<b>{testnet}: test tokens, not real money.</b> This is a real {network} address on the test network. Pay from a wallet set to {testnet}, or with NosHen's demo wallet below. Never send real {coin} here.", { b: (s) => <strong>{s}</strong> }, { testnet: n.testnet, network: n.name, coin: c })}</Info> : null}
            <Info icon="alert-triangle" tone="warn">{t.rich("<b>Send only {coin} on {network}.</b> Another coin, or {coin} on another network, can't be recovered.", { b: (s) => <strong>{s}</strong> }, { coin: c, network: n.name })}</Info>
            <Info icon="coin">{t("Make sure exactly {amount} arrives. If your exchange takes its fee out of what you send, add the fee on top.", { amount: coinAmount(p!.micro, x.coin) })}</Info>
            <section className="card stack-4" aria-label={t("Where to send")}>
              <div className="stack">
                <span className="label muted">{t("Send to this address")}</span>
                <div className="pay-address">
                  {x.qr ? <span className="pay-qr" role="img" aria-label={t("QR code of the address")} dangerouslySetInnerHTML={{ __html: x.qr }} /> : null}
                  <code className="pay-addr">{groupAddress(p!.address)}</code>
                </div>
                <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
                  <CopyButton text={p!.address} label={t("Copy address")} />
                  {x.addressUrl ? <a className="caption" href={x.addressUrl} target="_blank" rel="noreferrer">{t("See it on {explorer}", { explorer: n.explorer })}</a> : null}
                </div>
              </div>
              <div>
                <div className="kv" style={{ alignItems: "center" }}><span className="stack"><span className="muted">{t("Exact amount")}</span><span className="title tabular">{coinAmount(p!.micro, x.coin)}</span></span><CopyButton text={plainAmount(p!.micro)} /></div>
                <Kv k={t("Network")} v={networkLabel(n)} />
                <Kv k={t("Rate")} v={x.test ? t("{rate} per {coin} (test rate)", { rate: naira(p!.rateKobo), coin: c }) : t("{rate} per {coin}", { rate: naira(p!.rateKobo), coin: c })} />
                <Kv k={t("This amount holds for")} v={<span className="tabular" aria-live="off">{mmss(left)}</span>} />
              </div>
            </section>
            <section className="card stack" aria-labelledby="refunds">
              <h2 id="refunds" className="title">{t("Refunds")}</h2>
              {addingRefund ? (
                <>
                  <p className="body muted">{t("If the deal is cancelled, or a problem is decided in your favour, we send your money back as {coin} on {network} to this address.", { coin: c, network: n.name })}</p>
                  <RefundAddressForm coin={x.coin} network={x.network} defaultValue={x.refundAddress} submitLabel={t("Save address")}
                    error={actionData?.intent === "refund" ? actionData.error : null} busy={busy} />
                  <Button block to={`/d/${x.deal.id}/pay/${x.coin}/${n.id}`}>{p!.refundLast4 ? t("Keep the address ending {last4}", { last4: p!.refundLast4 }) : t("Not now")}</Button>
                </>
              ) : p!.refundLast4 ? (
                <Kv k={t("Refunds go to")} v={<span>{t("Your address ending {last4}", { last4: p!.refundLast4 })} · <Link to="?refund=1" replace>{t("Change")}</Link></span>} />
              ) : (
                <>
                  <p className="body muted">{t("If the deal is cancelled, we send your money back as {coin} to your own address on {network}. Add it now, or later if a refund is ever due.", { coin: c, network: n.name })}</p>
                  <div><Button to="?refund=1">{t("Add my address")}</Button></div>
                </>
              )}
            </section>
            {onChain ? (
              <p className="caption muted">{t("The {coin} stays at this deal's own address, and {name} can't touch it {until}. Then it moves to NosHen, which pays {name}.", { coin: c, name: x.seller, until: untilReleased })}</p>
            ) : (
              <p className="caption muted">{t("Our crypto partner turns the {coin} into {amount} for this deal, and our licensed partner holds it. {name} can't touch it {until}.", { coin: c, amount: naira(x.deal.due), name: x.seller, until: untilReleased })}</p>
            )}
            {x.dev ? (
              <div className="dev stack">
                <p className="label">{onChain ? `${n.testnet}: pay from NosHen's demo wallet. A real ${n.name} transaction, with test ${c}:` : `Test mode: no real ${c} moves. Pretend to be your wallet:`}</p>
                <div className="row wrap">
                  <Button onClick={() => send(false)}>{onChain ? `Send ${coinAmount(p!.micro, x.coin)} from the demo wallet` : `Send ${coinAmount(p!.micro, x.coin)}`}</Button>
                  <Button onClick={() => send(true)}>Send too little</Button>
                </div>
                {devMsg ? <p className="caption">{devMsg}{devTx ? <> <a href={devTx} target="_blank" rel="noreferrer">See the transaction</a></> : null}</p> : null}
              </div>
            ) : null}
            <BottomAction>
              <CopyButton text={p!.address} label={t("Copy address")} />
              <p className="caption muted" style={{ textAlign: "center" }}>{t("This page updates when the network confirms your payment.")} <Link to={`/d/${x.deal.id}/pay`}>{t("Pay another way")}</Link></p>
            </BottomAction>
          </>
        )}
      </main>
    </div>
  );
}
