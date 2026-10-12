import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

/**
 * A deal page's live connection to its room (workers/deal-room.ts). When the other person sends a message or the
 * deal changes, the page reloads its data at once. It also says whether the other person has the deal open, and
 * when they're typing. Reconnects by itself (backing off), and straight away when the phone comes back to the page.
 */
export function useDealLive(dealId: string, me: "buyer" | "seller", enabled = true) {
  const revalidator = useRevalidator();
  const reval = useRef(revalidator);
  reval.current = revalidator;
  const pending = useRef(false);
  const [connected, setConnected] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTyping = useRef(0);
  const other = me === "buyer" ? "seller" : "buyer";

  // A change that arrives while the page is already reloading is reloaded again once that finishes.
  const refresh = () => {
    if (reval.current.state === "idle") reval.current.revalidate();
    else pending.current = true;
  };
  useEffect(() => {
    if (revalidator.state === "idle" && pending.current) { pending.current = false; revalidator.revalidate(); }
  }, [revalidator.state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    let stop = false;
    let retry = 0;
    let again: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const open = () => {
      const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/deals/${dealId}/live`);
      socket.current = s;
      s.onopen = () => {
        retry = 0;
        setConnected(true);
        refresh(); // catch up on anything missed while disconnected
        ping = setInterval(() => { if (s.readyState === WebSocket.OPEN) s.send("ping"); }, 25_000);
      };
      s.onmessage = (e) => {
        if (e.data === "pong") return;
        let m: { type?: string; role?: string; online?: string[] };
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === "message" || m.type === "deal") { setOtherTyping(false); refresh(); }
        else if (m.type === "typing" && m.role === other) {
          setOtherTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setOtherTyping(false), 4000);
        } else if (m.type === "presence") setOtherOnline(!!m.online?.includes(other));
      };
      s.onclose = () => {
        clearInterval(ping);
        setConnected(false);
        setOtherOnline(false);
        if (!stop) again = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    open();
    const onVisible = () => {
      if (document.visibilityState === "visible" && socket.current?.readyState === WebSocket.CLOSED && !stop) { clearTimeout(again); retry = 0; open(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearTimeout(again);
      clearInterval(ping);
      clearTimeout(typingTimer.current);
      document.removeEventListener("visibilitychange", onVisible);
      socket.current?.close();
    };
  }, [dealId, me, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Call as the person types: the other side sees "typing…" (sent at most every 2.5 seconds). */
  const typing = () => {
    const now = Date.now();
    if (now - lastTyping.current < 2500 || socket.current?.readyState !== WebSocket.OPEN) return;
    lastTyping.current = now;
    socket.current.send(JSON.stringify({ type: "typing" }));
  };

  return { connected, otherOnline, otherTyping, typing };
}
