import { useState } from "react";
import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/release-code";
import { requireUser, withApp } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { releaseCodeForBuyer } from "@noshen/engine/deals";
import { Info, ReleaseCode, TopBar, MoneyStatus } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { categoryOf, checksFor } from "@noshen/shared/categories";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Release code · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "held" || v.deal.review_hold) throw redirect(`/d/${params.id}`);
    const paid = v.payments.reduce((s: number, p: any) => s + Number(p.amount_kobo), 0);
    return {
      dealId: v.deal.id, paid, seller: firstName(v.seller.name), category: v.listing.category as string,
      imei: v.listing.imei_or_serial as string | null, code: await releaseCodeForBuyer(d, user.id, params.id),
    };
  });
}

export default function ReleaseCodePage({ loaderData: x }: Route.ComponentProps) {
  const t = useT();
  const items = checksFor(x.category, x.seller, x.imei, t);
  const [checks, setChecks] = useState<boolean[]>(items.map(() => false));
  const all = checks.every(Boolean);
  const noun = categoryOf(x.category).noun;
  return (
    <div>
      <TopBar title={t("Release code")} back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{t("Release code")}</h1>
        <div className="row"><MoneyStatus state="held">{t("{amount} held", { amount: naira(x.paid) })}</MoneyStatus></div>
        <section className="card">
          <p className="label" style={{ marginBottom: 4 }}>{t("Check the {thing} first", { thing: noun })}</p>
          {items.map(([label, hint], i) => (
            <label key={label} className="check">
              <input type="checkbox" checked={checks[i]} onChange={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} />
              <span className="stack" style={{ gap: 2 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span>
            </label>
          ))}
        </section>
        {all ? (
          <ReleaseCode code={x.code} help={t("{name} types this code into their phone. Never send it by chat, SMS or a call.", { name: x.seller })} />
        ) : (
          <Info icon="lock">{t("Tick all three checks to see your code. Giving it releases your money to {name}.", { name: x.seller })}</Info>
        )}
        <p className="body">{t.rich("Something's wrong? <report>Report a problem</report>. The money stays held.", { report: (s) => <Link to={`/d/${x.dealId}/report`}>{s}</Link> })}</p>
      </main>
    </div>
  );
}
