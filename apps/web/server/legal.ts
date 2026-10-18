import { marked } from "marked";
import type { Settings } from "@noshen/engine/settings";
import { naira } from "@noshen/shared/money";
import { QUOTE_MINUTES } from "@noshen/shared/payments";
import { LEGAL_NAV, type LegalSlug } from "@noshen/shared/legal-pages";
import terms from "../app/legal/terms.md?raw";
import dealTerms from "../app/legal/deal-terms.md?raw";
import privacy from "../app/legal/privacy.md?raw";
import cookies from "../app/legal/cookies.md?raw";
import prohibited from "../app/legal/prohibited-items.md?raw";
import safety from "../app/legal/safety.md?raw";

/**
 * The legal and help pages. The text lives in app/legal/*.md; numbers that come from the deal rules
 * ({{fee_min}}, {{deal_max}} and so on) are filled in from settings, so the pages never disagree with the app.
 * Rendered on the server only, so the Markdown library never reaches the browser.
 */
const PAGES: Record<LegalSlug, { source: string; draft: boolean }> = {
  terms: { source: terms, draft: true },
  "deal-terms": { source: dealTerms, draft: true },
  privacy: { source: privacy, draft: true },
  cookies: { source: cookies, draft: true },
  "prohibited-items": { source: prohibited, draft: true },
  safety: { source: safety, draft: false },
};

export const isLegalSlug = (s: string): s is LegalSlug => s in PAGES;

const slugify = (t: string) => t.toLowerCase().replace(/&amp;/g, "and").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function renderLegal(slug: LegalSlug, s: Settings) {
  const page = PAGES[slug];
  const title = LEGAL_NAV.find((p) => p.slug === slug)!.title;
  const vars: Record<string, string> = {
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
  const md = page.source.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
  let html = marked.parse(md, { async: false, gfm: true }) as string;
  html = html.replace(/<h1>[\s\S]*?<\/h1>\s*/, "");
  const toc: { id: string; text: string }[] = [];
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    const id = slugify(inner);
    toc.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  return { title, html, toc, draft: page.draft, hasPlaceholders: html.includes("<mark>") };
}
