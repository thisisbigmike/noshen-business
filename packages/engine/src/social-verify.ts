// Automated social profile bio verification using ScrapeCreators (X, Instagram, TikTok, Facebook).
// Checks only the profile's own bio/description/about fields (never posts or comments) so nobody can spoof a check.
import type { Platform } from "@noshen/shared/social";

export type BioCheckResult =
  | { status: "matched"; bio: string }
  | { status: "not_found"; bio: string }
  | { status: "unavailable"; reason: string };

export interface SocialVerifier {
  checkBio(platform: Platform, handle: string, code: string): Promise<BioCheckResult>;
}

const BASE = "https://api.scrapecreators.com/v1";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normHandle = (s: unknown) => (typeof s === "string" ? s.trim().replace(/^@+/, "").toLowerCase() : "");

function hasCode(bio: string, code: string): boolean {
  if (!bio || !code) return false;
  return new RegExp(`(^|[^A-Z0-9-])${escapeRegex(code)}($|[^A-Z0-9-])`, "i").test(bio);
}

function endpointFor(platform: Platform, handle: string): string {
  switch (platform) {
    case "x":
      return `${BASE}/twitter/profile?handle=${encodeURIComponent(handle)}`;
    case "instagram":
      return `${BASE}/instagram/profile?handle=${encodeURIComponent(handle)}`;
    case "tiktok":
      return `${BASE}/tiktok/profile?handle=${encodeURIComponent(handle)}`;
    case "facebook":
      return `${BASE}/facebook/profile?url=${encodeURIComponent(`https://www.facebook.com/${handle}`)}`;
  }
}

/** Pulls the profile handle (when returned) and bio text for each platform, ignoring unrelated posts/tweets. */
function extractProfile(platform: Platform, payload: any): { returnedHandle: string; bio: string } | null {
  if (!payload || typeof payload !== "object" || payload.success === false) return null;

  if (platform === "x") {
    const legacy = payload.legacy;
    const core = payload.core;
    const returnedHandle = normHandle(core?.screen_name ?? legacy?.screen_name ?? payload.screen_name ?? payload.username);
    const bio = typeof legacy?.description === "string" ? legacy.description
      : typeof payload.description === "string" ? payload.description
      : typeof payload.bio === "string" ? payload.bio
      : null;
    if (bio === null && !returnedHandle) return null;
    return { returnedHandle, bio: bio ?? "" };
  }

  if (platform === "instagram") {
    const u = payload.data?.user ?? payload.data ?? payload.user ?? payload;
    const returnedHandle = normHandle(u?.username);
    const bio = typeof u?.biography === "string" ? u.biography : typeof u?.bio === "string" ? u.bio : null;
    if (bio === null && !returnedHandle) return null;
    return { returnedHandle, bio: bio ?? "" };
  }

  if (platform === "tiktok") {
    const u = payload.user ?? payload.userInfo?.user ?? payload.data?.user ?? payload;
    const returnedHandle = normHandle(u?.uniqueId ?? u?.unique_id ?? u?.username);
    const bio = typeof u?.signature === "string" ? u.signature : typeof u?.bio === "string" ? u.bio : null;
    if (bio === null && !returnedHandle) return null;
    return { returnedHandle, bio: bio ?? "" };
  }

  if (platform === "facebook") {
    const u = payload.profile ?? payload.data ?? payload;
    const parts = [u?.about, u?.intro, u?.bio, u?.description, u?.pageIntro].filter((s) => typeof s === "string");
    const hasProfile = Boolean(u?.pageId || u?.id || u?.name || parts.length);
    if (!hasProfile) return null;
    return { returnedHandle: normHandle(u?.username ?? u?.vanity), bio: parts.join("\n") };
  }

  return null;
}

export class ScrapeCreatorsVerifier implements SocialVerifier {
  constructor(private readonly apiKey: string) {}

  async checkBio(platform: Platform, handle: string, code: string): Promise<BioCheckResult> {
    const clean = normHandle(handle);
    if (!clean) return { status: "unavailable", reason: "Empty handle" };
    try {
      const res = await fetch(endpointFor(platform, clean), {
        headers: { "x-api-key": this.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { status: "unavailable", reason: `HTTP ${res.status}` };
      const json = await res.json().catch(() => null);
      const profile = extractProfile(platform, json);
      if (!profile) return { status: "unavailable", reason: "Profile not readable" };
      // If the platform returned a canonical handle, confirm it matches what the seller claimed.
      if (profile.returnedHandle && profile.returnedHandle !== clean) {
        return { status: "unavailable", reason: `Handle mismatch (${profile.returnedHandle} !== ${clean})` };
      }
      return hasCode(profile.bio, code)
        ? { status: "matched", bio: profile.bio }
        : { status: "not_found", bio: profile.bio };
    } catch (e) {
      return { status: "unavailable", reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
