import { Hono } from "hono";
import { createAuth } from "./auth";
import { staffOf } from "./web";
import { servePhoto, serveVideo } from "@noshen/engine/photos";
import { env } from "cloudflare:workers";
import { pushFor, withApp } from "@noshen/engine/context";
import { sendPush } from "@noshen/engine/push";

/** The staff site's endpoints: its own sign-in, and photos (listing photos and dispute evidence) for staff only. */
export const api = new Hono();

api.on(["GET", "POST"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

// Staff notifications on this device: turn on, off, or send a test. Signed-in staff only, from this site only.
async function staffFor(req: Request) {
  const st = await staffOf(req);
  return st && typeof st !== "string" && st.twoFactorEnabled ? st : null;
}
api.use("/api/push/*", async (c, next) => {
  if (c.req.header("origin") !== new URL(env.ADMIN_URL).origin) return c.json({ error: "Not allowed." }, 403);
  await next();
});
api.post("/api/push/subscribe", async (c) => {
  const st = await staffFor(c.req.raw);
  if (!st) return c.json({ error: "Sign in first." }, 401);
  if (!pushFor()) return c.json({ error: "Notifications aren't set up on this site yet." }, 503);
  const sub = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>().catch(() => ({}) as never);
  const ok = typeof sub?.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && /^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh ?? "") && /^[A-Za-z0-9_-]{16,32}$/.test(sub.keys?.auth ?? "");
  if (!ok) return c.json({ error: "That isn't a valid notification subscription." }, 400);
  await withApp((d) => d.db.query(
    `insert into staff_push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set staff_id = excluded.staff_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0`,
    [st.id, sub.endpoint, sub.keys!.p256dh, sub.keys!.auth, (c.req.header("user-agent") ?? "").slice(0, 300)]));
  return c.json({ ok: true });
});
api.post("/api/push/unsubscribe", async (c) => {
  const st = await staffFor(c.req.raw);
  if (!st) return c.json({ error: "Sign in first." }, 401);
  const { endpoint } = await c.req.json<{ endpoint?: string }>().catch(() => ({}) as never);
  if (typeof endpoint === "string") await withApp((d) => d.db.query("delete from staff_push_subscriptions where endpoint = $1 and staff_id = $2", [endpoint, st.id]));
  return c.json({ ok: true });
});
api.post("/api/push/test", async (c) => {
  const st = await staffFor(c.req.raw);
  const cfg = pushFor();
  if (!st || !cfg) return c.json({ error: "Not available." }, 400);
  const subs = await withApp((d) => d.db.query("select endpoint, p256dh, auth from staff_push_subscriptions where staff_id = $1", [st.id]));
  await Promise.all(subs.rows.map((s: { endpoint: string; p256dh: string; auth: string }) =>
    sendPush(cfg, s, { title: "NosHen staff test", body: "This is a test you asked for. Disputes, payments to check and failed payouts will arrive like this.", url: "/", tag: "staff-test" }).catch(() => "failed")));
  return c.json({ ok: true });
});

api.get("/photos/*", async (c) => {
  const st = await staffOf(c.req.raw);
  if (!st || typeof st === "string" || !st.twoFactorEnabled) return c.text("Not found", 404);
  const res = await servePhoto(decodeURIComponent(c.req.path.slice("/photos/".length)));
  const headers = new Headers(res.headers);
  // Evidence can be private: only this staff member's browser may keep a copy.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(res.body, { status: res.status, headers });
});

api.get("/videos/*", async (c) => {
  const st = await staffOf(c.req.raw);
  if (!st || typeof st === "string" || !st.twoFactorEnabled) return c.text("Not found", 404);
  const res = await serveVideo(c.req.raw, decodeURIComponent(c.req.path.slice("/videos/".length)), c.req.query("poster") ? "poster" : undefined);
  const headers = new Headers(res.headers);
  // As with photos: only this staff member's browser may keep a copy.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(res.body, { status: res.status, headers });
});

api.onError((e, c) => {
  console.error(e);
  return c.json({ error: "Something went wrong on our side." }, 500);
});
