import { inTx, many, one, type Db } from "./db";
import { hmac } from "./crypto";
import { DealError, type Deps } from "./core";
import type { StaffActor } from "./staff";

export type BlocklistKind = "bank_account" | "id_number" | "imei" | "email" | "social_handle" | "phone" | "device";

export const BLOCKLIST_KINDS: [BlocklistKind, string][] = [
  ["bank_account", "Bank account number"],
  ["id_number", "NIN or BVN"],
  ["imei", "Phone IMEI / Car VIN / Serial"],
  ["social_handle", "Social handle (@name)"],
  ["email", "Email address"],
  ["phone", "Phone number"],
];

/** Canonical normalisation before HMAC so spaces, case or '@' can never bypass the blocklist. */
export function normalizeBlockValue(kind: BlocklistKind, raw: string): string {
  const v = raw.trim();
  if (kind === "bank_account" || kind === "id_number" || kind === "phone") return v.replace(/[^\d]/g, "");
  if (kind === "imei" || kind === "device") return v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (kind === "social_handle") return v.replace(/^@+/, "").toLowerCase();
  return v.toLowerCase();
}

export async function blocklistHmac(fieldKey: string, kind: BlocklistKind, raw: string): Promise<Uint8Array> {
  const norm = normalizeBlockValue(kind, raw);
  const prefix = kind === "bank_account" ? "acct" : kind;
  return hmac(fieldKey, `${prefix}:${norm}`);
}

/** Masks sensitive identifiers for the staff UI (e.g. bank accounts / NIN show only the last 4 digits). */
export function maskBlockLabel(kind: BlocklistKind, raw: string): string {
  const norm = normalizeBlockValue(kind, raw);
  if (kind === "bank_account") return `Bank ••${norm.slice(-4)}`;
  if (kind === "id_number") return `ID ••${norm.slice(-4)}`;
  if (kind === "imei" || kind === "device") return `${norm.slice(0, 3)}…${norm.slice(-4)}`;
  if (kind === "social_handle") return `@${norm}`;
  if (kind === "email") {
    const [u, dom] = norm.split("@");
    return dom ? `${u.slice(0, 2)}••@${dom}` : norm;
  }
  return norm.length > 6 ? `••${norm.slice(-4)}` : norm;
}

/** True when this identifier is actively on NosHen's scammer/stolen-device blocklist. */
export async function isBlocked(d: Deps, kind: BlocklistKind, raw: string): Promise<boolean> {
  const norm = normalizeBlockValue(kind, raw);
  if (!norm) return false;
  const h = await blocklistHmac(d.secrets.fieldKey, kind, norm);
  const row = await one(d.db, "select 1 from blocklist where kind = $1 and value_hmac = $2 and removed_at is null", [kind, h]);
  return !!row;
}

export interface BlocklistRow {
  id: string;
  kind: BlocklistKind;
  label: string | null;
  reason: string;
  added_by_name: string | null;
  at: Date;
}

export async function listBlocklist(db: Db): Promise<BlocklistRow[]> {
  return many<BlocklistRow>(
    db,
    `select b.id, b.kind, b.label, b.reason, s.name as added_by_name, b.at
       from blocklist b left join staff s on s.id = b.added_by
      where b.removed_at is null
      order by b.at desc limit 200`,
  );
}

/** Staff adds an identifier to the blocklist (idempotent if already blocked). Logged to staff_actions. */
export async function addBlocklistEntry(
  d: Deps,
  staff: StaffActor,
  input: { kind: BlocklistKind; value: string; label?: string; reason: string },
): Promise<string> {
  const why = input.reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters.");
  if (!BLOCKLIST_KINDS.some(([k]) => k === input.kind) && input.kind !== "device") {
    throw new DealError("kind", "Choose a valid identifier type.");
  }
  const norm = normalizeBlockValue(input.kind, input.value);
  if (norm.length < 3) throw new DealError("value", "Enter the full value to block.");
  const h = await blocklistHmac(d.secrets.fieldKey, input.kind, norm);
  const label = input.label?.trim().slice(0, 80) || maskBlockLabel(input.kind, norm);

  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const existing = await one<{ id: string }>(
      tx.db,
      "select id from blocklist where kind = $1 and value_hmac = $2 and removed_at is null",
      [input.kind, h],
    );
    if (existing) return existing.id;
    const row = await one<{ id: string }>(
      tx.db,
      "insert into blocklist (kind, value_hmac, label, reason, added_by) values ($1, $2, $3, $4, $5) returning id",
      [input.kind, h, label, why, staff.id],
    );
    await tx.db.query(
      "insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, 'blocklist_add', 'blocklist', $2, $3, $4)",
      [staff.id, row!.id, why, JSON.stringify({ kind: input.kind, label })],
    );
    return row!.id;
  });
}

/** Admin removes an entry from the active blocklist (soft delete so audit trail stays intact). */
export async function removeBlocklistEntry(d: Deps, staff: StaffActor, id: string, reason: string) {
  if (staff.role !== "admin") throw new DealError("forbidden", "Only an admin can remove a blocklist entry.", 403);
  const why = reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters.");
  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const r = await tx.db.query("update blocklist set removed_at = now() where id = $1 and removed_at is null returning id, kind, label", [id]);
    if (!r.rowCount) throw new DealError("not_found", "That blocklist entry wasn't found.", 404);
    await tx.db.query(
      "insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, 'blocklist_remove', 'blocklist', $2, $3, $4)",
      [staff.id, id, why, JSON.stringify({ kind: r.rows[0].kind, label: r.rows[0].label })],
    );
  });
}

/**
 * When an admin bans a scammer, blocklist all their known identifiers (email, payout bank account HMACs,
 * social handles, and device IMEIs/VINs) so they cannot re-register with a new Gmail account.
 */
export async function blocklistUserAssets(d: Deps, staff: StaffActor, userId: string, reason: string): Promise<number> {
  if (staff.role !== "admin") throw new DealError("forbidden", "Only an admin can blocklist a person's identifiers.", 403);
  const why = reason.trim();
  if (why.length < 5) throw new DealError("reason", "Write a reason of at least 5 characters.");

  return inTx(d.db, { type: "staff", id: staff.id }, async (tx) => {
    const user = await one<{ email: string | null }>(tx.db, "select email from users where id = $1", [userId]);
    const banks = await many<{ account_number_hmac: Uint8Array; account_last4: string }>(
      tx.db,
      "select account_number_hmac, account_last4 from bank_accounts where user_id = $1",
      [userId],
    );
    const handles = await many<{ handle: string }>(
      tx.db,
      "select handle from social_handles where user_id = $1 and status <> 'removed'",
      [userId],
    );
    const devices = await many<{ imei_or_serial: string }>(
      tx.db,
      "select distinct imei_or_serial from listings where seller_id = $1 and imei_or_serial is not null",
      [userId],
    );

    let added = 0;
    const insertRaw = async (kind: BlocklistKind, h: Uint8Array, label: string) => {
      const r = await tx.db.query(
        `insert into blocklist (kind, value_hmac, label, reason, added_by)
         values ($1, $2, $3, $4, $5)
         on conflict (kind, value_hmac) where removed_at is null do nothing`,
        [kind, h, label, why, staff.id],
      );
      if (r.rowCount) added++;
    };

    if (user?.email) {
      await insertRaw("email", await blocklistHmac(d.secrets.fieldKey, "email", user.email), maskBlockLabel("email", user.email));
    }
    for (const b of banks) {
      await insertRaw("bank_account", b.account_number_hmac, `Bank ••${b.account_last4}`);
    }
    for (const sh of handles) {
      await insertRaw("social_handle", await blocklistHmac(d.secrets.fieldKey, "social_handle", sh.handle), maskBlockLabel("social_handle", sh.handle));
    }
    for (const dev of devices) {
      await insertRaw("imei", await blocklistHmac(d.secrets.fieldKey, "imei", dev.imei_or_serial), maskBlockLabel("imei", dev.imei_or_serial));
    }

    await tx.db.query(
      "insert into staff_actions (staff_id, action, target_type, target_id, reason, payload) values ($1, 'blocklist_user_assets', 'user', $2, $3, $4)",
      [staff.id, userId, why, JSON.stringify({ added })],
    );
    return added;
  });
}
