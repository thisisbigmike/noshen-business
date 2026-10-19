import { env } from "cloudflare:workers";
import { seedArt } from "./seed-art";
import { msg } from "@noshen/shared/i18n";
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

/** The photos from a form field, each with the small copy at the same place in `${field}_small`, if any. */
export function photosFrom(form: FormData, field: string): { file: File; small: File | null }[] {
  const smalls = form.getAll(`${field}_small`);
  return form.getAll(field).flatMap((f, i) => {
    if (!(f instanceof File) || f.size === 0) return [];
    const s = smalls[i];
    return [{ file: f, small: s instanceof File && s.size > 0 ? s : null }];
  });
}

