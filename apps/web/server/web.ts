import { redirect } from "react-router";
import { pagePath } from "@noshen/engine/http";
import { createAuth } from "./auth";
import { withApp, mailFor } from "@noshen/engine/context";
import type { Deps } from "@noshen/engine/core";
import { one } from "@noshen/engine/db";
import { cleanCountry } from "@noshen/shared/payments";
import { langFromRequest, loadCatalog, translator, type T } from "@noshen/shared/i18n";

export interface AppUser {
  id: string; email: string | null; phone: string | null; full_name: string | null; status: string; auth_user_id: string;
}

// One look-up per request, however many loaders ask.
const sessions = new WeakMap<Request, ReturnType<Awaited<ReturnType<typeof createAuth>>["api"]["getSession"]>>();

/**
 * The visitor's sign-in session. Without a session cookie there can't be one, so the sign-in system isn't even
 * set up: most visitors are browsing signed out, and setting it up is most of a page's CPU time.
 */
async function sessionOf(request: Request) {
  if (!/(^|;\s*)(__Secure-)?better-auth\.session_token=/.test(request.headers.get("Cookie") ?? "")) return null;
  let s = sessions.get(request);
  if (!s) {
    s = createAuth(mailFor()).then((auth) => auth.api.getSession({ headers: request.headers }));
    sessions.set(request, s);
  }
  return s;
}

/** A real name from the sign-in provider (Google gives one; an email code doesn't). */
function realName(name: string | null | undefined, email: string) {
  const n = (name ?? "").trim();
  return n && n !== email && !n.includes("@") && n.split(/\s+/).length >= 2 ? n.slice(0, 120) : null;
}

/** The signed-in buyer or seller, creating their NosHen profile the first time they sign in. */
export async function optionalUser(request: Request, d?: Deps): Promise<AppUser | null> {
  const s = await sessionOf(request);
  if (!s?.user?.email) return null;
  const email = s.user.email.toLowerCase();
  const run = async (dd: Deps) => {
    if (await one(dd.db, "select 1 from staff where auth_user_id = $1", [s.user.id])) return null; // staff aren't buyers or sellers
    const cols = "id, email, phone, full_name, status, auth_user_id";
    let u = await one<AppUser>(dd.db, `select ${cols} from users where auth_user_id = $1`, [s.user.id]);
    if (!u) {
      u = await one<AppUser>(dd.db,
        `insert into users (email, full_name, auth_user_id, signup_source) values ($1, $2, $3, 'web')
         on conflict (email) do update set auth_user_id = excluded.auth_user_id
         returning ${cols}`, [email, realName(s.user.name, email), s.user.id]);
    }
    return u;
  };
  return d ? run(d) : withApp(run);
}

export async function requireUser(request: Request, d?: Deps): Promise<AppUser> {
  const u = await optionalUser(request, d);
  if (!u) {
    throw redirect(`/signin?next=${encodeURIComponent(pagePath(request))}`);
  }
  if (u.status !== "active") throw redirect("/account?paused=1");
  return u;
}

/** The visitor's country (set by the worker from Cloudflare). Nigeria when it isn't known, as on this computer. */
export const countryOf = (request: Request) => cleanCountry(request.headers.get("x-noshen-country")) ?? "NG";

/** The reader's language, for messages an action writes itself (most come from the engine, in English). */
export async function translatorFor(request: Request): Promise<T> {
  const lang = langFromRequest(request.headers.get("Cookie"), request.headers.get("Accept-Language"));
  await loadCatalog(lang);
  return translator(lang);
}

export { pagePath, messageOf } from "@noshen/engine/http";
export { withApp };
