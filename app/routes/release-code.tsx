import { useState } from "react";
import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/release-code";
import { requireUser, withApp } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { releaseCodeForBuyer } from "../../server/engine/deals";
import { Info, ReleaseCode, TopBar, MoneyStatus } from "../components/ui";
import { naira } from "../../shared/money";
import { firstName } from "../../shared/deal";

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
  const [checks, setChecks] = useState({ on: false, lock: false, imei: false });
  const all = checks.on && checks.lock && checks.imei;
  const items: [keyof typeof checks, string, string][] = [
    ["on", "It switches on and works", x.category === "phone" ? "Make a call. Try the camera and the screen." : "Open a few apps. Check the keyboard, screen and charging."],
    ["lock", "It isn’t locked to someone else’s account", x.category === "phone" ? `Settings should show no other Apple ID or Google account. Ask ${x.seller} to sign out in front of you.` : `No other user account or activation lock. Ask ${x.seller} to sign out in front of you.`],
    ["imei", x.category === "phone" ? "The IMEI matches the listing" : "The serial number matches the listing", x.category === "phone" ? `Dial *#06#. It should show ${x.imei ?? "the IMEI on the listing"}.` : `It should be ${x.imei ?? "the serial number on the listing"}.`],
  ];
  return (
    <div>
      <TopBar title="Release code" back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <div className="row"><MoneyStatus state="held">{naira(x.paid)} held</MoneyStatus></div>
        <section className="card">
          <p className="label" style={{ marginBottom: 4 }}>Check the {x.category} first</p>
          {items.map(([k, label, hint]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={checks[k]} onChange={() => setChecks({ ...checks, [k]: !checks[k] })} />
              <span className="stack" style={{ gap: 2 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span>
            </label>
          ))}
        </section>
        {all ? (
          <ReleaseCode code={x.code} help={`${x.seller} types this code into their phone. Never send it by chat, SMS or a call.`} />
        ) : (
          <Info icon="lock">Tick all three checks to see your code. Giving it releases your money to {x.seller}.</Info>
        )}
        <p className="body">Something's wrong? <Link to={`/d/${x.dealId}/report`}>Report a problem</Link>. The money stays held.</p>
      </main>
    </div>
  );
}
