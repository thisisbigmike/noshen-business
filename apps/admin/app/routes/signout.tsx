import { redirect } from "react-router";
import type { Route } from "./+types/signout";
import { createAuth } from "../../server/auth";

export async function action({ request }: Route.ActionArgs) {
  const res = await createAuth().api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers();
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return redirect("/signin", { headers });
}

export const loader = () => redirect("/");
