import { redirect } from "react-router";
import { createAuth } from "./auth";
import { withApp, smsFor } from "./context";
import type { Deps } from "./engine/core";
import { DealError } from "./engine/core";
import { one } from "./db";
import { normalisePhone } from "../shared/deal";

export interface AppUser {
  id: string; phone: string; full_name: string | null; status: string; auth_user_id: string;
}

export interface StaffUser {
  id: string; name: string; email: string; role: "reviewer" | "admin"; twoFactorEnabled: boolean;
}

async function sessionOf(request: Request) {
  const auth = createAuth(smsFor());
  return auth.api.getSession({ headers: request.headers });
}

/** The signed-in buyer or seller, creating their NosHen profile the first time they sign in. */
export async function optionalUser(request: Request, d?: Deps): Promise<AppUser | null> {
  const s = await sessionOf(request);
  if (!s?.user) return null;
  const phone = normalisePhone((s.user as any).phoneNumber ?? "");
  if (!phone) return null; // a staff account, not a buyer or seller
  const run = async (dd: Deps) => {
    let u = await one<AppUser>(dd.db, "select id, phone, full_name, status, auth_user_id from users where auth_user_id = $1", [s.user.id]);
    if (!u) {
      u = await one<AppUser>(dd.db,
        `insert into users (phone, auth_user_id) values ($1, $2)
         on conflict (phone) do update set auth_user_id = excluded.auth_user_id
         returning id, phone, full_name, status, auth_user_id`, [phone, s.user.id]);
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

/** Staff must be signed in, active, and have two-factor turned on (otherwise they're sent to set it up). */
export async function requireStaff(request: Request, opts: { allowWithout2fa?: boolean } = {}): Promise<StaffUser> {
  const s = await sessionOf(request);
  if (!s?.user) throw redirect("/staff/signin");
  const st = await withApp((d) => one(d.db, "select id, name, role, status from staff where auth_user_id = $1", [s.user.id]));
  if (!st || st.status !== "active") throw redirect("/staff/signin?error=not-staff");
  const twoFactorEnabled = !!(s.user as any).twoFactorEnabled;
  if (!twoFactorEnabled && !opts.allowWithout2fa) throw redirect("/staff/setup-2fa");
  return { id: st.id, name: st.name, email: s.user.email, role: st.role, twoFactorEnabled };
}

/** The page the person was on, without React Router's internal ".data" suffix and query. */
export function pagePath(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.delete("_routes");
  const path = url.pathname.replace(/\.data$/, "").replace(/^\/_root$/, "/");
  const q = url.searchParams.toString();
  return path + (q ? `?${q}` : "");
}

/** A message safe to show the person: our own refusals as written, anything else generic. */
export function messageOf(e: unknown): string {
  if (e instanceof DealError) return e.message;
  console.error(e);
  return "Something went wrong on our side. Please try again.";
}

export { withApp };
