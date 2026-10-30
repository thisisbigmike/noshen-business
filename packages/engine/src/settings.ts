import type { Db } from "./db";
import { DEFAULT_FEE, naira, type FeeRule } from "@noshen/shared/money";
import { QUOTE_MINUTES } from "@noshen/shared/payments";

export interface Settings {
  deal_min_kobo: number;
  /** The top price of a deal, or null for no top price. */
  deal_max_kobo: number | null;
  fee: FeeRule;
  request_ttl_hours: number;
  payment_ttl_hours: number;
  handover_window_hours: number;
  delivery_confirm_hours: number;
  /** How long a delivery may be on its way, by zone, before both people are asked whether it has arrived. */
  delivery_transit_hours: { local: number; other: number };
  /** How long a buyer has to release a stage of a job the seller marked done, before it's released by itself. */
  stage_confirm_hours: number;
  evidence_window_hours: number;
  dispute_decision_hours: number;
  release_code: { digits: number; max_attempts: number; lock_minutes: number };
  /** The most a seller who hasn't passed the ID and bank checks can take in one deal. */
  unverified_seller_max_kobo: number;
  buyer_id_required_above_kobo: number;
  /** NosHen's WhatsApp number for help while selling, in international form (2348012345678), or null to hide the link. */
  support_whatsapp: string | null;
  /** Whether the NosHen assistant (the Telegram bot) may act for linked accounts at all. Staff switch it off here. */
  agent_enabled: boolean;
}

export const DEFAULTS: Settings = {
  deal_min_kobo: 500_000,
  deal_max_kobo: null,
  fee: DEFAULT_FEE,
  request_ttl_hours: 12,
  payment_ttl_hours: 24,
  handover_window_hours: 72,
  delivery_confirm_hours: 24,
  delivery_transit_hours: { local: 48, other: 120 },
  stage_confirm_hours: 72,
  evidence_window_hours: 24,
  dispute_decision_hours: 72,
  release_code: { digits: 6, max_attempts: 5, lock_minutes: 30 },
  unverified_seller_max_kobo: 30_000_000,
  buyer_id_required_above_kobo: 50_000_000,
  support_whatsapp: null,
  agent_enabled: true,
};

/** Deal rules from the settings table, falling back to the PRD's values. */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = (await db.query("select key, value from settings")).rows as { key: keyof Settings; value: unknown }[];
  const s: any = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) s[r.key] = r.value;
  return s as Settings;
}

/**
 * The numbers the legal and help pages quote ({{fee_min}}, {{payment_hours}} and so on), from the deal rules,
 * so the pages and the commerce agent never disagree with the app.
 */
export function legalVars(s: Settings): Record<string, string> {
  return {
    deal_min: naira(s.deal_min_kobo),
    deal_top: s.deal_max_kobo === null ? "there's no top price" : `the top price is ${naira(s.deal_max_kobo)}`,
    fee_percent: String(s.fee.percent), fee_min: naira(s.fee.min_kobo), fee_max: naira(s.fee.max_kobo),
    request_hours: String(s.request_ttl_hours), payment_hours: String(s.payment_ttl_hours),
    handover_hours: String(s.handover_window_hours), delivery_hours: String(s.delivery_confirm_hours),
    evidence_hours: String(s.evidence_window_hours), decision_hours: String(s.dispute_decision_hours), stage_hours: String(s.stage_confirm_hours),
    code_attempts: String(s.release_code.max_attempts), code_lock_minutes: String(s.release_code.lock_minutes),
    unverified_seller_max: naira(s.unverified_seller_max_kobo),
    buyer_id_above: naira(s.buyer_id_required_above_kobo),
    usdt_quote_minutes: String(QUOTE_MINUTES),
  };
}
