import type { Tx } from "./db";
import type { Deps } from "./core";
import { sendPush } from "./push";

export type StaffAlertKind = "dispute" | "dispute_ready" | "review_hold" | "payout_failed" | "code_locked" | "listing_check" | "unmatched_payment";

/**
 * Tells NosHen staff something needs a reviewer: written to the outbox in the same transaction (so it's never
 * lost or sent for something that didn't happen), then sent once it commits. `url` is a staff-site page.
 */
export async function alertStaff(d: Deps, tx: Tx, kind: StaffAlertKind, title: string, body: string, url: string) {
  await tx.db.query("insert into staff_alerts (kind, title, body, url) values ($1, $2, $3, $4)",
    [kind, title.slice(0, 120), body.slice(0, 300), url]);
  const flush = d.staffAlerts;
  if (flush) tx.after(() => flush(d).catch((e) => console.error("staff alerts", e)));
}

/**
 * Sends every unsent staff alert to every active staff member's devices, oldest first, and marks them sent.
 * Runs on the staff site (it alone can read staff devices). Safe to run twice at once: each alert is taken once.
 */
export async function flushStaffAlerts(d: Deps) {
  if (!d.push) return 0;
  const push = d.push;
  await d.db.query("begin");
  try {
    const alerts = (await d.db.query(
      "select id, kind, title, body, url from staff_alerts where sent_at is null order by id limit 25 for update skip locked")).rows as
      { id: string; kind: string; title: string; body: string; url: string }[];
    if (!alerts.length) { await d.db.query("commit"); return 0; }
    await d.db.query("update staff_alerts set sent_at = now() where id = any($1::bigint[])", [alerts.map((a) => a.id)]);
    await d.db.query("commit");
    const devices = (await d.db.query(
      `select p.id, p.endpoint, p.p256dh, p.auth from staff_push_subscriptions p join staff s on s.id = p.staff_id where s.status = 'active'`)).rows as
      { id: string; endpoint: string; p256dh: string; auth: string }[];
    for (const a of alerts) {
      await Promise.all(devices.map(async (dev) => {
        const r = await sendPush(push, dev, { title: a.title, body: a.body, url: a.url, tag: `${a.kind}-${a.id}` }).catch(() => "failed" as const);
        if (r === "gone") await d.db.query("delete from staff_push_subscriptions where id = $1", [dev.id]);
        else if (r === "sent") await d.db.query("update staff_push_subscriptions set last_sent_at = now(), failures = 0 where id = $1", [dev.id]);
        else await d.db.query("update staff_push_subscriptions set failures = failures + 1 where id = $1", [dev.id]);
      }));
    }
    return alerts.length;
  } catch (e) {
    await d.db.query("rollback").catch(() => {});
    throw e;
  }
}
