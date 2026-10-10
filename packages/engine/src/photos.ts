import { env } from "cloudflare:workers";
import { seedArt } from "./seed-art";

/** Seed listings have no real photos: draw studio-style illustrations of each device instead. */
function seedPhoto(key: string) {
  return new Response(seedArt(key), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}

export async function servePhoto(key: string): Promise<Response> {
  if (key.startsWith("seed/")) return seedPhoto(key);
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

