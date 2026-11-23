// "Check a seller": sellers add their social handles; each shows to buyers only once NosHen staff have seen the
// seller's code in that profile's bio. Buyers look a handle up and see the seller's NosHen track record, or are told
// no verified seller has it.
import { inTx, many, one } from "./db";
import { type Deps, DealError, notify } from "./core";
import { alertStaff } from "./staff-alerts";
import { sellerSummary, type SellerSummary } from "./queries";
import type { StaffActor } from "./staff";
import { handleProblem, isPlatform, parseHandle, platformOf, type Platform } from "@noshen/shared/social";
import { isBlocked } from "./blocklist";

export type HandleStatus = "added" | "submitted" | "verified" | "rejected" | "removed";
export interface HandleRow { id: string; platform: Platform; handle: string; code: string; status: HandleStatus; reject_reason: string | null; created_at: Date }

/** Letters and digits that can't be mistaken for each other (no 0/O, 1/I/L). */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => "NOSHEN-" + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

/** A seller's handles, newest first (removed ones left out). */
export const myHandles = (db: Deps["db"], userId: string) => many<HandleRow>(db,
  "select id, platform, handle, code, status, reject_reason, created_at from social_handles where user_id = $1 and status <> 'removed' order by created_at desc", [userId]);

/** A seller's verified handles, for their shop. */
export const verifiedHandles = (db: Deps["db"], userId: string) => many<{ platform: Platform; handle: string }>(db,
  "select platform, handle from social_handles where user_id = $1 and status = 'verified' order by platform", [userId]);

/**
 * Adds a handle and gives the seller a code to put in that profile's bio. Only sellers who've passed the ID check
 * can add one, so every verified handle leads to a real person. Adding one already listed returns it.
 */
export async function addHandle(d: Deps, userId: string, platform: string, raw: string): Promise<HandleRow> {
  if (!isPlatform(platform)) throw new DealError("platform", "Choose where you sell: Instagram, TikTok, Facebook or X.");
  const parsed = parseHandle(raw);
  const handle = parsed?.handle ?? "";
  if (parsed?.platform && parsed.platform !== platform) throw new DealError("handle", `That's a ${platformOf(parsed.platform).label} link. Choose ${platformOf(parsed.platform).label}, or paste your ${platformOf(platform).label} name.`);
  const wrong = handleProblem(platform, handle);
  if (wrong) throw new DealError("handle", wrong);
  if (await isBlocked(d, "social_handle", handle)) {
    throw new DealError("blocked", "This social handle can't be verified on NosHen. Contact support if you think this is a mistake.", 403);
  }
  const id = await one(d.db, "select 1 from kyc_checks where user_id = $1 and result = 'verified'", [userId]);
  if (!id) throw new DealError("id_first", "Verify your ID first. Then buyers who check your handle know it leads to a real person.");
  const taken = await one(d.db, "select user_id from social_handles where platform = $1 and handle = $2 and status = 'verified'", [platform, handle]);
  if (taken && taken.user_id !== userId) throw new DealError("taken", "This handle is already verified for another NosHen seller. If it's yours, contact NosHen.");
  const mine = await one<HandleRow>(d.db,
    "select id, platform, handle, code, status, reject_reason, created_at from social_handles where user_id = $1 and platform = $2 and handle = $3 and status <> 'removed'", [userId, platform, handle]);
  if (mine) return mine;
  const count = await one<{ n: string }>(d.db, "select count(*) as n from social_handles where user_id = $1 and status <> 'removed'", [userId]);
  if (Number(count?.n) >= 8) throw new DealError("too_many", "You can list up to 8 handles. Remove one to add another.");
  return (await one<HandleRow>(d.db,
    `insert into social_handles (user_id, platform, handle, code) values ($1, $2, $3, $4)
     returning id, platform, handle, code, status, reject_reason, created_at`, [userId, platform, handle, newCode()]))!;
}

/**
 * Applies an automated bio-check result to a submitted handle. Returns:
 * - "verified": exact code found in the profile's bio; handle is now live and competing claims rejected.
 * - "not_found": profile was read cleanly, but the code wasn't in the bio yet; seller is told to retry.
 * - "queued": upstream API couldn't read the profile; kept in the manual staff queue as a fallback.
 */
async function applyAutoCheck(d: Deps, h: { id: string; user_id: string; platform: Platform; handle: string; code: string }): Promise<"verified" | "not_found" | "queued"> {
  if (!d.social) return "queued";
  const check = await d.social.checkBio(h.platform, h.handle, h.code);
  if (check.status === "unavailable") return "queued";

  const label = `${platformOf(h.platform).label} @${h.handle}`;
  if (check.status === "matched") {
    return inTx(d.db, { type: "system" }, async (tx) => {
      const cur = await one<HandleRow & { user_id: string }>(tx.db, "select * from social_handles where id = $1 for update", [h.id]);
      if (!cur || cur.status === "verified") return "verified" as const;
      if (cur.status !== "submitted") return "queued" as const;
      const taken = await one(tx.db, "select 1 from social_handles where platform = $1 and handle = $2 and status = 'verified'", [cur.platform, cur.handle]);
      if (taken) {
        await tx.db.query("update social_handles set status = 'rejected', checked_at = now(), reject_reason = 'Verified for another seller.' where id = $1", [h.id]);
        await notify(d, tx, cur.user_id, null, "handle_rejected", `We couldn't verify ${label} for you: it's verified for another NosHen seller. If it's yours, contact NosHen.`);
        return "not_found" as const;
      }
      await tx.db.query("update social_handles set status = 'verified', checked_at = now(), reject_reason = null where id = $1", [h.id]);
      const others = await tx.db.query(
        `update social_handles set status = 'rejected', checked_at = now(), reject_reason = 'Verified for another seller.'
          where platform = $1 and handle = $2 and status in ('added', 'submitted') and id <> $3 returning user_id`,
        [cur.platform, cur.handle, h.id],
      );
      for (const o of others.rows as { user_id: string }[]) {
        await notify(d, tx, o.user_id, null, "handle_rejected", `We couldn't verify ${label} for you: it's verified for another NosHen seller. If it's yours, contact NosHen.`);
      }
      await notify(d, tx, cur.user_id, null, "handle_verified", `${label} is verified. Buyers who check it on NosHen now see your track record. You can take the code out of your bio.`);
      return "verified" as const;
    });
  }

  // Profile was read successfully, but the code isn't in the bio yet.
  const reason = `We checked ${label} just now and didn't see ${h.code} in the bio yet. Save your bio (make sure the account is public) and check again.`;
  await inTx(d.db, { type: "system" }, async (tx) => {
    const cur = await one<HandleRow & { user_id: string }>(tx.db, "select * from social_handles where id = $1 for update", [h.id]);
    if (!cur || cur.status !== "submitted") return;
    await tx.db.query("update social_handles set status = 'rejected', checked_at = now(), reject_reason = $2 where id = $1", [h.id, reason.slice(0, 300)]);
  });
  return "not_found";
}

/**
 * The seller says the code is in their bio. When automated bio checking (ScrapeCreators) is configured,
 * NosHen checks the profile immediately (~1–2s); if the platform can't be read, it falls back to the manual staff queue.
 */
export async function submitHandle(d: Deps, userId: string, id: string) {
  const row = await inTx(d.db, { type: "seller", id: userId }, async (tx) => {
    const h = await one<HandleRow & { user_id: string }>(tx.db, "select * from social_handles where id = $1 for update", [id]);
    if (!h || h.user_id !== userId) throw new DealError("forbidden", "This handle isn't yours.", 403);
    if (h.status === "verified") return null;
    if (h.status !== "added" && h.status !== "rejected") throw new DealError("state", "We're already checking this handle.");
    await tx.db.query("update social_handles set status = 'submitted', submitted_at = now(), reject_reason = null where id = $1", [id]);
    if (!d.social) {
      await alertStaff(d, tx, "handle_check", `Handle to check: @${h.handle}`, `Look for ${h.code} in the ${platformOf(h.platform).label} bio.`, "/handles");
    }
    return h;
  });
  if (!row || !d.social) return;

  const outcome = await applyAutoCheck(d, row);
  if (outcome === "queued") {
    await inTx(d.db, { type: "system" }, async (tx) => {
      await alertStaff(d, tx, "handle_check", `Handle to check: @${row.handle}`, `Auto-check couldn't read the profile. Look for ${row.code} in the ${platformOf(row.platform).label} bio.`, "/handles");
    });
  }
}

/** Runs an automated bio check on one submitted handle (for staff or scheduled sweeps). */
export async function autoCheckHandle(d: Deps, id: string): Promise<"verified" | "not_found" | "queued"> {
  if (!d.social) return "queued";
  const h = await one<HandleRow & { user_id: string }>(d.db, "select * from social_handles where id = $1 and status = 'submitted'", [id]);
  if (!h) return "queued";
  return applyAutoCheck(d, h);
}

/** Checks pending submitted handles in the background (runs on the scheduled sweep). */
export async function sweepPendingHandles(d: Deps, limit = 10): Promise<string[]> {
  if (!d.social) return [];
  const rows = await many<HandleRow & { user_id: string }>(d.db,
    "select * from social_handles where status = 'submitted' order by submitted_at asc limit $1", [limit]);
  const done: string[] = [];
  for (const h of rows) {
    const out = await applyAutoCheck(d, h);
    if (out !== "queued") done.push(`handle ${h.platform}/@${h.handle}: ${out}`);
  }
  return done;
}

/** The seller takes a handle off: buyers no longer find them by it. */
export async function removeHandle(d: Deps, userId: string, id: string) {
  const r = await d.db.query("update social_handles set status = 'removed' where id = $1 and user_id = $2 and status <> 'removed'", [id, userId]);
  if (!r.rowCount) throw new DealError("forbidden", "This handle isn't yours.", 403);
}

export interface CheckResult {
  /** The handle looked up, cleaned up, and the platform when the buyer pasted a profile link. */
  query: { platform: Platform | null; handle: string } | null;
  /** Verified sellers with that handle (normally one; the same name on two platforms can be two people). */
  matches: { platform: Platform; handle: string; seller: SellerSummary }[];
}

/** "Check a seller": who on NosHen has this handle, verified. Sellers who can't sell right now aren't shown. */
export async function checkSeller(db: Deps["db"], raw: string): Promise<CheckResult> {
  const query = parseHandle(raw);
  if (!query) return { query: null, matches: [] };
  const rows = await many<{ platform: Platform; handle: string; user_id: string }>(db,
    `select h.platform, h.handle, h.user_id from social_handles h join users u on u.id = h.user_id
      where h.handle = $1 and h.status = 'verified' and u.status = 'active' and ($2::text is null or h.platform = $2)
      order by h.platform`, [query.handle, query.platform]);
  return { query, matches: await Promise.all(rows.map(async (r) => ({ platform: r.platform, handle: r.handle, seller: await sellerSummary(db, r.user_id) }))) };
}

/** For staff: handles waiting to be checked, oldest first. */
export const handlesToCheck = (db: Deps["db"]) => many(db,
  `select h.id, h.platform, h.handle, h.code, h.submitted_at, u.id as user_id, u.full_name, u.email
     from social_handles h join users u on u.id = h.user_id where h.status = 'submitted' order by h.submitted_at limit 200`);

/**
 * Staff decide a handle: they saw the code in the profile's bio (verified), or didn't (rejected, with the reason the
 * seller is shown). Verifying one turns away anyone else's claim to the same handle. Kept in the audit log.
 */
export async function decideHandle(d: Deps, staff: StaffActor, id: string, verified: boolean, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters. It's kept in the audit log.");
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const h = await one<HandleRow & { user_id: string }>(tx.db, "select * from social_handles where id = $1 for update", [id]);
    if (!h) throw new DealError("not_found", "That handle isn't there any more.", 404);
    if (h.status !== "submitted") throw new DealError("state", "This handle isn't waiting to be checked.");
    const label = `${platformOf(h.platform).label} @${h.handle}`;
    if (verified) {
      const taken = await one(tx.db, "select 1 from social_handles where platform = $1 and handle = $2 and status = 'verified'", [h.platform, h.handle]);
      if (taken) throw new DealError("taken", "This handle is already verified for another seller.");
      await tx.db.query("update social_handles set status = 'verified', checked_at = now(), checked_by = $2, reject_reason = null where id = $1", [id, staff.id]);
      const others = await tx.db.query(
        `update social_handles set status = 'rejected', checked_at = now(), checked_by = $3, reject_reason = 'Verified for another seller.'
          where platform = $1 and handle = $2 and status in ('added', 'submitted') and id <> $4 returning user_id`, [h.platform, h.handle, staff.id, id]);
      for (const o of others.rows as { user_id: string }[]) {
        await notify(d, tx, o.user_id, null, "handle_rejected", `We couldn't verify ${label} for you: it's verified for another NosHen seller. If it's yours, contact NosHen.`);
      }
      await notify(d, tx, h.user_id, null, "handle_verified", `${label} is verified. Buyers who check it on NosHen now see your track record. You can take the code out of your bio.`);
    } else {
      await tx.db.query("update social_handles set status = 'rejected', checked_at = now(), checked_by = $2, reject_reason = $3 where id = $1", [id, staff.id, why.slice(0, 300)]);
      await notify(d, tx, h.user_id, null, "handle_rejected", `We couldn't verify ${label}: ${why} Put ${h.code} in your bio and send it again.`);
    }
    await tx.db.query("insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, $2, 'user', $3, $4, $5)",
      [staff.id, verified ? "verify_handle" : "reject_handle", h.user_id, why, JSON.stringify({ platform: h.platform, handle: h.handle })]);
  });
}
