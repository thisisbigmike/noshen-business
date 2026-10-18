import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/confirm";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "@noshen/engine/queries";
import { confirmReceived, releaseNextStage } from "@noshen/engine/deals";
import { BottomAction, Button, ErrorText, Info, MoneyStatus, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { firstName } from "@noshen/shared/deal";
import { categoryOf, checksFor } from "@noshen/shared/categories";
import { useT } from "@noshen/ui/i18n";
import { PackingPhotos } from "../lib/delivery";
import { nextStage, stageAmount, type DealStage } from "../lib/stages";

export const handle = { tabs: false };
export const meta = () => [{ title: "Check it, then release · NosHen" }];

/**
 * A delivery arrived, or a stage of a job is done: the buyer goes through the checks for that kind of item (or job)
 * before the money is released.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.buyer_id !== user.id) throw data("Not found", { status: 404 });
    const next = v.deal.kind === "service" ? nextStage(v.stages as DealStage[]) : null;
    const waiting = v.deal.kind === "service" ? !!next : v.deal.handover === "delivery" && !!(v.deal.sent_at || v.deal.delivered_at);
    if (v.deal.state !== "held" || !waiting || v.deal.review_hold) throw redirect(`/d/${params.id}`);
    return {
      // For a job, the stage being released and what it comes to.
      stage: next ? { title: next.title, amount: stageAmount(next, "buyer", v.deal.fee_payer) } : null,
      dealId: v.deal.id, share: v.deal.seller_share_kobo as string, seller: firstName(v.seller.name), title: v.listing.title as string,
      category: v.listing.category as string, imei: v.listing.imei_or_serial as string | null, packing: (v.deal.packing_photo_keys ?? []) as string[],
    };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const deal = await dealView(d.db, params.id);
      return deal?.deal.kind === "service" ? releaseNextStage(d, user.id, params.id) : confirmReceived(d, user.id, params.id);
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/d/${params.id}`);
}

export default function Confirm({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const items = checksFor(x.category, x.seller, x.imei, t, true);
  const [checks, setChecks] = useState<boolean[]>(items.map(() => false));
  const all = checks.every(Boolean);
  const stage = x.stage ? t(x.stage.title) : null;
  const heading = stage ? t("Check “{stage}”, then release", { stage }) : t("Check it, then release");
  return (
    <Form method="post">
      <TopBar title={heading} back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">{heading}</h1>
        <div className="row"><MoneyStatus state="held">{t("{amount} held", { amount: naira(x.stage ? x.stage.amount : x.share) })}</MoneyStatus></div>
        <section className="card">
          <p className="label" style={{ marginBottom: 4 }}>{stage ? t("Check the work first") : t("Check the {thing} first", { thing: categoryOf(x.category).noun })}</p>
          {items.map(([label, hint], i) => (
            <label key={label} className="check">
              <input type="checkbox" checked={checks[i]} onChange={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} />
              <span className="stack" style={{ gap: 2 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span>
            </label>
          ))}
        </section>
        {x.packing.length ? (
          <section className="card stack">
            <p className="label">{t("What {name} packed", { name: x.seller })}</p>
            <PackingPhotos keys={x.packing} title={x.title} />
            <p className="caption muted">{t("It should match what arrived.")}</p>
          </section>
        ) : null}
        <Info icon="lock">{x.stage
          ? (all
            ? t("Releasing pays {name} {amount} for “{stage}”. It can't be undone, so only release if you're happy with the work so far.", { name: x.seller, amount: naira(x.stage.amount), stage: stage! })
            : t("Tick all three checks to release {amount} for “{stage}” to {name}.", { name: x.seller, amount: naira(x.stage.amount), stage: stage! }))
          : all
          ? t("Releasing pays {name}. It can't be undone, so only release if you're happy with it.", { name: x.seller })
          : t("Tick all three checks to release the money to {name}.", { name: x.seller })}</Info>
        <p className="body">{t.rich("Something's wrong? <report>Report a problem</report>. The money stays held.", { report: (s) => <Link to={`/d/${x.dealId}/report`}>{s}</Link> })}</p>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={!all || busy}>{busy ? t("Releasing…") : x.stage ? t("I'm happy: release {amount}", { amount: naira(x.stage.amount) }) : t("I'm happy: release the money")}</Button></BottomAction>
      </main>
    </Form>
  );
}
