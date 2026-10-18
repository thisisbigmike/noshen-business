// Data saver: for people on small data plans. It's on when they turn it on, or when their browser says it's saving
// data (the Save-Data header, sent by data-saving browsers and modes); they can turn it off again. With it on, pages
// skip the web fonts, show small photos (full size only when tapped), and check for updates less often.

export const DATA_COOKIE = "noshen-data";

export function liteFromRequest(cookie: string | null, saveData: string | null): boolean {
  const saved = (cookie ?? "").match(/(?:^|;\s*)noshen-data=(lite|full)/)?.[1];
  if (saved) return saved === "lite";
  return (saveData ?? "").trim().toLowerCase() === "on";
}
