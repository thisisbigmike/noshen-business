// The staff site's service worker: shows notifications on the phone or computer, even when NosHen isn't open, and opens
// the right deal when one is tapped. It caches nothing: every page always comes fresh from the server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(msg.title || "NosHen staff", {
      body: msg.body || "Something needs a reviewer.",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      data: { url: msg.url || "/" },
    });
    // Any NosHen page that's open updates straight away (the bell, the deal's state).
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const page of pages) page.postMessage({ type: "noshen:staff-update" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Use a NosHen tab that's already open, if there is one; otherwise open a new one.
    for (const page of pages) {
      if (new URL(page.url).origin === self.location.origin && "focus" in page) {
        await page.focus();
        if ("navigate" in page) await page.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
