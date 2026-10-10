import type { Db, Tx } from "../db";
import { one } from "../db";
import type { PaymentsPartner, PartnerEvent } from "../partner/types";
import type { EmailSender } from "../email";
import type { IdProvider } from "../idcheck";
import type { Settings } from "../settings";
import { loadSettings } from "../settings";
import type { DealState } from "../../shared/deal";

export type TimerKind = "request_expiry" | "payment_expiry" | "handover_due" | "delivery_release" | "evidence_close" | "partner_event";

export interface Timers {
  schedule(t: { kind: TimerKind; at: Date; dealId?: string; event?: PartnerEvent }): Promise<void>;
}

/** Everything the engine needs from the outside world, so the same code runs in the Worker and in tests. */
export interface Deps {
  db: Db;
  partner: PaymentsPartner;
  mail: EmailSender;
  ids: IdProvider;
  timers: Timers;
  secrets: { releaseCode: string; fieldKey: string };
  appUrl: string;
  now?: () => Date;
}

export const nowOf = (d: Deps) => (d.now ? d.now() : new Date());

let cached: { at: number; s: Settings } | null = null;
/** Settings, re-read at most every 5 minutes (TRD: caching). */
export async function settingsOf(d: Deps): Promise<Settings> {
  const t = Date.now();
  if (!cached || t - cached.at > 5 * 60_000) cached = { at: t, s: await loadSettings(d.db) };
  return cached.s;
}
export const resetSettingsCache = () => { cached = null; };

/** A refusal the person can act on. `code` lets screens react; `message` is shown as it is. */
export class DealError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export interface DealRow {
  id: string; listing_id: string; buyer_id: string; seller_id: string;
  price_kobo: string; fee_kobo: string; fee_payer: "buyer" | "seller";
  amount_due_kobo: string; seller_share_kobo: string;
  handover: "meetup" | "delivery"; state: DealState;
  request_expires_at: Date; payment_due_at: Date | null; handover_due_at: Date | null;
  delivered_at: Date | null; release_due_at: Date | null;
  collection_ref: string | null; collection_account_number: string | null; collection_bank_name: string | null;
  review_hold: boolean; review_hold_reason: string | null;
  created_at: Date; closed_at: Date | null;
}

/** Locks the deal row for the rest of the transaction: two actions on one deal can never interleave. */
export async function lockDeal(db: Db, dealId: string): Promise<DealRow> {
  const deal = await one<DealRow>(db, "select * from deals where id = $1 for update", [dealId]);
  if (!deal) throw new DealError("not_found", "We can't find that deal.", 404);
  return deal;
}

export const N = (v: string | number | bigint | null | undefined) => Number(v ?? 0);

/** Posts one balanced ledger transaction. The database also checks the balance at commit. */
export async function post(
  db: Db,
  dealId: string | null,
  kind: "payment_received" | "release" | "payout_sent" | "refund_due" | "refund_sent" | "fee_swept" | "adjustment",
  lines: { account: string; debit?: number; credit?: number }[],
  memo?: string,
) {
  const txn = await one<{ id: string }>(db, "insert into ledger_transactions (deal_id, kind, memo) values ($1, $2, $3) returning id", [dealId, kind, memo ?? null]);
  for (const l of lines) {
    if (!l.debit && !l.credit) continue;
    await db.query(
      "insert into ledger_entries (txn_id, account, deal_id, debit_kobo, credit_kobo) values ($1, $2, $3, $4, $5)",
      [txn!.id, l.account, dealId, l.debit ?? 0, l.credit ?? 0],
    );
  }
}

export async function amountPaid(db: Db, dealId: string): Promise<number> {
  const r = await one<{ s: string }>(db, "select coalesce(sum(amount_kobo), 0) as s from payments where deal_id = $1", [dealId]);
  return N(r?.s);
}

export async function userName(db: Db, userId: string): Promise<string> {
  const r = await one<{ full_name: string | null }>(db, "select full_name from users where id = $1", [userId]);
  return r?.full_name ?? "Someone";
}

/**
 * Tells someone about a change in their deal: an in-app notification now, and an email sent only
 * after the transaction commits, so nobody is ever told about something that didn't happen.
 * (SMS comes later, once phone numbers are collected.)
 */
export async function notify(d: Deps, tx: Tx, userId: string, dealId: string | null, template: string, text: string) {
  await tx.db.query(
    "insert into notifications (user_id, deal_id, channel, template, params, status, sent_at) values ($1, $2, 'in_app', $3, $4, 'sent', now())",
    [userId, dealId, template, JSON.stringify({ text })],
  );
  const to = await one<{ email: string | null }>(tx.db, "select email from users where id = $1", [userId]);
  if (!to?.email) return;
  const mail = await one<{ id: string }>(
    tx.db,
    "insert into notifications (user_id, deal_id, channel, template, params) values ($1, $2, 'email', $3, $4) returning id",
    [userId, dealId, template, JSON.stringify({ text })],
  );
  const link = dealId ? `\n\nOpen the deal: ${d.appUrl}/d/${dealId}` : "";
  tx.after(async () => {
    try {
      await d.mail.send({ to: to.email!, subject: `NosHen: ${subjectOf(text)}`, text: `${text}${link}\n\nNosHen never asks for your release code or sign-in code.` });
      await d.db.query("update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1", [mail!.id]);
    } catch (e) {
      await d.db.query("update notifications set status = 'failed', attempts = attempts + 1, error = $2 where id = $1", [mail!.id, String(e)]);
    }
  });
}

/** A short subject line: the first sentence of the message. */
function subjectOf(text: string) {
  const first = text.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  return first.length > 70 ? first.slice(0, 67) + "…" : first;
}

export function schedule(d: Deps, tx: Tx, kind: TimerKind, dealId: string, at: Date) {
  tx.after(() => d.timers.schedule({ kind, dealId, at }));
}
