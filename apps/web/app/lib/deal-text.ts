// What the deal page says to each person in each state (docs: app-flow.md, "The deal page by state"), in the
// reader's language (`t`; English by default).
import type { DealState } from "@noshen/shared/deal";
import { STATUS, firstName } from "@noshen/shared/deal";
import { naira } from "@noshen/shared/money";
import { when } from "@noshen/shared/time";
import { en, type T } from "@noshen/shared/i18n";
import type { MoneyState, Step } from "@noshen/ui/ui";

export interface DealLike {
  state: DealState;
  handover: "meetup" | "delivery";
  amount_due_kobo: string | number;
  seller_share_kobo: string | number;
  request_expires_at: string | Date;
  payment_due_at: string | Date | null;
  handover_due_at: string | Date | null;
  delivered_at: string | Date | null;
  release_due_at: string | Date | null;
  /** A delivery the seller has sent: when, with whom, and the tracking number. */
  sent_at?: string | Date | null;
  courier?: string | null;
  tracking_ref?: string | null;
  review_hold: boolean;
  created_at: string | Date;
}

export interface DealText {
  chip: { state: MoneyState; word: string };
  deadline?: string;
  amountKobo: number;
  amountSuffix?: string;   // "held", "frozen", "released"
  next: string;
}

export function dealText(deal: DealLike, role: "buyer" | "seller", names: { buyer: string; seller: string }, paidKobo: number, extra: { decisionDue?: string | Date | null; evidenceDue?: string | Date | null; bankLast4?: string | null; endedBy?: "buyer" | "seller" | "system" | null; paidCrypto?: string | null; refundWaiting?: boolean } = {}, now = new Date(), t: T = en): DealText {
  const buyer = firstName(names.buyer);
  const seller = firstName(names.seller);
  const due = Number(deal.amount_due_kobo);
  const share = Number(deal.seller_share_kobo);
  const chip = { state: STATUS[deal.state].state, word: t(STATUS[deal.state].word) };
  const at = (x: string | Date | null | undefined) => (x ? when(new Date(x), now) : "");
  const held = t("held");

  switch (deal.state) {
    case "requested":
      return role === "buyer"
        ? { chip, deadline: t("Accept by {time}", { time: at(deal.request_expires_at) }), amountKobo: due, next: t("{seller} has until {time} to accept. You pay nothing until {seller} accepts.", { seller, time: at(deal.request_expires_at) }) }
        : { chip: { state: "awaiting", word: t("New request") }, deadline: t("Answer by {time}", { time: at(deal.request_expires_at) }), amountKobo: share, next: t("{buyer} wants to buy this with protection. Accept or decline by {time}.", { buyer, time: at(deal.request_expires_at) }) };
    case "accepted":
      return role === "buyer"
        ? { chip, deadline: t("Pay by {time}", { time: at(deal.payment_due_at) }), amountKobo: due, next: t("Pay {amount} into NosHen by {time}. We hold it until you have the item.", { amount: naira(due), time: at(deal.payment_due_at) }) }
        : { chip, deadline: t("Pay by {time}", { time: at(deal.payment_due_at) }), amountKobo: share, next: t("Waiting for {buyer} to pay. Don't hand anything over until NosHen shows the money as held.", { buyer }) };
    case "held": {
      if (deal.review_hold) {
        return role === "buyer"
          ? { chip, amountKobo: paidKobo, amountSuffix: held, next: t("We're checking your payment and will email you. Don't meet yet.") }
          : { chip, amountKobo: share, amountSuffix: held, next: t("NosHen is checking this payment. Don't hand over yet.") };
      }
      if (deal.handover === "delivery" && deal.delivered_at) {
        return role === "buyer"
          ? { chip, deadline: t("Confirm by {time}", { time: at(deal.release_due_at) }), amountKobo: paidKobo, amountSuffix: held, next: t("Check the item. Confirm or report a problem by {time}, or the money goes to {seller}.", { time: at(deal.release_due_at), seller }) }
          : { chip, deadline: t("Release {time}", { time: at(deal.release_due_at) }), amountKobo: share, amountSuffix: held, next: t("Waiting for {buyer} to confirm, until {time}.", { buyer, time: at(deal.release_due_at) }) };
      }
      if (deal.handover === "delivery" && deal.sent_at) {
        const how = deal.tracking_ref
          ? t("{courier}, tracking {tracking}", { courier: deal.courier ?? t("the courier"), tracking: deal.tracking_ref })
          : deal.courier ?? t("the courier");
        const onItsWay = { state: "held" as const, word: t("On its way") };
        return role === "buyer"
          ? { chip: onItsWay, deadline: t("Sent {time}", { time: at(deal.sent_at) }), amountKobo: paidKobo, amountSuffix: held, next: t("On its way with {how}. When it arrives, check it, then confirm. If something's wrong, report it and the money stays held.", { how }) }
          : { chip: onItsWay, deadline: t("Sent {time}", { time: at(deal.sent_at) }), amountKobo: share, amountSuffix: held, next: t("Sent with {how}. Mark it delivered when {buyer} has it.", { how, buyer }) };
      }
      if (deal.handover === "delivery") {
        return role === "buyer"
          ? { chip, deadline: t("{seller} sends by {time}", { seller, time: at(deal.handover_due_at) }), amountKobo: paidKobo, amountSuffix: held, next: t("{seller} will send it by {time}, with photos of it packed. Check it when it arrives, before you confirm.", { seller, time: at(deal.handover_due_at) }) }
          : { chip, deadline: t("Send by {time}", { time: at(deal.handover_due_at) }), amountKobo: share, amountSuffix: held, next: t("{amount} is held for you, delivery included. Pack it, take photos as you do, and send it by {time}.", { amount: naira(share), time: at(deal.handover_due_at) }) };
      }
      return role === "buyer"
        ? { chip, deadline: t("Meet by {time}", { time: at(deal.handover_due_at) }), amountKobo: paidKobo, amountSuffix: held, next: t("Meet in a public place. Check the item, then give {seller} your code.", { seller }) }
        : { chip, deadline: t("Hand over by {time}", { time: at(deal.handover_due_at) }), amountKobo: share, amountSuffix: held, next: t("{amount} is held for you. Hand over by {time} and ask for the code.", { amount: naira(share), time: at(deal.handover_due_at) }) };
    }
    case "disputed":
      return { chip, deadline: t("Decision by {time}", { time: at(extra.decisionDue) }), amountKobo: role === "buyer" ? paidKobo : share, amountSuffix: t("frozen"),
        next: t("Add photos or notes by {evidence}. A reviewer decides by {decision}. Nobody can move the money until then.", { evidence: at(extra.evidenceDue), decision: at(extra.decisionDue) }) };
    case "released":
    case "paid_out": {
      if (role === "buyer") return { chip: { state: "released", word: t("Deal closed") }, amountKobo: share, amountSuffix: t("released to {seller}", { seller }), next: t("The deal is closed. Your rating helps other buyers decide.") };
      if (deal.state === "released") return { chip, amountKobo: share, amountSuffix: t("released"), next: extra.bankLast4
        ? t("Your payout to ••{last4} is on its way. We'll email you when it lands.", { last4: extra.bankLast4 })
        : t("Your payout is on its way. We'll email you when it lands.") };
      return { chip, amountKobo: share, amountSuffix: t("paid out"), next: extra.bankLast4
        ? t("{amount} sent to your bank account ••{last4}.", { amount: naira(share), last4: extra.bankLast4 })
        : t("{amount} sent to your bank account.", { amount: naira(share) }) };
    }
    case "refunded":
      return role === "buyer"
        ? { chip, amountKobo: paidKobo || due, amountSuffix: extra.refundWaiting ? t("to refund") : t("refunded"), next: extra.refundWaiting
          ? t("Your refund is ready to go back as {coin}. Add your address below so we can send it.", { coin: extra.paidCrypto ?? "crypto" })
          : extra.paidCrypto
          ? t("Refunded as {coin} to the address you gave, at the rate on the day.", { coin: extra.paidCrypto })
          : t("Refunded to the account you paid from. Bank transfers usually arrive within minutes.") }
        : { chip, amountKobo: share, next: t("This deal was cancelled and the buyer was refunded.") };
    case "declined": {
      // Who ended it: the buyer cancelling, the seller declining, or the clock running out.
      const by = extra.endedBy;
      if (by === "buyer") return role === "buyer"
        ? { chip: { state: "awaiting", word: t("Cancelled") }, amountKobo: due, next: t("You cancelled this request. Nothing was paid.") }
        : { chip: { state: "awaiting", word: t("Cancelled") }, amountKobo: share, next: t("{buyer} cancelled the request. Nothing was paid.", { buyer }) };
      if (by === "seller") return role === "buyer"
        ? { chip, amountKobo: due, next: t("{seller} declined. Nothing was paid.", { seller }) }
        : { chip, amountKobo: share, next: t("You declined this request. Nothing was paid.") };
      if (by === "system") return role === "buyer"
        ? { chip: { state: "awaiting", word: t("Expired") }, amountKobo: due, next: t("The request ran out of time. Nothing was paid.") }
        : { chip: { state: "awaiting", word: t("Expired") }, amountKobo: share, next: t("This request ran out of time. Nothing was paid.") };
      return role === "buyer"
        ? { chip, amountKobo: due, next: t("{seller} declined, or the time ran out. Nothing was paid.", { seller }) }
        : { chip, amountKobo: share, next: t("This request was declined or expired.") };
    }
  }
}

interface EventLike { to_state: DealState | null; at: string | Date; type: string }

export function dealSteps(deal: DealLike, role: "buyer" | "seller", names: { buyer: string; seller: string }, events: EventLike[], dispute: { created_at: string | Date; evidence_due_at: string | Date; decision_due_at: string | Date } | null, now = new Date(), t: T = en): Step[] {
  const buyer = firstName(names.buyer);
  const seller = firstName(names.seller);
  const at = (s: DealState) => events.find((e) => e.to_state === s)?.at;
  const fmt = (x: string | Date | undefined | null) => (x ? when(new Date(x), now) : undefined);
  const by = (x: string | Date | undefined | null) => t("By {time}", { time: fmt(x) ?? "" });
  const order: DealState[] = ["requested", "accepted", "held", "released", "paid_out"];
  const reached = (s: DealState) => order.indexOf(deal.state) >= order.indexOf(s) && order.includes(deal.state);
  const st = (done: boolean, isNow: boolean): Step["status"] => (done ? "done" : isNow ? "now" : "todo");
  const due = naira(deal.amount_due_kobo);
  const share = naira(deal.seller_share_kobo);

  if (deal.state === "disputed" && dispute) {
    return [
      { label: t("{amount} held", { amount: role === "buyer" ? due : share }), when: fmt(at("held")), status: "done" },
      { label: role === "buyer" ? t("You reported a problem") : t("{buyer} reported a problem", { buyer }), when: fmt(dispute.created_at), status: "done" },
      { label: t("Add photos or notes"), when: by(dispute.evidence_due_at), status: new Date(dispute.evidence_due_at) > now ? "now" : "done" },
      { label: t("A reviewer decides"), when: by(dispute.decision_due_at), status: new Date(dispute.evidence_due_at) > now ? "todo" : "now" },
    ];
  }
  const start: Step[] = [
    { label: role === "buyer" ? t("Request sent") : t("{buyer} sent a request", { buyer }), when: fmt(deal.created_at), status: "done" },
    { label: role === "buyer" ? t("{seller} accepts", { seller }) : t("You accept"), when: reached("accepted") ? fmt(at("accepted")) : deal.state === "requested" ? by(deal.request_expires_at) : undefined, status: st(reached("accepted"), deal.state === "requested") },
    { label: role === "buyer" ? t("You pay {amount} into NosHen", { amount: due }) : t("{amount} held for you", { amount: share }), when: reached("held") ? fmt(at("held")) : deal.state === "accepted" ? by(deal.payment_due_at) : undefined, status: st(reached("held"), deal.state === "accepted") },
  ];
  if (deal.handover === "delivery") {
    // Sent (with packing photos), then delivered and checked, then released.
    const held = deal.state === "held";
    const done = reached("released");
    return [
      ...start,
      { label: role === "buyer" ? t("{seller} sends it, with packing photos", { seller }) : t("Pack it, take photos, send it"), when: deal.sent_at ? fmt(deal.sent_at) : held ? by(deal.handover_due_at) : undefined, status: st(done || !!deal.sent_at, held && !deal.sent_at) },
      { label: role === "buyer" ? t("It arrives, and you check it") : t("It arrives, and {buyer} checks it", { buyer }), when: deal.delivered_at ? fmt(deal.delivered_at) : undefined, status: st(done || !!deal.delivered_at, held && !!deal.sent_at && !deal.delivered_at) },
      { label: role === "buyer" ? t("You confirm, and the money is released") : t("{buyer} confirms, and you're paid", { buyer }), when: done ? fmt(at("released")) : deal.delivered_at && held ? t("Or on its own {time}", { time: fmt(deal.release_due_at) ?? "" }) : undefined, status: st(done, held && !!deal.delivered_at) },
    ];
  }
  return [
    ...start,
    { label: role === "buyer" ? t("Meet and check the item") : t("Hand over and enter {buyer}'s code", { buyer }), when: deal.delivered_at ? fmt(deal.delivered_at) : deal.state === "held" ? by(deal.handover_due_at) : undefined, status: st(reached("released") || !!deal.delivered_at, deal.state === "held" && !deal.delivered_at) },
    { label: role === "buyer" ? t("Give {seller} your code", { seller }) : t("Payout to your bank"), when: reached("released") ? fmt(at("released")) : undefined, status: st(reached("released"), deal.state === "held" && !!deal.delivered_at) },
  ];
}
