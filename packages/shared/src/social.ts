// Social handles, for "Check a seller": the platforms, what a handle on each looks like, and reading one from what a
// buyer pastes (@ada.styles, ada.styles, or a profile link).
import { en, msg, type T } from "./i18n";

export type Platform = "instagram" | "tiktok" | "facebook" | "x";

export const PLATFORMS: { key: Platform; label: string; pattern: RegExp; url: (h: string) => string; hosts: string[] }[] = [
  { key: "instagram", label: msg("Instagram"), pattern: /^[a-z0-9._]{1,30}$/, url: (h) => `https://www.instagram.com/${h}/`, hosts: ["instagram.com", "instagr.am"] },
  { key: "tiktok", label: msg("TikTok"), pattern: /^[a-z0-9._]{2,24}$/, url: (h) => `https://www.tiktok.com/@${h}`, hosts: ["tiktok.com"] },
  { key: "facebook", label: msg("Facebook"), pattern: /^[a-z0-9.]{5,50}$/, url: (h) => `https://www.facebook.com/${h}`, hosts: ["facebook.com", "fb.com"] },
  { key: "x", label: msg("X (Twitter)"), pattern: /^[a-z0-9_]{1,15}$/, url: (h) => `https://x.com/${h}`, hosts: ["x.com", "twitter.com"] },
];

export const isPlatform = (p: unknown): p is Platform => PLATFORMS.some((x) => x.key === p);
export const platformOf = (p: Platform) => PLATFORMS.find((x) => x.key === p)!;
export const profileUrl = (p: Platform, handle: string) => platformOf(p).url(handle);

/**
 * A handle as typed or pasted, cleaned up: no @, lower case, and the platform when it was a profile link
 * ("https://www.instagram.com/ada.styles/?igsh=…" → instagram, ada.styles). Null when there's nothing usable.
 */
export function parseHandle(raw: string): { platform: Platform | null; handle: string } | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  let platform: Platform | null = null;
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|m\.|mobile\.|web\.)?([a-z.]+\.[a-z]+)\/(.*)$/);
  if (link) {
    const found = PLATFORMS.find((p) => p.hosts.includes(link[1]));
    if (!found) return null;
    platform = found.key;
    s = link[2].split(/[?#]/)[0].split("/").filter(Boolean)[0] ?? "";
  }
  s = s.replace(/^@+/, "").replace(/\s+/g, "");
  if (!/^[a-z0-9._]{1,50}$/.test(s)) return null;
  return { platform, handle: s };
}

/** Why a handle won't do for a platform, or null. */
export function handleProblem(platform: Platform, handle: string, t: T = en): string | null {
  const p = platformOf(platform);
  if (!handle) return t("Enter your {platform} name, like @ada.styles.", { platform: t(p.label) });
  if (!p.pattern.test(handle)) return t("That doesn't look like a {platform} name. Copy it from your profile, without spaces.", { platform: t(p.label) });
  return null;
}
