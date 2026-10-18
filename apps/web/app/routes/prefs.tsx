import { redirect } from "react-router";
import type { Route } from "./+types/prefs";
import { isLang, LANG_COOKIE } from "@noshen/shared/i18n";
import { DATA_COOKIE } from "@noshen/shared/data-saver";

const YEAR = 60 * 60 * 24 * 365;

/**
 * Saves the language and data saver in cookies, then goes back to the page. A plain form post, so the switches work
 * without JavaScript too (Opera Mini, and phones on a slow connection before the page's script has loaded).
 */
export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const headers = new Headers();
  const lang = f.get("lang");
  if (isLang(lang)) headers.append("Set-Cookie", `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${YEAR}; SameSite=Lax`);
  const data = f.get("data");
  if (data === "lite" || data === "full") headers.append("Set-Cookie", `${DATA_COOKIE}=${data}; Path=/; Max-Age=${YEAR}; SameSite=Lax`);
  const next = String(f.get("next") ?? "/");
  return redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/", { headers });
}

export const loader = () => redirect("/");
