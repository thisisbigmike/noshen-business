import { env } from "cloudflare:workers";
import { seedArt } from "./seed-art";
import { msg } from "@noshen/shared/i18n";
import { MAX_VIDEO_BYTES } from "@noshen/shared/photos";
import { DealError } from "./core";

/** Seed listings have no real photos: draw studio-style illustrations of each device instead. */
function seedPhoto(key: string) {
  return new Response(seedArt(key), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}

/** Where a photo's small copy is kept (see storePhoto). */
export const smallKey = (key: string) => `${key}.small`;

/**
 * A photo, or its small copy for lists and grids. A photo with no small copy (sent from a browser that couldn't
 * make one, or from before small copies) is served full size instead.
 */
export async function servePhoto(key: string, small = false): Promise<Response> {
  if (key.startsWith("seed/")) return seedPhoto(key);
  const obj = (small ? await env.PHOTOS.get(smallKey(key)) : null) ?? await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/**
 * Stores an uploaded photo in R2 under a new, never-reused name, so it can be cached for a year, and its small copy
 * when the phone made one (see @noshen/ui/shrink). The small copy is only ever a convenience: if it's missing or
 * odd, it's skipped.
 */
export async function storePhoto(prefix: string, file: File, small?: File | null): Promise<string> {
  const ext = TYPES[file.type];
  if (!ext) throw new DealError("photo", msg("Use a JPEG, PNG, WebP or HEIC photo."));
  if (file.size > 8 * 1024 * 1024) throw new DealError("photo", msg("Photos must be under 8 MB."));
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (small && small.size > 0 && small.size < 1024 * 1024 && TYPES[small.type]) {
    await env.PHOTOS.put(smallKey(key), await small.arrayBuffer(), { httpMetadata: { contentType: small.type } });
  }
  return key;
}

/** Deletes a photo and its small copy, when it's no longer used (a profile picture that was replaced or removed). */
export async function deletePhoto(key: string) {
  if (key.startsWith("seed/")) return;
  await env.PHOTOS.delete([key, smallKey(key)]);
}

// Listing videos live in the same bucket as the photos. The phone sends an H.264 MP4 (see @noshen/ui/shrink-video),
// a light copy for data saver and a still frame; a phone that can't convert sends the video as it was, with neither.
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
const posterKey = (key: string) => `${key}.poster`;

/**
 * Stores a listing video in R2 under a new, never-reused name, with its light copy and still frame when the phone
 * made them. As with photos, those two are only a convenience: if either is missing or odd, it's skipped.
 */
export async function storeVideo(prefix: string, file: File, small?: File | null, poster?: File | null): Promise<string> {
  const ext = VIDEO_TYPES[file.type];
  if (!ext) throw new DealError("video", msg("Use an MP4, MOV or WebM video."));
  if (file.size > MAX_VIDEO_BYTES) throw new DealError("video", msg("Videos must be under 50 MB."));
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  // A File is a Blob: R2 takes it as it is, without another copy in memory.
  await env.PHOTOS.put(key, file, { httpMetadata: { contentType: file.type } });
  if (small && small.size > 0 && small.size < file.size && small.type === "video/mp4") {
    await env.PHOTOS.put(smallKey(key), small, { httpMetadata: { contentType: small.type } });
  }
  if (poster && poster.size > 0 && poster.size < 1024 * 1024 && TYPES[poster.type]) {
    await env.PHOTOS.put(posterKey(key), poster, { httpMetadata: { contentType: poster.type } });
  }
  return key;
}

/** Deletes a video, its light copy and its still frame (a draft's video that was replaced or removed). */
export async function deleteVideo(key: string) {
  await env.PHOTOS.delete([key, smallKey(key), posterKey(key)]);
}

/**
 * A listing video, its light copy or its still frame. Videos are sent in the pieces the player asks for (HTTP Range),
 * so playback starts at once, seeking works, and iPhones play them at all.
 */
export async function serveVideo(request: Request, key: string, which?: "small" | "poster"): Promise<Response> {
  const cache = "public, max-age=31536000, immutable";
  if (which === "poster") {
    const obj = await env.PHOTOS.get(posterKey(key));
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": cache } });
  }
  const get = (name: string) => env.PHOTOS.get(name, { range: request.headers });
  let obj: R2ObjectBody | null;
  try {
    obj = (which === "small" ? await get(smallKey(key)) : null) ?? await get(key);
  } catch {
    // A range that isn't in the file.
    const head = await env.PHOTOS.head(which === "small" ? smallKey(key) : key) ?? await env.PHOTOS.head(key);
    return new Response("Range not satisfiable", { status: 416, headers: head ? { "content-range": `bytes */${head.size}` } : {} });
  }
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "content-type": obj.httpMetadata?.contentType ?? "video/mp4", "accept-ranges": "bytes", "cache-control": cache, etag: obj.httpEtag,
  });
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (request.headers.has("range") && r) {
    const offset = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0;
    const length = r.suffix !== undefined ? r.suffix : r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

/** The photos from a form field, each with the small copy at the same place in `${field}_small`, if any. */
export function photosFrom(form: FormData, field: string): { file: File; small: File | null }[] {
  const smalls = form.getAll(`${field}_small`);
  return form.getAll(field).flatMap((f, i) => {
    if (!(f instanceof File) || f.size === 0) return [];
    const s = smalls[i];
    return [{ file: f, small: s instanceof File && s.size > 0 ? s : null }];
  });
}

