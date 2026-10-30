import { marked } from "marked";
import { legalVars, type Settings } from "@noshen/engine/settings";
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
  const vars = legalVars(s);
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
