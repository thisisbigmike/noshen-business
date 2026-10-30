import { config } from "../config.js";
import type { ToolResult } from "./types.js";

/**
 * NosHen listings, read live from the NosHen website's browse and listing pages.
 * Buying happens on the site: a listing's buy link starts a protected deal on it in the NosHen app.
 */

const TIMEOUT_MS = 10_000;
const LISTING_ID = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

export interface NoshenListing {
  id: string;
  title: string;
  /** As the site shows it, e.g. "₦2,500,000". */
  price?: string;
  seller?: string;
  details?: string;
  url: string;
  buyUrl: string;
}

const baseUrl = () => config.noshenApiUrl.replace(/\/$/, "");

export async function searchNoshenListings(params: { query?: string }): Promise<ToolResult> {
  const query = params.query?.trim() ?? "";

  // A listing's link or ID opens that listing.
  const id = query.match(LISTING_ID)?.[0];
  if (id) {
    const listing = await fetchListing(id);
    return listing ? { success: true, message: "The NosHen listing.", data: [listing] } : { success: false, message: `There's no NosHen listing ${id}.` };
  }

  const matches = await fetchBrowsePage(query);
  if (matches.length > 0 || !query) {
    return { success: true, message: `${matches.length} NosHen listing(s)${query ? ` match "${query}"` : ""}.`, data: matches };
  }

  // The site matches words in titles, so "hair" doesn't find "Bone Straight". The newest listings are passed on
  // separately, for the agent to mention only those that fit what the user asked for.
  return {
    success: true,
    message:
      `No NosHen listing title matches "${query}". data.newest are the newest listings on NosHen, not matches: mention one only if it ` +
      `clearly fits what the user asked for, and say it isn't an exact match. All listings: ${baseUrl()}/browse`,
    data: { newest: await fetchBrowsePage("") },
  };
}

/** The listing cards on the site's browse page: the matches for a search or, with no query, the newest listings. */
async function fetchBrowsePage(query: string): Promise<NoshenListing[]> {
  const html = await fetchPage(query ? `/browse?q=${encodeURIComponent(query)}` : "/browse");
  const listings = new Map<string, NoshenListing>();
  for (const [, id, card] of html?.matchAll(/<a[^>]+href="\/l\/([a-f0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g) ?? []) {
    if (listings.has(id)) continue;
    listings.set(
      id,
      listing(
        id,
        card.match(/class="nh-listing-title (?:title|heading)">([^<]+)<\/p>/)?.[1]?.trim(),
        card.match(/class="nh-listing-price heading">([^<]+)<\/p>/)?.[1]?.trim(),
        plainText(card.match(/class="nh-listing-seller caption[^"]*">([\s\S]*?)<\/p>/)?.[1]),
        plainText(card.match(/class="nh-listing-meta caption">([\s\S]*?)<\/p>/)?.[1]),
      ),
    );
  }
  return [...listings.values()];
}

async function fetchListing(id: string): Promise<NoshenListing | null> {
  const html = await fetchPage(`/l/${id}`);
  const [, title, price] = html?.match(/<title>([^·<]+)·\s*([^·<]+)·\s*NosHen<\/title>/) ?? [];
  if (!title) return null;
  return listing(id, title.trim(), price?.trim(), undefined, html?.match(/<meta name="description" content="([^"]+)"\/>/)?.[1]);
}

/** A page of the NosHen site, or null when it doesn't exist. Throws when the site can't be reached. */
async function fetchPage(path: string): Promise<string | null> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { "User-Agent": "NosHen-Agent/1.0", Accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The NosHen site answered ${res.status}`);
  return res.text();
}

function listing(id: string, title?: string, price?: string, seller?: string, details?: string): NoshenListing {
  return { id, title: title || "Untitled listing", price, seller, details, url: `${baseUrl()}/l/${id}`, buyUrl: `${baseUrl()}/l/${id}/buy` };
}

const plainText = (html?: string) => html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;
