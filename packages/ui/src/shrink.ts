// Photos are made smaller on the phone before they're sent. A phone camera photo is often 3 to 8 MB; a seller
// uploading eight of them on mobile data, and every buyer scrolling past them, pays for that. Each photo becomes at
// most 1600 pixels on its longest side (sharp on any phone, usually 150 to 400 KB), plus a 480-pixel copy (around
// 30 KB) for lists and grids. Anything the browser can't read (an old browser, some HEIC photos) is sent as it was.

const FULL = 1600;
const SMALL = 480;

async function redraw(file: File, max: number, quality: number): Promise<Blob | null> {
  try {
    const image = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(image, 0, 0, w, h);
    image.close();
    const as = (type: string) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
    // WebP is smaller; a browser that can't make it (older Safari) makes a PNG instead, so use JPEG there.
    const webp = await as("image/webp");
    return webp?.type === "image/webp" ? webp : await as("image/jpeg");
  } catch {
    return null;
  }
}

const named = (blob: Blob, base: string) => new File([blob], `${base}.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type });

/**
 * Replaces the photos chosen in `input` with smaller ones, and puts a small copy of each, in the same order, in
 * `small` (an empty file where there's none). Call it when the photos are chosen, before the form is sent.
 */
export async function shrinkPhotos(input: HTMLInputElement, small?: HTMLInputElement | null): Promise<void> {
  const files = [...(input.files ?? [])];
  if (!files.length || typeof createImageBitmap !== "function" || typeof DataTransfer !== "function") return;
  const full = new DataTransfer();
  const smalls = new DataTransfer();
  for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, "") || "photo";
    const big = f.type.startsWith("image/") ? await redraw(f, FULL, 0.8) : null;
    full.items.add(big && big.size < f.size ? named(big, base) : f);
    const little = big ? await redraw(f, SMALL, 0.7) : null;
    smalls.items.add(little ? named(little, `${base}-small`) : new File([], "none"));
  }
  input.files = full.files;
  if (small) small.files = smalls.files;
}
