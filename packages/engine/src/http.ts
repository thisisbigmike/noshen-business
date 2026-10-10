import { DealError } from "./core";

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
