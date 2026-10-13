import { useEffect, useRef } from "react";
import { isRouteErrorResponse, useRevalidator } from "react-router";

/**
 * Why an error page is showing:
 * - "offline": the page couldn't reach NosHen (no connection, or the computer just woke up).
 * - "update": NosHen was updated since the page opened, and a part of the old version is gone.
 * - "missing": nothing at this address.
 * - "broken": the server failed.
 */
export type Failure = "offline" | "update" | "missing" | "broken";

export function failureOf(error: unknown): Failure {
  if (isRouteErrorResponse(error)) return error.status === 404 ? "missing" : "broken";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message)) return "update";
  if ((typeof navigator !== "undefined" && navigator.onLine === false)
    || /Failed to fetch|NetworkError|Load failed|network connection was lost|fetch failed|Network request failed/i.test(message)) return "offline";
  return "broken";
}

/**
 * Lets an error page put itself right. After a connection failure it reloads the page's data as soon as the
 * connection is back (and every few seconds while the page is in front); after a server failure it tries twice
 * more on its own; after an update it loads the new version, once. A successful reload shows the page again.
 */
export function useRecover(failure: Failure) {
  const revalidator = useRevalidator();
  const r = useRef(revalidator);
  r.current = revalidator;
  useEffect(() => {
    if (failure === "missing") return;
    if (failure === "update") {
      // Once per minute at most, so a page that can't load never reloads in a loop.
      const key = `noshen:reloaded:${location.pathname}`;
      let last = 0;
      try { last = Number(sessionStorage.getItem(key)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - last > 60_000) {
        try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
        location.reload();
      }
      return;
    }
    const retry = () => {
      if (navigator.onLine !== false && document.visibilityState === "visible" && r.current.state === "idle") r.current.revalidate();
    };
    if (failure === "broken") {
      const timers = [setTimeout(retry, 3_000), setTimeout(retry, 12_000)];
      return () => timers.forEach(clearTimeout);
    }
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    const id = setInterval(retry, 4_000);
    return () => { clearInterval(id); window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, [failure]);
  return { retry: () => revalidator.revalidate(), retrying: revalidator.state !== "idle" };
}

/**
 * For pages that refresh themselves in the background: whether now is a good moment. Not while offline, and
 * not in a hidden tab.
 */
export const canRefresh = () => document.visibilityState === "visible" && navigator.onLine !== false;
