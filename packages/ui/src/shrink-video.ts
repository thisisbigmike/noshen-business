// Listing videos are made smaller on the phone before they're sent, like photos (see shrink.ts). A minute of phone
// video is often 100 MB or more, and iPhones record HEVC, which many Android phones can't play. Each video becomes an
// H.264 MP4 (plays on any phone) at most 720 pixels on its short side, about 12 MB a minute, plus a light 360-pixel
// copy (about 4 MB a minute) for buyers on data saver, and a still frame shown before it plays. A video over a minute
// is cut to its first minute. The sound is copied as it is (phones record AAC, which plays everywhere), since many
// browsers can't make AAC themselves. A phone that can't convert video (an older browser) sends it as it was, on its
// own, and so does one that would lose the sound, when the video is small enough to send.
// The converter (Mediabunny, which uses the phone's own video encoder) is only loaded when a video is chosen.
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from "@noshen/shared/photos";

export interface ShrunkVideo {
  file: File;
  /** The light copy, when the phone made one. */
  small: File | null;
  /** The still frame, when the phone made one. */
  poster: File | null;
  /** How long it plays, when known. */
  seconds: number | null;
}

const FULL = { side: 720, video: 1_600_000 };
const LIGHT = { side: 360, video: 450_000 };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function jpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  return new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.82));
}

/**
 * Converts a chosen video for sending. `onProgress` gets how much is done, from 0 to 1. It never throws: anything
 * that goes wrong sends the video as it was.
 */
export async function shrinkVideo(file: File, onProgress?: (done: number) => void): Promise<ShrunkVideo> {
  const asItWas: ShrunkVideo = { file, small: null, poster: null, seconds: null };
  let mb: typeof import("mediabunny") | null;
  try {
    // Never on the server: the build leaves the converter out of the Worker altogether.
    mb = import.meta.env.SSR ? null : await import("mediabunny");
  } catch {
    return asItWas;
  }
  if (!mb) return asItWas;
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return asItWas;
    const first = await input.getFirstTimestamp();
    const total = await input.computeDuration();
    const seconds = Math.round(Math.min(total - first, MAX_VIDEO_SECONDS));
    if (typeof VideoEncoder !== "function") return { ...asItWas, seconds };
    const trim = total - first > MAX_VIDEO_SECONDS + 0.5 ? { start: first, end: first + MAX_VIDEO_SECONDS } : undefined;
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    // Phones often record at 60 frames a second; 30 is smooth for showing an item and half the size.
    const frameRate = (await track.computePacketStats(90)).averagePacketRate > 31 ? 30 : undefined;
    const base = file.name.replace(/\.[^.]+$/, "") || "video";

    // The sound, when the original has some and the conversion would drop it (it isn't AAC and the browser can't make AAC).
    let lostSound = false;
    const encode = async (q: typeof FULL, name: string, from: number, to: number): Promise<File | null> => {
      const scale = Math.min(1, q.side / Math.min(w, h));
      const width = even(w * scale);
      const height = even(h * scale);
      if (!(await mb.canEncodeVideo("avc", { width, height, quality: new mb.Quality({ bitrate: q.video }) }))) return null;
      const target = new mb.BufferTarget();
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
      const conversion = await mb.Conversion.init({
        input, output, tracks: "primary", trim, showWarnings: false,
        video: { codec: "avc", width, height, fit: "cover", quality: new mb.Quality({ bitrate: q.video }), frameRate, keyFrameInterval: 2, forceTranscode: true },
        audio: { codec: "aac" },
      });
      if (!conversion.isValid || !conversion.utilizedTracks.includes(track)) return null;
      lostSound ||= conversion.discardedTracks.some((d) => d.track.type === "audio");
      if (lostSound && file.size <= MAX_VIDEO_BYTES) return null;
      conversion.onProgress = (p) => onProgress?.(from + (to - from) * p);
      await conversion.execute();
      return target.buffer ? new File([target.buffer], name, { type: "video/mp4" }) : null;
    };

    const full = await encode(FULL, `${base}.mp4`, 0, 0.7);
    if (!full) return { ...asItWas, seconds };
    const small = await encode(LIGHT, `${base}-small.mp4`, 0.7, 0.95).catch(() => null);
    // The still frame: a moment in, past any shake from pressing record.
    const frame = await new mb.CanvasSink(track, { width: even(w * Math.min(1, FULL.side / Math.min(w, h))) })
      .getCanvas(first + Math.min(1, seconds / 3)).catch(() => null);
    const still = frame ? await jpeg(frame.canvas).catch(() => null) : null;
    onProgress?.(1);
    return {
      file: full,
      small: small && small.size < full.size ? small : null,
      poster: still ? new File([still], `${base}-poster.jpg`, { type: "image/jpeg" }) : null,
      seconds,
    };
  } catch {
    return asItWas;
  } finally {
    input.dispose();
  }
}
