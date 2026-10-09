import type { Db } from "./db";
import { DEFAULT_FEE, type FeeRule } from "../shared/money";

export interface Settings {
  deal_min_kobo: number;
  deal_max_kobo: number;
  fee: FeeRule;
  request_ttl_hours: number;
  payment_ttl_hours: number;
  handover_window_hours: number;
  delivery_confirm_hours: number;
  evidence_window_hours: number;
  dispute_decision_hours: number;
  release_code: { digits: number; max_attempts: number; lock_minutes: number };
  new_seller: { deals: number; max_deal_kobo: number };
  buyer_id_required_above_kobo: number;
}

const DEFAULTS: Settings = {
  deal_min_kobo: 2_000_000,
  deal_max_kobo: 200_000_000,
  fee: DEFAULT_FEE,
  request_ttl_hours: 12,
  payment_ttl_hours: 24,
  handover_window_hours: 72,
  delivery_confirm_hours: 24,
  evidence_window_hours: 24,
  dispute_decision_hours: 72,
  release_code: { digits: 6, max_attempts: 5, lock_minutes: 30 },
  new_seller: { deals: 3, max_deal_kobo: 30_000_000 },
  buyer_id_required_above_kobo: 50_000_000,
};

/** Deal rules from the settings table, falling back to the PRD's values. */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = (await db.query("select key, value from settings")).rows as { key: keyof Settings; value: unknown }[];
  const s: any = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) s[r.key] = r.value;
  return s as Settings;
}
