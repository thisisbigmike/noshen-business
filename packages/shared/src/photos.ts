/**
 * Photos are served by the Worker from R2 at /photos/<key>, cached for a year. "small" is the 480-pixel copy for
 * lists and grids (the full photo when there's no small copy).
 */
export const photoUrl = (key: string, size?: "small") => `/photos/${key}${size === "small" ? "?size=small" : ""}`;

/** The longest listing video, in seconds. A longer one is cut to its first minute on the phone. */
export const MAX_VIDEO_SECONDS = 60;

/** The biggest listing video NosHen takes, once the phone has made it smaller. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * A listing video, served by the Worker from R2 at /videos/<key> in pieces as it plays. "small" is the light copy for
 * data saver (the full video when there's no light copy).
 */
export const videoUrl = (key: string, size?: "small") => `/videos/${key}${size === "small" ? "?size=small" : ""}`;

/** The still frame shown before a listing video plays. */
export const posterUrl = (key: string) => `/videos/${key}?poster=1`;

/** "0:42" from 42 seconds. */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
