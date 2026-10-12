import { useEffect, useState } from "react";
import { useRouteLoaderData } from "react-router";
import { Button, Icon } from "@noshen/ui/ui";

type State = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** An iPhone or iPad, not opened from the Home Screen: Apple allows web notifications only from there. */
const needsInstall = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone && !matchMedia("(display-mode: standalone)").matches;

/**
 * Notifications on this device: whether they're on, and turning them on (asks the browser, then tells NosHen where
 * to send them) or off. The site's public key comes from the root loader; without it, notifications aren't offered.
 */
export function usePush() {
  const key = (useRouteLoaderData("root") as { pushKey?: string | null } | undefined)?.pushKey ?? null;
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return setState(needsInstall() ? "install" : "unsupported");
      if (!("PushManager" in window)) return setState(needsInstall() ? "install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const post = (path: string, body: unknown) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function turnOn() {
    if (!key) return;
    setBusy(true); setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }));
      const r = await post("/api/push/subscribe", sub.toJSON());
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't turn notifications on.");
      // No notification straight away: a site that sends one the moment it's allowed looks like spam to the browser.
      setState("on");
      setNote("Notifications are on for this device. Tap “Send a test” to see one.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't turn notifications on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true); setNote(null);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) { await post("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState("off");
      setNote("Notifications are off for this device. Updates still appear in Alerts.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const r = await post("/api/push/test", {}).catch(() => null);
    setNote(r?.ok ? "Sent. It should appear in a moment." : "Couldn't send a test. Try again.");
    setBusy(false);
  }

  // Installing NosHen as an app (Android): its notifications then come from the NosHen app, with its own icon.
  const [installable, setInstallable] = useState(false);
  useEffect(() => {
    const check = () => setInstallable(!!(window as { __noshenInstall?: Event }).__noshenInstall);
    check();
    window.addEventListener("noshen:installable", check);
    return () => window.removeEventListener("noshen:installable", check);
  }, []);
  async function install() {
    const e = (window as { __noshenInstall?: Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> } }).__noshenInstall;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    (window as { __noshenInstall?: Event }).__noshenInstall = undefined;
    setInstallable(false);
    if (outcome === "accepted") setNote("NosHen is on your Home Screen. Open it from there for the best notifications.");
  }

  return { available: !!key, state, busy, note, turnOn, turnOff, test, installable, install };
}

/** The card for Alerts and Account: turn notifications on or off for this device, with help when it can't. */
export function PushCard({ compact }: { compact?: boolean }) {
  const p = usePush();
  if (!p.available || p.state === "loading") return null;
  if (compact && p.state !== "off") return null;
  return (
    <section className={compact ? "push-card compact" : "push-card"} aria-labelledby="push-title">
      <span className="push-icon" aria-hidden="true"><Icon name="bell" size={22} /></span>
      <div className="grow stack" style={{ gap: 6 }}>
        <p id="push-title" className="label">
          {p.state === "on" ? "Notifications are on for this device" : compact ? "Hear the moment something changes" : "Get updates on this device"}
        </p>
        <p className="caption muted">
          {p.state === "on" ? "You'll get a notification when your deals change, even when NosHen is closed."
            : p.state === "denied" ? "Notifications are blocked for NosHen. Allow them in your browser's settings for this site, then come back."
            : p.state === "install" ? "On iPhone and iPad: tap Share, then “Add to Home Screen”. Open NosHen from your Home Screen and turn notifications on there."
            : p.state === "unsupported" ? "This browser can't show notifications. Your updates still appear in Alerts."
            : "When a seller accepts, money is held, or anything else changes, your phone tells you straight away."}
        </p>
        {p.note ? <p className="caption ok-note" role="status">{p.note}</p> : null}
        {p.state === "off" ? (
          <div><Button variant="primary" size="sm" icon="bell" onClick={p.turnOn} disabled={p.busy}>{p.busy ? "Turning on…" : "Turn on notifications"}</Button></div>
        ) : p.state === "on" && !compact ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <Button size="sm" onClick={p.test} disabled={p.busy}>Send a test</Button>
            <Button size="sm" onClick={p.turnOff} disabled={p.busy}>Turn off</Button>
          </div>
        ) : null}
        {p.installable && !compact ? (
          <div className="stack" style={{ gap: 4 }}>
            <div><Button size="sm" icon="device-mobile" onClick={p.install}>Install the NosHen app</Button></div>
            <p className="caption muted">Adds NosHen to your Home Screen. Notifications then come from the NosHen app, not a website.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
