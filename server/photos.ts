import { env } from "cloudflare:workers";

const LABELS = ["Front", "Back", "Screen on", "IMEI screen (*#06#)", "Box and cable", "Side", "Detail", "Detail"];

/** Seed listings have no real photos: draw a calm placeholder with a camera icon and the shot's name. */
function placeholder(key: string) {
  const n = Number(key.split("/").pop()) || 1;
  const label = LABELS[(n - 1) % LABELS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="800" height="600" fill="#f6f8f7"/>
<g transform="translate(376 262) scale(2)" fill="none" stroke="#56625e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></g>
<text x="400" y="360" text-anchor="middle" font-family="Figtree, system-ui, sans-serif" font-size="26" fill="#56625e">Photo ${n} · ${label}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" } });
}

export async function servePhoto(key: string): Promise<Response> {
  if (key.startsWith("seed/")) return placeholder(key);
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** Stores an uploaded photo in R2 under a new, never-reused name, so it can be cached for a year. */
export async function storePhoto(prefix: string, file: File): Promise<string> {
  const ext = TYPES[file.type];
  if (!ext) throw new Error("Use a JPEG, PNG, WebP or HEIC photo.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Photos must be under 8 MB.");
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

