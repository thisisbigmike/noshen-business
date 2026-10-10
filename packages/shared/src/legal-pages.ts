// The legal and help pages, in the order they're listed in footers and side menus.
export const LEGAL_NAV = [
  { slug: "terms", title: "Terms of Use" },
  { slug: "deal-terms", title: "Protected Deal Terms" },
  { slug: "privacy", title: "Privacy Policy" },
  { slug: "cookies", title: "Cookie Policy" },
  { slug: "prohibited-items", title: "Prohibited items" },
  { slug: "safety", title: "Safety tips" },
] as const;

export type LegalSlug = (typeof LEGAL_NAV)[number]["slug"];
