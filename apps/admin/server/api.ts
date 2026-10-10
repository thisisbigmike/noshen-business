import { Hono } from "hono";
import { createAuth } from "./auth";
import { staffOf } from "./web";
import { servePhoto } from "@noshen/engine/photos";

/** The staff site's endpoints: its own sign-in, and photos (listing photos and dispute evidence) for staff only. */
export const api = new Hono();

api.on(["GET", "POST"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

api.get("/photos/*", async (c) => {
  const st = await staffOf(c.req.raw);
  if (!st || typeof st === "string" || !st.twoFactorEnabled) return c.text("Not found", 404);
  const res = await servePhoto(decodeURIComponent(c.req.path.slice("/photos/".length)));
  const headers = new Headers(res.headers);
  // Evidence can be private: only this staff member's browser may keep a copy.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(res.body, { status: res.status, headers });
});

api.onError((e, c) => {
  console.error(e);
  return c.json({ error: "Something went wrong on our side." }, 500);
});
