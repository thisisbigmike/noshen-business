import { redirect } from "react-router";
import type { Route } from "./+types/waitlist";
import { withApp, messageOf } from "../../server/web";
import { joinWaitlist } from "@noshen/engine/waitlist";
import { langFromRequest } from "@noshen/shared/i18n";

const back = (next: string) => (next.startsWith("/") && !next.startsWith("//") ? next : "/");

/** Joins the waitlist for a country, then goes back to the page, which says so. A plain form post: works without JavaScript. */
export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const next = back(String(f.get("next") ?? "/"));
  const country = String(f.get("country") ?? "");
  try {
    await withApp((d) => joinWaitlist(d, String(f.get("email") ?? ""), country,
      langFromRequest(request.headers.get("Cookie"), request.headers.get("Accept-Language"))));
  } catch (e) {
    const u = new URL(next, "http://x");
    u.searchParams.set("waitlist_error", messageOf(e));
    return redirect(u.pathname + u.search);
  }
  const u = new URL(next, "http://x");
  u.searchParams.set("joined", country);
  return redirect(u.pathname + u.search);
}

export const loader = () => redirect("/");
