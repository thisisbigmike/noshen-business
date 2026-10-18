import { type Deps, DealError } from "./core";
import { many } from "./db";
import { emailProblem } from "@noshen/shared/validate";
import { isMarket, marketOf } from "@noshen/shared/locations";
import { msg } from "@noshen/shared/i18n";

/** Puts someone on the waitlist for a country NosHen hasn't opened in yet. Joining twice is fine: nothing changes. */
export async function joinWaitlist(d: Deps, email: string, country: string, lang?: string) {
  const address = email.trim().toLowerCase();
  const problem = emailProblem(address);
  if (problem) throw new DealError("email", problem);
  if (!isMarket(country) || marketOf(country).live) throw new DealError("country", msg("Choose a country NosHen is coming to."));
  await d.db.query("insert into waitlist (email, country, lang) values ($1, $2, $3) on conflict (email, country) do nothing",
    [address, country, lang === "pcm" ? "pcm" : "en"]);
}

/** How many are waiting, by country, for the staff dashboard. */
export async function waitlistCounts(db: Deps["db"]): Promise<{ country: string; n: number }[]> {
  return (await many<{ country: string; n: string }>(db, "select country, count(*) as n from waitlist group by country order by count(*) desc"))
    .map((r) => ({ country: r.country, n: Number(r.n) }));
}
