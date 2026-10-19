import { useEffect, useRef, useState } from "react";
import { Form, Link, data, redirect, useFetcher, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/deal";
import { countryOf, requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { acceptDeal, cancelDeal, confirmReceived, declineDeal, explainHold, markDelivered, markStageDone, rate, sendMessage } from "@noshen/engine/deals";
import { BottomAction, Button, CheckedForm, ErrorText, Icon, Info, Kv, MoneyStatus, TextArea, Timeline, TopBar, useEscape } from "@noshen/ui/ui";
import { dealSteps, dealText } from "../lib/deal-text";
import { naira } from "@noshen/shared/money";
import { disputeReasonLabel, firstName, isOpen } from "@noshen/shared/deal";
import { when } from "@noshen/shared/time";
import { photoUrl } from "@noshen/shared/photos";
import { placeLabel, stateLabel } from "@noshen/shared/locations";
import { cryptoLabel, isNetwork, networkOf, type Coin, type Network } from "@noshen/shared/payments";
import { cryptoQuotes, explorerLink, refundsWaitingForAddress, saveRefundAddress } from "@noshen/engine/stablecoins";
import { RefundAddressForm } from "../lib/refund-address";
import { PushCard } from "../lib/push";
import { PayOptions } from "../lib/pay-options";
import { useDealLive } from "../lib/live-deal";
import { PackingPhotos } from "../lib/delivery";
import { BuyerRecord } from "../lib/track-record";
import { nextStage, stageAmount, type DealStage } from "../lib/stages";
import { useLite, useT, type T } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";

export const handle = { tabs: false };
export const meta: Route.MetaFunction = ({ loaderData: d }) => [{ title: d ? `Deal with ${firstName(d.otherName)} · NosHen` : "Deal · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || (v.deal.buyer_id !== user.id && v.deal.seller_id !== user.id)) throw data("This deal isn't yours.", { status: 404 });
    const role = v.deal.buyer_id === user.id ? ("buyer" as const) : ("seller" as const);
    const counted = v.payments.filter((p: any) => !p.sent_back);
    const paid = counted.reduce((s: number, p: any) => s + Number(p.amount_kobo), 0);
    // How the buyer paid, for "refunded to…": "USDC on Base", or null for a bank transfer.
    const paidCrypto = counted[0]?.method === "crypto" ? cryptoLabel(counted[0].coin, counted[0].network) : null;
    // What the deal comes to in USDT and USDC, for the ways to pay (only while the buyer has to pay).
    const quotes = role === "buyer" && v.deal.state === "accepted" ? await cryptoQuotes(d, Number(v.deal.amount_due_kobo)) : null;
    // A refund in USDT or USDC that can't go out until the buyer says where.
    const refundWaiting = role === "buyer" ? (await refundsWaitingForAddress(d, user.id, v.deal.id))[0] ?? null : null;
    return {
      me: user.id, role, paid, paidCrypto, country: countryOf(request), quotes, refundWaiting,
      // A stablecoin payment anyone can look up on the network's explorer (Solana), for both people to see.
      paymentUrl: counted[0]?.method === "crypto" ? explorerLink(d, counted[0].network, "tx", counted[0].tx_hash) : null,
      paymentExplorer: counted[0]?.method === "crypto" && isNetwork(counted[0].network) ? networkOf(counted[0].network).explorer : null,
      // For the buyer, while a payment is being checked: who it came from, and how much.
      holdPayment: role === "buyer" && v.deal.review_hold && counted[0] ? { amount_kobo: counted[0].amount_kobo as string, sender_name: (counted[0].sender_name ?? null) as string | null } : null,
      deal: v.deal, listing: { id: v.listing.id, title: v.listing.title, category: v.listing.category, area: placeLabel(v.listing.area, v.listing.state), photo: v.listing.photo_keys?.[0] ?? null },
      names: { buyer: v.buyer.name, seller: v.seller.name }, otherName: role === "buyer" ? v.seller.name : v.buyer.name,
      otherPhoto: (role === "buyer" ? v.seller.photo : v.buyer.photo) as string | null,
      // A seller deciding on a request sees what the buyer's own deals show.
      buyerRecord: role === "seller" ? v.buyer : null,
      events: v.events, messages: v.messages, dispute: v.dispute, evidence: v.evidence, ratings: v.ratings,
      // A job paid in stages: each stage, and whether it's marked done or released.
      stages: v.stages as DealStage[],
      bankLast4: role === "seller" ? v.sellerBank?.account_last4 ?? null : null,
      myRating: v.ratings.find((r: any) => r.rater_id === user.id) ?? null,
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      switch (intent) {
        case "accept": return acceptDeal(d, user.id, params.id);
        case "decline": return declineDeal(d, user.id, params.id);
        case "cancel": return cancelDeal(d, user.id, params.id);
        case "delivered": return markDelivered(d, user.id, params.id);
        case "stage_done": return markStageDone(d, user.id, params.id);
        case "received": return confirmReceived(d, user.id, params.id);
        case "message": return sendMessage(d, user.id, params.id, String(form.get("body") ?? ""));
        case "rate": return rate(d, user.id, params.id, Number(form.get("stars")), String(form.get("comment") ?? ""));
        case "explain": return explainHold(d, user.id, params.id, String(form.get("payer") ?? ""), String(form.get("note") ?? ""));
        case "refund": return saveRefundAddress(d, user.id, params.id, String(form.get("coin")), String(form.get("network")), String(form.get("address") ?? ""));
      }
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), intent };
  }
  return intent === "message" ? { ok: true, intent } : redirect(`/d/${params.id}`);
}

export default function Deal({ loaderData: x, actionData }: Route.ComponentProps) {
  const { deal, role, names, listing } = x;
  const t = useT();
  const lite = useLite();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  useEscape(payOpen, () => setPayOpen(false));
  const cancelling = busy && nav.formData?.get("intent") === "cancel";
  // Close the confirm sheet once the cancel has gone through (the deal's state changes) or failed (the error shows on the page).
  useEffect(() => { setCancelOpen(false); }, [deal.state]);
  useEffect(() => { if (actionData?.intent === "cancel") setCancelOpen(false); }, [actionData]);
  useEscape(cancelOpen, () => setCancelOpen(false), cancelling);
  const other = firstName(x.otherName);
  const buyerName = firstName(names.buyer);
  const endedBy = [...x.events].reverse().find((e: any) => e.to_state === "declined")?.actor ?? null;
  const dt = dealText(deal, role, names, x.paid, { decisionDue: x.dispute?.decision_due_at, evidenceDue: x.dispute?.evidence_due_at, bankLast4: x.bankLast4, endedBy, paidCrypto: x.paidCrypto, refundWaiting: !!x.refundWaiting, stages: x.stages }, new Date(), t);
  const steps = dealSteps(deal, role, names, x.events, x.dispute, new Date(), t, x.stages);
  const job = deal.kind === "service";
  const releasedShare = x.stages.filter((s) => s.released_at).reduce((n, s) => n + Number(s.share_kobo), 0);

  // Live: messages and changes from the other person (or the bank, or a reviewer) show the moment they happen.
  const live = useDealLive(deal.id, role);
  // If the live connection is down, keep checking while the deal is open: every 10 seconds, or 30 with data saver on.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isOpen(deal.state) || live.connected) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, lite ? 30_000 : 10_000);
    return () => clearInterval(id);
  }, [deal.state, live.connected, lite]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once a delivery is on its way it can't be cancelled: the buyer confirms it, or reports a problem. Nor can a job
  // once a stage of it has been paid.
  const canCancel = (deal.state === "requested" || deal.state === "accepted" || (deal.state === "held" && !deal.delivered_at && !deal.sent_at && !releasedShare));
  const delivery = Number(deal.delivery_kobo ?? 0);
  const deliveryTo = deal.delivery_state ? t("Delivery to {state}", { state: stateLabel(deal.delivery_state) }) : t("Delivery");
  const actions = actionsFor(x, t, () => setCancelOpen(true), canCancel, () => setPayOpen(true));
  const requestCancel = deal.state === "requested" && role === "buyer";

  // Where a refund goes, for the cancel sheet.
  const refundTo = deal.review_hold && !x.paidCrypto ? t("to the account it came from")
    : x.paidCrypto ? t("as {coin} to your own address, at the rate on the day", { coin: x.paidCrypto }) : t("to the account you paid from");

  return (
    <div>
      <TopBar title={t("Deal with {name}", { name: other })} back="/deals" />
      <main className="page no-tabs">
        <nav className="desktop-only caption muted" aria-label={t("Breadcrumb")}><Link to="/deals">{t("Deals")}</Link> / {role === "buyer" ? t("Buying") : t("Selling")} / {listing.title}</nav>
        <h1 className="heading desktop-only">{t("Deal with {name}", { name: other })}</h1>
        <div className="two-col">
          <div className="stack-4">
            <section className={`card stack money-card money-${dt.chip.state}${dt.chip.state === "held" ? " beam" : ""}`} aria-label={t("Where the money is")}>
              <div className="row-between wrap">
                <MoneyStatus state={dt.chip.state}>{dt.chip.word}</MoneyStatus>
                {dt.deadline ? <span className="caption muted row"><Icon name="clock" size={16} />{dt.deadline}</span> : null}
              </div>
              <p className="big-amount">{naira(dt.amountKobo)}{dt.amountSuffix ? ` ${dt.amountSuffix}` : ""}</p>
              <p className="body muted">{listing.title} · {other} · {job ? t("Paid in {n} stages", { n: x.stages.length }) : deal.handover === "meetup" ? t("Meet-up") : deliveryTo}</p>
              <p className="body">{dt.next}</p>
              {x.paymentUrl ? <p className="caption"><a href={x.paymentUrl} target="_blank" rel="noreferrer">{t("See the payment on {explorer}", { explorer: x.paymentExplorer ?? "" })}</a></p> : null}
            </section>

            {deal.state === "held" && !deal.review_hold && role === "buyer" ? (
              <Info icon="lock">{x.paymentUrl ? t("Your {coin} is held at this deal's own address, on-chain.", { coin: x.paidCrypto ?? "" }) : t("Our licensed partner holds your money.")} {job
                ? t("{name} is paid stage by stage, only when you release each one. If something is wrong, report it and what's still held stays held.", { name: other })
                : deal.handover === "meetup"
                ? t("{name} can't get it until you give your code. If something is wrong, report it and the money stays held.", { name: other })
                : t("{name} can't get it until you confirm you received it. If something is wrong, report it and the money stays held.", { name: other })}</Info>
            ) : null}
            {deal.state === "held" && role === "seller" ? (
              <section className="card">
                <Kv k={t("{name} paid", { name: buyerName })} v={naira(x.paid)} />
                <Kv k={deal.fee_payer === "buyer" ? t("NosHen fee, paid by {name}", { name: buyerName }) : t("NosHen fee, paid by you")} v={naira(deal.fee_kobo)} />
                {deal.handover === "delivery" ? <Kv k={t("{delivery}, for you to pay the courier", { delivery: deliveryTo })} v={delivery ? naira(delivery) : t("Free")} /> : null}
                <Kv k={t("You get")} v={naira(deal.seller_share_kobo)} total />
                {job && releasedShare ? <Kv k={t("Released to you so far")} v={naira(releasedShare)} /> : null}
                {x.bankLast4 ? <Kv k={t("Paid to")} v={t("Your bank ••{last4}", { last4: x.bankLast4 })} /> : null}
              </section>
            ) : null}
            {x.buyerRecord && (deal.state === "requested" || deal.state === "accepted") ? <BuyerRecord person={x.buyerRecord} /> : null}
            {role === "buyer" && deal.handover === "delivery" && (deal.state === "requested" || deal.state === "accepted") ? (
              <section className="card">
                <Kv k={t("Price")} v={naira(deal.price_kobo)} />
                <Kv k={deliveryTo} v={delivery ? naira(delivery) : t("Free")} />
                <Kv k={t("NosHen fee")} v={naira(deal.fee_kobo)} />
                <Kv k={t("Total")} v={naira(deal.amount_due_kobo)} total />
              </section>
            ) : null}
            {deal.handover === "delivery" && deal.sent_at ? <SentCard x={x} /> : null}
            {deal.state === "held" && !deal.review_hold && deal.handover === "delivery" && !deal.sent_at && role === "buyer" ? (
              <Info icon="truck-delivery">{t("Share your full address and phone number with {name} in the chat. {name} will add photos of it packed when it's sent. Delivery is already paid: don't pay a rider anything extra.", { name: other })}</Info>
            ) : null}
            {deal.state === "held" && role === "seller" && deal.handover === "meetup" && !job ? (
              <Info icon="shield-lock">{t("Only {name}'s phone shows the code. Nobody from NosHen will ever ask you for it.", { name: buyerName })}</Info>
            ) : null}

            {deal.review_hold && role === "buyer" ? <HoldCard x={x} other={other} busy={busy} error={actionData?.intent === "explain" ? (actionData as any).error : undefined} onCancel={() => setCancelOpen(true)} /> : null}
            {isOpen(deal.state) ? <PushCard compact /> : null}

            {x.refundWaiting ? (
              <section className="card stack" aria-labelledby="refund-to">
                <h2 id="refund-to" className="title">{t("Where should we send your {amount}?", { amount: naira(x.refundWaiting.amountKobo) })}</h2>
                <p className="body muted">{t("You paid with {coin}, so your refund goes back that way, at the rate on the day. Add your own address and we'll send it straight away.", { coin: cryptoLabel(x.refundWaiting.coin as Coin, x.refundWaiting.network as Network) })}</p>
                <RefundAddressForm coin={x.refundWaiting.coin as Coin} network={x.refundWaiting.network as Network} defaultValue={x.refundWaiting.lastAddress}
                  submitLabel={t("Send my refund")} error={actionData?.intent === "refund" ? (actionData as any).error : null} busy={busy} />
              </section>
            ) : null}

            {x.dispute ? <DisputeSummary x={x} /> : null}

            {(deal.state === "released" || deal.state === "paid_out") ? <RateBox x={x} other={other} busy={busy} error={actionData?.intent === "rate" ? actionData.error : undefined} /> : null}

            <ErrorText>{actionData && !["message", "rate", "refund", "explain"].includes(actionData.intent) ? (actionData as any).error : null}</ErrorText>
            {actions.length ? <div className="desktop-only stack">{actions}</div> : null}

            <section className="card stack-4" aria-labelledby="steps">
              <h2 id="steps" className="label muted">{t("Deal steps")}</h2>
              <Timeline steps={steps} />
            </section>
          </div>
          <aside className="side">
            <Chat x={x} other={other} live={live} />
          </aside>
        </div>
      </main>
      {actions.length ? <aside className="mobile-only" aria-label={t("What you can do now")}><BottomAction staticOnDesktop={false}>{actions}</BottomAction></aside> : null}

      {payOpen ? (
        <div className="sheet-backdrop" onClick={() => setPayOpen(false)}>
          <div className="sheet pay-sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ alignItems: "flex-start" }}>
              <div className="stack" style={{ gap: 4 }}>
                <h2 id="pay-title" className="heading">{t("How do you want to pay?")}</h2>
                <p className="body muted">{job
                  ? t("{amount} for the {item}. However you pay, NosHen holds it and pays {name} stage by stage, as you release each one.", { amount: naira(deal.amount_due_kobo), item: listing.title, name: other })
                  : t("{amount} for the {item}. However you pay, NosHen holds it until you have the item.", { amount: naira(deal.amount_due_kobo), item: listing.title })}</p>
              </div>
              <button type="button" className="icon-btn" aria-label={t("Close")} autoFocus onClick={() => setPayOpen(false)}><Icon name="x" size={20} /></button>
            </div>
            <PayOptions dealId={deal.id} country={x.country} quotes={x.quotes} />
          </div>
        </div>
      ) : null}

      {cancelOpen ? (
        <div className="sheet-backdrop" onClick={() => !cancelling && setCancelOpen(false)}>
          <Form method="post" className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <input type="hidden" name="intent" value="cancel" />
            <h2 id="cancel-title" className="heading">{requestCancel ? t("Cancel this request?") : t("Cancel this deal?")}</h2>
            <p className="body">{deal.state === "held"
              ? (role === "buyer"
                ? (delivery
                  ? t("You get all {amount} back, fee and delivery included, {where}.", { amount: naira(x.paid), where: refundTo })
                  : t("You get all {amount} back, fee included, {where}.", { amount: naira(x.paid), where: refundTo }))
                : t("{name} gets all their money back. You won't be paid for this deal.", { name: buyerName }))
              : t("Nothing has been paid, so there's nothing to refund.")}</p>
            <Button type="submit" variant="danger" size="lg" block disabled={busy}>{cancelling ? t("Cancelling…") : requestCancel ? t("Cancel request") : t("Cancel deal")}</Button>
            <Button size="lg" block autoFocus disabled={cancelling} onClick={() => setCancelOpen(false)}>{requestCancel ? t("Keep the request") : t("Keep the deal")}</Button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

type View = Route.ComponentProps["loaderData"];

/** Who paid, when a payment came from an account in another name: the choice, its hint, and how it reads back. */
const PAYERS: [string, string, string, string][] = [
  ["someone_i_know", msg("Someone I know paid for me"), msg("Family or a friend. Say who: “my brother, Adebayo Johnson”."), msg("someone you know paid for you")],
  ["my_other_account", msg("It's my own account, in another name"), msg("A business account, or a name you used to have. Say whose."), msg("it's your own account, in another name")],
  ["unknown", msg("I don't know who sent this"), msg("We'll check, and send it back to where it came from if we can't confirm it."), msg("you don't know who sent it")],
];

/**
 * A payment held for review, for the buyer: why, in plain words; who paid (their answer goes to the reviewer); and
 * a way out (cancel, and the money goes back to the account it came from).
 */
function HoldCard({ x, other, busy, error, onCancel }: { x: View; other: string; busy: boolean; error?: string; onCancel: () => void }) {
  const t = useT();
  const { deal } = x;
  const pay = x.holdPayment;
  const nameIssue = String(deal.review_hold_reason ?? "").startsWith("Payment name");
  const [payer, setPayer] = useState<string>(deal.hold_payer ?? "");
  const [editing, setEditing] = useState(!deal.hold_payer);
  useEffect(() => { if (deal.hold_explained_at) setEditing(false); }, [deal.hold_explained_at]);
  const answered = PAYERS.find(([k]) => k === deal.hold_payer);
  return (
    <section className="card stack-4 hold-card" aria-labelledby="hold-title">
      <div className="stack">
        <h2 id="hold-title" className="title">{t("We're checking your payment")}</h2>
        <p className="body">{nameIssue
          ? t.rich("Your {amount} arrived from an account named <b>{sender}</b>, not yours. NosHen checks payments like this, in case someone else's account was used without them knowing.",
            { b: (s) => <strong>{s}</strong> }, { amount: naira(pay?.amount_kobo ?? deal.amount_due_kobo), sender: pay?.sender_name ?? t("someone else") })
          : t("We received {paid}, but the deal is {due}. A reviewer will either let the deal go ahead or send the money back to where it came from.", { paid: naira(pay?.amount_kobo ?? 0), due: naira(deal.amount_due_kobo) })}</p>
        <p className="caption muted">{t("Don't meet {name} yet. A NosHen reviewer decides soon, and we'll tell you both.", { name: other })}</p>
      </div>
      {nameIssue ? (answered && !editing ? (
        <div className="stack">
          <Info icon="circle-check">{t.rich("<b>Thanks. The reviewer has your answer:</b> {answer}.", { b: (s) => <strong>{s}</strong> }, { answer: `${t(answered[3])}${deal.hold_note ? ` (“${deal.hold_note}”)` : ""}` })}</Info>
          <div><Button size="sm" onClick={() => setEditing(true)}>{t("Change my answer")}</Button></div>
        </div>
      ) : (
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="explain" />
          <p className="label">{t("Who paid?")}</p>
          {PAYERS.map(([k, label, hint]) => (
            <label key={k} className="choice">
              <input type="radio" name="payer" value={k} checked={payer === k} onChange={() => setPayer(k)} required />
              <span className="stack" style={{ gap: 0 }}><span className="body">{t(label)}</span><span className="caption muted">{t(hint)}</span></span>
            </label>
          ))}
          {payer && payer !== "unknown" ? (
            <TextArea label={payer === "someone_i_know" ? t("Who paid?") : t("Whose account is it?")} name="note" rows={2} maxLength={500} required defaultValue={deal.hold_note ?? ""}
              placeholder={payer === "someone_i_know" ? t("My brother, Adebayo Johnson") : t("My business account, AJ Stores")} />
          ) : <input type="hidden" name="note" value="" />}
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary" block disabled={busy || !payer}>{t("Send my answer")}</Button>
        </Form>
      )) : null}
      <div className="stack" style={{ gap: 4 }}>
        <div><Button size="sm" onClick={onCancel}>{t("Cancel and get it back")}</Button></div>
        <p className="caption muted">{t("Ends the deal. The money goes back to the account it came from. You can pay again from your own account with a new request.")}</p>
      </div>
    </section>
  );
}

function actionsFor(x: View, t: T, openCancel: () => void, canCancel: boolean, openPay: () => void) {
  const { deal, role } = x;
  const out: React.ReactNode[] = [];
  const post = (intent: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary") => (
    <Form method="post" key={intent}><input type="hidden" name="intent" value={intent} /><Button type="submit" variant={variant} size={variant === "primary" ? "lg" : "md"} block>{label}</Button></Form>
  );
  const cancel = canCancel ? <Button key="cancel" block onClick={openCancel}>{deal.state === "requested" && role === "buyer" ? t("Cancel request") : t("Cancel deal")}</Button> : null;
  const report = <Button key="report" block to={`/d/${deal.id}/report`}>{t("Report a problem")}</Button>;
  // A delivery is released after the checks for that kind of item (the confirm page), like a release code after a meet-up.
  const received = <Button key="received" variant="primary" size="lg" block to={`/d/${deal.id}/confirm`}>{t("It arrived: check it and release")}</Button>;
  if (deal.state === "requested") {
    if (role === "seller") out.push(post("accept", t("Accept request"), "primary"), post("decline", t("Decline")));
    else out.push(cancel);
  } else if (deal.state === "accepted") {
    // Opens the ways to pay in a sheet here; without JavaScript, the link goes to the same choices on their own page.
    if (role === "buyer") out.push(<Button key="pay" variant="primary" size="lg" block to={`/d/${deal.id}/pay`}
      onClick={(e) => { e.preventDefault(); openPay(); }}>{t("Pay {amount}", { amount: naira(deal.amount_due_kobo) })}</Button>);
    out.push(cancel);
  } else if (deal.state === "held" && !deal.review_hold) {
    if (deal.kind === "service") {
      // A job: the seller marks the next stage done; the buyer checks it and releases it (they can release it sooner).
      const next = nextStage(x.stages);
      if (next) {
        const stage = t(next.title);
        if (role === "buyer") out.push(<Button key="stage" variant={next.done_at ? "primary" : "secondary"} size={next.done_at ? "lg" : "md"} block to={`/d/${deal.id}/confirm`}>
          {t("Check “{stage}” and release {amount}", { stage, amount: naira(stageAmount(next, "buyer", deal.fee_payer)) })}</Button>, report);
        else if (!next.done_at) out.push(post("stage_done", t("Mark “{stage}” done", { stage }), "primary"));
      }
      out.push(cancel);
    } else if (deal.handover === "meetup") {
      if (role === "buyer") out.push(<Button key="code" variant="primary" size="lg" block icon="lock" to={`/d/${deal.id}/code`}>{t("Show release code")}</Button>, report);
      else out.push(<Button key="enter" variant="primary" size="lg" block to={`/d/${deal.id}/enter-code`}>{t("Enter release code")}</Button>);
      out.push(cancel);
    } else if (!deal.sent_at) {
      if (role === "seller") out.push(<Button key="send" variant="primary" size="lg" block icon="truck-delivery" to={`/d/${deal.id}/send`}>{t("Send it: add packing photos")}</Button>);
      out.push(cancel);
    } else if (!deal.delivered_at) {
      // On its way: the seller marks it delivered, or the buyer confirms as soon as they have it.
      if (role === "seller") out.push(post("delivered", t("Mark delivered"), "primary"));
      else out.push(received, report);
    } else if (role === "buyer") {
      out.push(received, report);
    }
  } else if (deal.state === "disputed" && x.dispute?.state === "collecting_evidence") {
    out.push(<Button key="ev" variant="primary" size="lg" block to={`/d/${deal.id}/evidence`}>{t("Add photos or notes")}</Button>);
  } else if ((deal.state === "released" || deal.state === "paid_out") && role === "seller") {
    out.push(<Button key="sell" block to="/sell">{t("Sell something else")}</Button>);
  }
  return out.filter(Boolean);
}

/** What the seller sent: when, with whom, the tracking number, and the packing photos. Both people see it. */
function SentCard({ x }: { x: View }) {
  const t = useT();
  const { deal, role } = x;
  const seller = firstName(x.names.seller);
  return (
    <section className="card stack" aria-labelledby="sent-title">
      <h2 id="sent-title" className="title">{role === "buyer" ? t("What {name} sent", { name: seller }) : t("What you sent")}</h2>
      <div>
        <Kv k={t("Sent")} v={when(new Date(deal.sent_at))} />
        <Kv k={t("With")} v={deal.courier} />
        {deal.tracking_ref ? <Kv k={t("Tracking")} v={<span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><span style={{ overflowWrap: "anywhere" }}>{deal.tracking_ref}</span><CopyText text={deal.tracking_ref} /></span>} /> : null}
        {deal.delivered_at ? <Kv k={t("Marked delivered")} v={when(new Date(deal.delivered_at))} /> : null}
      </div>
      <p className="label">{t("Packing photos")}</p>
      <PackingPhotos keys={deal.packing_photo_keys ?? []} title={x.listing.title} />
      {role === "buyer" && !deal.delivered_at && deal.state === "held"
        ? <p className="caption muted">{t("Check what arrives against these photos before you confirm. Don't pay the rider anything extra: delivery is already paid.")}</p>
        : <p className="caption muted">{t("Kept with the deal as evidence if there's a problem.")}</p>}
    </section>
  );
}

/** A small "Copy" button for a tracking number. */
function CopyText({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label={copied ? t("Copied") : t("Copy tracking number")}
      onClick={async () => { await navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      <Icon name={copied ? "check" : "copy"} size={16} />
    </button>
  );
}

function DisputeSummary({ x }: { x: View }) {
  const t = useT();
  const d = x.dispute!;
  const decided = d.state === "decided";
  return (
    <section className="card stack" aria-label={t("The problem reported")}>
      <p className="label muted">{x.role === "buyer" ? t("Your report") : t("{name}'s report", { name: firstName(x.names.buyer) })}</p>
      <p className="title">{t(disputeReasonLabel(d.reason))}</p>
      {d.description ? <p className="body">{d.description}</p> : null}
      <p className="caption muted">{when(new Date(d.created_at))} · {x.evidence.length === 1 ? t("1 piece of evidence") : t("{n} pieces of evidence", { n: x.evidence.length })}</p>
      {x.evidence.length ? (
        <div className="photo-grid">
          {x.evidence.map((e: any, i: number) => e.file_key
            ? <a key={i} className="photo-slot" href={photoUrl(e.file_key)} target="_blank" rel="noreferrer"><img src={photoUrl(e.file_key, "small")} alt={t("Evidence photo")} loading="lazy" decoding="async" /></a>
            : <div key={i} className="photo-slot" style={{ padding: 8, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", color: "var(--ink)" }}>{e.note}</div>)}
        </div>
      ) : null}
      {decided ? (
        <Info icon="scale">{d.decision === "refund_buyer"
          ? t("Decision: refunded to the buyer. Reason: {reason}", { reason: d.decision_reason })
          : t("Decision: released to the seller. Reason: {reason}", { reason: d.decision_reason })}</Info>
      ) : (
        <p className="caption muted">{t("If the item isn't as listed, the buyer is refunded in full. If it is, the money is released to the seller.")}</p>
      )}
    </section>
  );
}

const STAR_WORDS = [msg("Tap a star"), msg("Poor"), msg("Not great"), msg("Okay"), msg("Good"), msg("Very good")];

function RateBox({ x, other, busy, error }: { x: View; other: string; busy: boolean; error?: string }) {
  const t = useT();
  const [stars, setStars] = useState<number>(x.myRating?.stars ?? 0);
  if (x.myRating) return <Info icon="star">{x.myRating.stars === 1 ? t("You rated {name} 1 star. Thank you.", { name: other }) : t("You rated {name} {n} stars. Thank you.", { name: other, n: x.myRating.stars })}</Info>;
  return (
    <Form method="post" className="card stack">
      <input type="hidden" name="intent" value="rate" />
      <p className="title">{t("How was {name}?", { name: other })}</p>
      <p className="caption muted">{x.role === "buyer" ? t("Your rating helps other buyers decide.") : t("Your rating helps other sellers decide.")}</p>
      <div className="stars" role="radiogroup" aria-label={t("Rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} aria-label={n === 1 ? t("1 star") : t("{n} stars", { n })}>
            <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} />
            <svg width="32" height="32" viewBox="0 0 24 24" fill={n <= stars ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
            </svg>
          </label>
        ))}
      </div>
      <p className="caption muted">{t(STAR_WORDS[stars])}</p>
      <TextArea label={t("Anything to add? (optional)")} name="comment" maxLength={500} />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="primary" block disabled={busy || !stars}>{t("Rate {name}", { name: other })}</Button>
    </Form>
  );
}

/** The deal's chat: messages arrive live, yours shows the moment you send it, and you see when the other person is typing. */
function Chat({ x, other, live }: { x: View; other: string; live: ReturnType<typeof useDealLive> }) {
  const t = useT();
  const open = isOpen(x.deal.state);
  const flagged = x.messages.some((m: any) => m.flagged);
  const fetcher = useFetcher<{ ok?: boolean; error?: string; intent?: string }>({ key: `chat-${x.deal.id}` });
  const form = useRef<HTMLFormElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  // While it's on its way, the message shows already (faded), so sending feels instant.
  const sending = fetcher.state !== "idle" ? String(fetcher.formData?.get("body") ?? "").trim() : "";
  const error = fetcher.state === "idle" && fetcher.data?.intent === "message" ? fetcher.data.error : undefined;
  const count = x.messages.length;
  // Keep the newest message in view as messages arrive.
  useEffect(() => { const el = list.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: count > 0 ? "smooth" : "auto" }); }, [count, !!sending, live.otherTyping]);
  return (
    <section className="card stack-4" id="chat" aria-labelledby="chat-title">
      <div className="row">
        <span className={`avatar${x.otherPhoto ? " has-photo" : ""}`} aria-hidden="true">{x.otherPhoto ? <img src={photoUrl(x.otherPhoto, "small")} alt="" /> : other[0]}{live.otherOnline ? <span className="online-dot" /> : null}</span>
        <div>
          <h2 id="chat-title" className="title">{other}</h2>
          <p className="caption muted">{live.otherTyping ? <span className="typing-text">{t("typing…")}</span> : live.otherOnline ? t("On this deal now") : t("Keep everything about this deal in this chat.")}</p>
        </div>
      </div>
      <div className="chat chat-scroll" ref={list} aria-live="polite">
        {count === 0 && !sending ? <p className="caption muted">{t("No messages yet.")}</p> : null}
        {x.messages.map((m: any) => (
          <div key={m.id} className={`bubble ${m.sender_id === x.me ? "mine" : ""} ${m.flagged ? "flagged" : ""}`}>
            <p className="body">{m.body}</p>
            <p className="caption muted">{when(new Date(m.at))}</p>
          </div>
        ))}
        {sending ? <div className="bubble mine sending"><p className="body">{sending}</p><p className="caption muted">{t("Sending…")}</p></div> : null}
        {live.otherTyping ? <div className="bubble typing" aria-label={t("{name} is typing", { name: other })}><span /><span /><span /></div> : null}
      </div>
      {flagged ? <Info icon="alert-triangle" tone="warn">{t.rich("<b>Only pay through NosHen.</b> Money sent straight to someone's account isn't protected. If something goes wrong, we can't get it back for you.", { b: (s) => <strong>{s}</strong> })}</Info> : null}
      {open ? (
        <fetcher.Form method="post" className="chat-form" ref={form} onSubmit={(e) => {
          const body = (e.currentTarget.elements.namedItem("body") as HTMLInputElement).value.trim();
          if (!body) { e.preventDefault(); setEmpty(true); return; }
          setEmpty(false);
          // Clear the box straight away; the message is already showing above.
          requestAnimationFrame(() => form.current?.reset());
        }}>
          <input type="hidden" name="intent" value="message" />
          <label className="sr-only" htmlFor="body">{t("Message {name}", { name: other })}</label>
          <input id="body" name="body" className="nh-input grow" placeholder={t("Message {name}", { name: other })} maxLength={2000} autoComplete="off" enterKeyHint="send"
            onInput={() => { live.typing(); if (empty) setEmpty(false); }} aria-invalid={empty || undefined} />
          <Button type="submit" icon="send" aria-label={t("Send")}>{t("Send")}</Button>
          {empty ? <p className="nh-field-msg nh-field-msg-error caption" role="alert"><Icon name="alert-triangle" size={16} />{t("Type a message before you send it.")}</p> : null}
        </fetcher.Form>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
