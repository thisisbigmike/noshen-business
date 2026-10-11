// What the deal page says to each person in each state (docs: app-flow.md, "The deal page by state").
import type { DealState } from "@noshen/shared/deal";
import { STATUS, firstName } from "@noshen/shared/deal";
import { naira } from "@noshen/shared/money";
import { when } from "@noshen/shared/time";
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

const d = (x: string | Date | null | undefined) => (x ? new Date(x) : null);

export function dealText(deal: DealLike, role: "buyer" | "seller", names: { buyer: string; seller: string }, paidKobo: number, extra: { decisionDue?: string | Date | null; evidenceDue?: string | Date | null; bankLast4?: string | null; endedBy?: "buyer" | "seller" | "system" | null; paidCrypto?: string | null } = {}, now = new Date()): DealText {
  const buyer = firstName(names.buyer);
  const seller = firstName(names.seller);
  const due = Number(deal.amount_due_kobo);
  const share = Number(deal.seller_share_kobo);
  const mine = role === "buyer" ? due : share;
  const chip = { ...STATUS[deal.state] };
  const t = (x: string | Date | null) => (x ? when(new Date(x), now) : "");

  switch (deal.state) {
    case "requested":
      return role === "buyer"
        ? { chip, deadline: `Accept by ${t(deal.request_expires_at)}`, amountKobo: due, next: `${seller} has until ${t(deal.request_expires_at)} to accept. You pay nothing until ${seller} accepts.` }
        : { chip: { state: "awaiting", word: "New request" }, deadline: `Answer by ${t(deal.request_expires_at)}`, amountKobo: share, next: `${buyer} wants to buy this with protection. Accept or decline by ${t(deal.request_expires_at)}.` };
    case "accepted":
      return role === "buyer"
        ? { chip, deadline: `Pay by ${t(deal.payment_due_at)}`, amountKobo: due, next: `Pay ${naira(due)} into NosHen by ${t(deal.payment_due_at)}. We hold it until you have the item.` }
        : { chip, deadline: `Pay by ${t(deal.payment_due_at)}`, amountKobo: share, next: `Waiting for ${buyer} to pay. Don't hand anything over until NosHen shows the money as held.` };
    case "held": {
      if (deal.review_hold) {
        return role === "buyer"
          ? { chip, amountKobo: paidKobo, amountSuffix: "held", next: "We're checking your payment and will email you. Don't meet yet." }
          : { chip, amountKobo: share, amountSuffix: "held", next: "NosHen is checking this payment. Don't hand over yet." };
      }
      if (deal.handover === "delivery" && deal.delivered_at) {
        return role === "buyer"
          ? { chip, deadline: `Confirm by ${t(deal.release_due_at)}`, amountKobo: paidKobo, amountSuffix: "held", next: `Check the item. Confirm or report a problem by ${t(deal.release_due_at)}, or the money goes to ${seller}.` }
          : { chip, deadline: `Release ${t(deal.release_due_at)}`, amountKobo: share, amountSuffix: "held", next: `Waiting for ${buyer} to confirm, until ${t(deal.release_due_at)}.` };
      }
      if (deal.handover === "delivery") {
        return role === "buyer"
          ? { chip, deadline: `Delivery by ${t(deal.handover_due_at)}`, amountKobo: paidKobo, amountSuffix: "held", next: `${seller} will send it by ${t(deal.handover_due_at)}. Check it when it arrives, before you confirm.` }
          : { chip, deadline: `Send by ${t(deal.handover_due_at)}`, amountKobo: share, amountSuffix: "held", next: `${naira(share)} is held for you. Send it by ${t(deal.handover_due_at)}, then mark it delivered.` };
      }
      return role === "buyer"
        ? { chip, deadline: `Meet by ${t(deal.handover_due_at)}`, amountKobo: paidKobo, amountSuffix: "held", next: `Meet in a public place. Check the item, then give ${seller} your code.` }
        : { chip, deadline: `Hand over by ${t(deal.handover_due_at)}`, amountKobo: share, amountSuffix: "held", next: `${naira(share)} is held for you. Hand over by ${t(deal.handover_due_at)} and ask for the code.` };
    }
    case "disputed":
      return { chip, deadline: `Decision by ${t(extra.decisionDue ?? null)}`, amountKobo: role === "buyer" ? paidKobo : share, amountSuffix: "frozen",
        next: `Add photos or notes by ${t(extra.evidenceDue ?? null)}. A reviewer decides by ${t(extra.decisionDue ?? null)}. Nobody can move the money until then.` };
    case "released":
      return role === "buyer"
        ? { chip: { state: "released", word: "Deal closed" }, amountKobo: share, amountSuffix: `released to ${seller}`, next: "The deal is closed. Your rating helps other buyers decide." }
        : { chip, amountKobo: share, amountSuffix: "released", next: `Your payout${extra.bankLast4 ? ` to ••${extra.bankLast4}` : ""} is on its way. We'll email you when it lands.` };
    case "paid_out":
      return role === "buyer"
        ? { chip: { state: "released", word: "Deal closed" }, amountKobo: share, amountSuffix: `released to ${seller}`, next: "The deal is closed. Your rating helps other buyers decide." }
        : { chip, amountKobo: share, amountSuffix: "paid out", next: `${naira(share)} sent to your bank account${extra.bankLast4 ? ` ••${extra.bankLast4}` : ""}.` };
    case "refunded":
      return role === "buyer"
        ? { chip, amountKobo: paidKobo || due, amountSuffix: "refunded", next: extra.paidCrypto
          ? `Refunded as ${extra.paidCrypto} to the address you gave, at the rate on the day.`
          : "Refunded to the account you paid from. Bank transfers usually arrive within minutes." }
        : { chip, amountKobo: share, next: "This deal was cancelled and the buyer was refunded." };
    case "declined": {
      // Who ended it: the buyer cancelling, the seller declining, or the clock running out.
      const by = extra.endedBy;
      if (by === "buyer") return role === "buyer"
        ? { chip: { state: "awaiting", word: "Cancelled" }, amountKobo: due, next: "You cancelled this request. Nothing was paid." }
        : { chip: { state: "awaiting", word: "Cancelled" }, amountKobo: share, next: `${buyer} cancelled the request. Nothing was paid.` };
      if (by === "seller") return role === "buyer"
        ? { chip, amountKobo: due, next: `${seller} declined. Nothing was paid.` }
        : { chip, amountKobo: share, next: "You declined this request. Nothing was paid." };
      if (by === "system") return role === "buyer"
        ? { chip: { state: "awaiting", word: "Expired" }, amountKobo: due, next: "The request ran out of time. Nothing was paid." }
        : { chip: { state: "awaiting", word: "Expired" }, amountKobo: share, next: "This request ran out of time. Nothing was paid." };
      return role === "buyer"
        ? { chip, amountKobo: due, next: `${seller} declined, or the time ran out. Nothing was paid.` }
        : { chip, amountKobo: share, next: "This request was declined or expired." };
    }
  }
}

interface EventLike { to_state: DealState | null; at: string | Date; type: string }

export function dealSteps(deal: DealLike, role: "buyer" | "seller", names: { buyer: string; seller: string }, events: EventLike[], dispute: { created_at: string | Date; evidence_due_at: string | Date; decision_due_at: string | Date } | null, now = new Date()): Step[] {
  const buyer = firstName(names.buyer);
  const seller = firstName(names.seller);
  const at = (s: DealState) => events.find((e) => e.to_state === s)?.at;
  const fmt = (x: string | Date | undefined | null) => (x ? when(new Date(x), now) : undefined);
  const order: DealState[] = ["requested", "accepted", "held", "released", "paid_out"];
  const reached = (s: DealState) => order.indexOf(deal.state) >= order.indexOf(s) && order.includes(deal.state);
  const st = (done: boolean, isNow: boolean): Step["status"] => (done ? "done" : isNow ? "now" : "todo");
  const due = naira(deal.amount_due_kobo);
  const share = naira(deal.seller_share_kobo);

  if (deal.state === "disputed" && dispute) {
    return [
      { label: `${role === "buyer" ? due : share} held`, when: fmt(at("held")), status: "done" },
      { label: role === "buyer" ? "You reported a problem" : `${buyer} reported a problem`, when: fmt(dispute.created_at), status: "done" },
      { label: "Add photos or notes", when: `By ${fmt(dispute.evidence_due_at)}`, status: new Date(dispute.evidence_due_at) > now ? "now" : "done" },
      { label: "A reviewer decides", when: `By ${fmt(dispute.decision_due_at)}`, status: new Date(dispute.evidence_due_at) > now ? "todo" : "now" },
    ];
  }
  const handoverLabel = deal.handover === "delivery"
    ? (role === "buyer" ? `${seller} sends it; you check it` : `Send it and mark it delivered`)
    : (role === "buyer" ? "Meet and check the item" : `Hand over and enter ${buyer}'s code`);
  const releaseLabel = deal.handover === "delivery"
    ? (role === "buyer" ? "You confirm, and the money is released" : `${buyer} confirms, and you're paid`)
    : (role === "buyer" ? `Give ${seller} your code` : "Payout to your bank");
  return [
    { label: role === "buyer" ? "Request sent" : `${buyer} sent a request`, when: fmt(deal.created_at), status: "done" },
    { label: role === "buyer" ? `${seller} accepts` : "You accept", when: reached("accepted") ? fmt(at("accepted")) : deal.state === "requested" ? `By ${fmt(deal.request_expires_at)}` : undefined, status: st(reached("accepted"), deal.state === "requested") },
    { label: role === "buyer" ? `You pay ${due} into NosHen` : `${share} held for you`, when: reached("held") ? fmt(at("held")) : deal.state === "accepted" ? `By ${fmt(deal.payment_due_at)}` : undefined, status: st(reached("held"), deal.state === "accepted") },
    { label: handoverLabel, when: deal.delivered_at ? fmt(deal.delivered_at) : deal.state === "held" ? `By ${fmt(deal.handover_due_at)}` : undefined, status: st(reached("released") || !!deal.delivered_at, deal.state === "held" && !deal.delivered_at) },
    { label: releaseLabel, when: reached("released") ? fmt(at("released")) : undefined, status: st(reached("released"), deal.state === "held" && !!deal.delivered_at) },
  ];
}
