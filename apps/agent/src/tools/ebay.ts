import { config } from "../config.js";
import type { ToolResult } from "./types.js";

/**
 * 3. eBay Tool (Browse API)
 * Searches live eBay listings and opens single listings through eBay's Browse API, with delivery worked out
 * for the buyer's country. eBay doesn't let outside apps check out for a buyer, so buying always happens on
 * the listing's own eBay page. Without eBay API keys there are no listings to show, only a link to the same
 * search on eBay's website.
 */

const API = "https://api.ebay.com";
const MARKETPLACE = "EBAY_US";
// Only listings that deliver to this country are returned, with the delivery cost to it.
const SHIP_TO = process.env.EBAY_SHIP_TO_COUNTRY || "NG";
const MAX_RESULTS = 5;
const TIMEOUT_MS = 10_000;

// eBay's condition IDs for each condition the agent can ask for. "For parts or not working" (7000) is never included.
const CONDITION_IDS: Record<string, string> = {
  NEW: "1000|1500",
  REFURBISHED: "2000|2010|2020|2030|2500",
  USED: "2750|2990|3000|3010|4000|5000|6000",
};

interface EbayParams {
  query: string;
  maxPrice?: number;
  condition?: "NEW" | "USED" | "REFURBISHED";
  action: "browse" | "get_item";
  itemId?: string;
}

export const ebayConfigured = () => Boolean(config.ebay.appId && config.ebay.certId);

export async function searchEbay(params: EbayParams): Promise<ToolResult> {
  const searchUrl = websiteSearchUrl(params);
  if (!ebayConfigured()) {
    return {
      success: false,
      message:
        "Live eBay listings aren't connected yet (no eBay API keys), so there are no listings or prices to show. " +
        `This link opens the same search on eBay's website: ${searchUrl}`,
    };
  }
  try {
    return params.action === "get_item" && params.itemId ? await getItem(params.itemId) : await search(params, searchUrl);
  } catch (err: any) {
    console.warn(`[eBay]: ${err?.message ?? err}`);
    return { success: false, message: `eBay search failed (${err?.message ?? err}). This link opens the same search on eBay's website: ${searchUrl}` };
  }
}

async function search(params: EbayParams, searchUrl: string): Promise<ToolResult> {
  const filters = [`deliveryCountry:${SHIP_TO}`];
  if (params.maxPrice) filters.push(`price:[..${params.maxPrice}]`, "priceCurrency:USD");
  const conditionIds = params.condition && CONDITION_IDS[params.condition];
  if (conditionIds) filters.push(`conditionIds:{${conditionIds}}`);

  const body = await callEbay(
    `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(params.query)}&limit=${MAX_RESULTS}&filter=${encodeURIComponent(filters.join(","))}`,
  );
  const listings = (body.itemSummaries ?? []).map(toListing);
  return {
    success: true,
    message: listings.length
      ? `${body.total} eBay listings deliver to ${SHIP_TO}; these are the top ${listings.length}. Prices are in US dollars. All of them on eBay's website: ${searchUrl}`
      : `No eBay listings for "${params.query}" deliver to ${SHIP_TO} with these filters.`,
    data: listings,
  };
}

async function getItem(itemId: string): Promise<ToolResult> {
  // Takes eBay's own item ID (v1|123|0), the number in a listing's link, or the link itself.
  const legacyId = itemId.match(/\d{9,}/)?.[0];
  const path = itemId.startsWith("v1|")
    ? `/buy/browse/v1/item/${encodeURIComponent(itemId)}`
    : legacyId && `/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyId}`;
  if (!path) return { success: false, message: `"${itemId}" isn't an eBay item ID or listing link.` };

  const item = await callEbay(path);
  return {
    success: true,
    message: `eBay listing. Prices are in US dollars, and delivery is to ${SHIP_TO}.`,
    data: {
      ...toListing(item),
      conditionNotes: item.conditionDescription,
      availability: item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus,
      returnsAccepted: item.returnTerms?.returnsAccepted,
      returnPeriod: item.returnTerms?.returnPeriod,
    },
  };
}

function toListing(item: any) {
  return {
    itemId: item.itemId,
    title: item.title,
    price: money(item.price ?? item.currentBidPrice),
    delivery: cheapestDelivery(item.shippingOptions),
    condition: item.condition,
    buyingOptions: item.buyingOptions,
    seller: item.seller && `${item.seller.username} (${item.seller.feedbackPercentage}% positive from ${item.seller.feedbackScore} ratings)`,
    url: item.itemWebUrl,
  };
}

const money = (amount?: { value: string; currency: string }) => (amount ? `${amount.value} ${amount.currency}` : undefined);

function cheapestDelivery(options?: any[]) {
  const costs = (options ?? []).map((o) => o.shippingCost).filter(Boolean);
  const cheapest = costs.sort((a, b) => Number(a.value) - Number(b.value))[0];
  if (!cheapest) return "not shown, see the listing";
  return Number(cheapest.value) === 0 ? "free" : money(cheapest);
}

/** The same search on eBay's website, for when the API can't be used. */
function websiteSearchUrl(params: EbayParams): string {
  const query = new URLSearchParams({ _nkw: params.query });
  if (params.maxPrice) query.set("_udhi", String(params.maxPrice));
  const conditionIds = params.condition && CONDITION_IDS[params.condition];
  if (conditionIds) query.set("LH_ItemCondition", conditionIds);
  return `https://www.ebay.com/sch/i.html?${query}`;
}

let token: { value: string; expiresAt: number } | null = null;

/** An application token for eBay's Buy APIs, reused until shortly before it expires (after about 2 hours). */
async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${config.ebay.appId}:${config.ebay.certId}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`sign-in failed, ${res.status} ${body.error_description ?? body.error ?? ""}`.trim());
  token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 7200) * 1000 };
  return token.value;
}

async function callEbay(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      "X-EBAY-C-ENDUSERCTX": `contextualLocation=${encodeURIComponent(`country=${SHIP_TO}`)}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error(`${res.status} ${body.errors?.[0]?.message ?? ""}`.trim());
  return body;
}
