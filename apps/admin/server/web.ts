import { redirect } from "react-router";
import { createAuth } from "./auth";
import { ACCESS_EMAIL_HEADER } from "./access";
import { withApp } from "@noshen/engine/context";
import { one } from "@noshen/engine/db";

export interface StaffUser {
  id: string; name: string; email: string; role: "reviewer" | "admin"; twoFactorEnabled: boolean;
}

/**
 * The signed-in staff member, or null. When Cloudflare Access is on, the staff account must belong to
 * the same person Access let in: a stolen session cookie alone isn't enough.
 */
export async function staffOf(request: Request): Promise<StaffUser | "not-staff" | "access-mismatch" | null> {
  const s = await createAuth().api.getSession({ headers: request.headers });
  if (!s?.user) return null;
  const st = await withApp((d) => one(d.db, "select id, name, role, status from staff where auth_user_id = $1", [s.user.id]));
  if (!st || st.status !== "active") return "not-staff";
  const accessEmail = request.headers.get(ACCESS_EMAIL_HEADER);
  if (accessEmail && accessEmail !== s.user.email.toLowerCase()) return "access-mismatch";
  return { id: st.id, name: st.name, email: s.user.email, role: st.role, twoFactorEnabled: !!s.user.twoFactorEnabled };
}

/** Staff must be signed in, active, and have two-factor turned on (otherwise they're sent to set it up). */
export async function requireStaff(request: Request, opts: { allowWithout2fa?: boolean } = {}): Promise<StaffUser> {
  const st = await staffOf(request);
  if (!st) throw redirect("/signin");
  if (st === "not-staff" || st === "access-mismatch") throw redirect(`/signin?error=${st}`);
  if (!st.twoFactorEnabled && !opts.allowWithout2fa) throw redirect("/setup-2fa");
  return st;
}

export { pagePath, messageOf } from "@noshen/engine/http";
export { withApp };
