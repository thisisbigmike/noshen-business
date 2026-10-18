/**
 * Photos are served by the Worker from R2 at /photos/<key>, cached for a year. "small" is the 480-pixel copy for
 * lists and grids (the full photo when there's no small copy).
 */
export const photoUrl = (key: string, size?: "small") => `/photos/${key}${size === "small" ? "?size=small" : ""}`;
