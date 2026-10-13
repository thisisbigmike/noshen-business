import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { canRefresh } from "@noshen/ui/recover";

/**
 * Keeps a staff page current: reloads its data every few seconds while the tab is in front and online, and
 * soon after staff come back to the tab (a moment later, so a computer that has just woken up is back online
 * first). Nothing reloads while a form is being sent.
 */
export function useLive(everyMs = 15_000) {
  const revalidator = useRevalidator();
  const r = useRef(revalidator);
  r.current = revalidator;
  useEffect(() => {
    const refresh = () => { if (canRefresh() && r.current.state === "idle") r.current.revalidate(); };
    let wake: ReturnType<typeof setTimeout> | undefined;
    const onShow = () => { clearTimeout(wake); if (document.visibilityState === "visible") wake = setTimeout(refresh, 1500); };
    const id = setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onShow);
    return () => {
      clearInterval(id); clearTimeout(wake);
      document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); window.removeEventListener("online", onShow);
    };
  }, [everyMs]);
}
