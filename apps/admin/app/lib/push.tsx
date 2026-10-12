import { useEffect, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";
import { Icon } from "@noshen/ui/ui";

type State = "loading" | "unsupported" | "denied" | "off" | "on";
const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * The staff site's service worker: registered on every page, so alerts reach this device; when one arrives while
 * the site is open, the page reloads its data at once (the queues, the counts).
 */
export function useStaffLive() {
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onMessage = (e: MessageEvent) => { if (e.data?.type === "noshen:staff-update" && revalidator.state === "idle") revalidator.revalidate(); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Staff notifications on this device: a small switch for the side menu, with a test. */
export function StaffPushSwitch() {
  const key = (useRouteLoaderData("root") as { pushKey?: string | null } | undefined)?.pushKey ?? null;
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);
  if (!key || state === "loading") return null;

  async function turnOn() {
    setBusy(true); setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key!) }));
      const r = await post("/api/push/subscribe", sub.toJSON());
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't turn alerts on.");
      setState("on");
      setNote("Alerts are on for this device.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't turn alerts on.");
    } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true);
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) { await post("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    setState("off"); setNote(null); setBusy(false);
  }
  async function test() {
    setBusy(true);
    const r = await post("/api/push/test", {}).catch(() => null);
    setNote(r?.ok ? "Test sent." : "Couldn't send a test.");
    setBusy(false);
  }

  return (
    <div className="staff-push">
      <div className="row-between" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 8 }}><Icon name="bell" size={18} /><span className="label">Alerts on this device</span></span>
        {state === "on" || state === "off" ? (
          <button type="button" role="switch" aria-checked={state === "on"} className="switch" disabled={busy} onClick={state === "on" ? turnOff : turnOn}
            aria-label={state === "on" ? "Turn alerts off on this device" : "Turn alerts on for this device"}><span /></button>
        ) : null}
      </div>
      <p className="caption muted">
        {state === "on" ? <>New disputes, payments to check, failed payouts and locked codes. <button type="button" className="link-btn" onClick={test} disabled={busy}>Send a test</button></>
          : state === "off" ? "Get a notification when something needs a reviewer, even when this site is closed."
          : state === "denied" ? "Blocked in this browser's settings for this site."
          : "This browser can't show notifications."}
      </p>
      {note ? <p className="caption ok-text" role="status">{note}</p> : null}
    </div>
  );
}
