import { useEffect } from "react";
import { useRevalidator } from "react-router";

/**
 * Keeps a staff page current: reloads its data every few seconds while the tab is in front, and straight away
 * when staff come back to the tab. Nothing reloads while a form is being sent.
 */
export function useLive(everyMs = 15_000) {
  const r = useRevalidator();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && r.state === "idle") r.revalidate(); };
    const id = setInterval(refresh, everyMs);
    const onShow = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", refresh); };
  }, [everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
}
