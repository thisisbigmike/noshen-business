import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell";
import { SellSteps } from "../lib/sell-steps";
import { SellHelp } from "../lib/sell-help";
import { settingsOf } from "@noshen/engine/core";
import { requireUser, withApp, messageOf } from "../../server/web";
import { sellerReady, startListing } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { ErrorText, Icon, Info, TopBar } from "@noshen/ui/ui";
import { CATEGORIES, categoryOf } from "@noshen/shared/categories";
import { useMarket, useT } from "@noshen/ui/i18n";
import { marketOf } from "@noshen/shared/locations";

export const meta = () => [{ title: "Sell · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    // A listing the seller started and didn't finish: offer to carry on with it.
    const draft = await one<{ id: string; category: string; title: string; photo_keys: string[] | null }>(d.db,
      "select id, category, title, photo_keys from listings where seller_id = $1 and status = 'draft' order by created_at desc limit 1", [user.id]);
    const photos = draft?.photo_keys?.length ?? 0;
    return {
      draft: draft && (photos > 0 || draft.title !== "Untitled listing")
        ? { id: draft.id, category: draft.category, title: draft.title === "Untitled listing" ? null : draft.title, photos, next: photos >= 3 ? "details" : "photos" }
        : null,
      ready: await sellerReady(d, user.id),
      help: (await settingsOf(d)).support_whatsapp,
    };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const id = await withApp(async (d) => {
      const user = await requireUser(request, d);
      return startListing(d, user.id, String(form.get("category") ?? ""));
    });
    return redirect(`/sell/${id}/photos`);
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

/** Step 1 of selling: what it is. One tap on a category moves on to the photos. */
export default function SellStart({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const market = useMarket();
  const nav = useNavigation();
  const choosing = nav.state !== "idle" ? String(nav.formData?.get("category") ?? "") : "";
  const draftCat = x.draft ? categoryOf(x.draft.category) : null;
  return (
    <div>
      <TopBar title={t("Sell")} back="/browse" />
      <main className="page narrow stack-4">
        <SellSteps at={1} id={x.draft?.id} />
        <div className="stack">
          <h1 className="heading">{t("What are you selling?")}</h1>
          <p className="body muted">{t("Pick one. Next you'll add photos, then the price and details.")}</p>
        </div>

        {market !== "NG" ? <Info icon="world">{t("NosHen works in Nigeria for now: you can sell an item that's in Nigeria. {country} is coming soon.", { country: t(marketOf(market).name) })}</Info> : null}

        {x.draft && draftCat ? (
          <Link to={`/sell/${x.draft.id}/${x.draft.next}`} className="resume-card" prefetch="intent">
            <span className="cat-icon"><Icon name={draftCat.icon} size={22} /></span>
            <span className="grow stack" style={{ gap: 0 }}>
              <span className="label">{t("Carry on with your {what} listing", { what: x.draft.title ? `“${x.draft.title}”` : t(draftCat.label).toLowerCase() })}</span>
              <span className="caption muted">{x.draft.photos === 1 ? t("1 photo added. Pick a category below to change it.") : t("{n} photos added. Pick a category below to change it.", { n: x.draft.photos })}</span>
            </span>
            <Icon name="chevron-right" size={20} />
          </Link>
        ) : null}

        <Form method="post" className="cat-grid cat-start" aria-label={t("Categories")}>
          {CATEGORIES.map((c) => (
            <button key={c.key} type="submit" name="category" value={c.key} className="cat-choice" aria-busy={choosing === c.key || undefined}
              disabled={!!choosing} aria-pressed={x.draft?.category === c.key && !!x.draft ? true : undefined}>
              <span className="cat-icon"><Icon name={c.icon} size={22} /></span>
              <span className="body">{t(c.label)}</span>
            </button>
          ))}
        </Form>
        <ErrorText>{actionData?.error}</ErrorText>

        {!x.ready.ready ? (
          <Info icon="shield-check">{t.rich("Before your listing goes live, <verify>verify your ID and bank account</verify>. You can start your listing now.", { verify: (s) => <Link to="/account/verify?next=/sell">{s}</Link> })}</Info>
        ) : null}
        <p className="caption muted">{t.rich("Some things can't be sold on NosHen, such as anything stolen or fake. See the <list>prohibited items</list>.", { list: (s) => <Link to="/prohibited-items">{s}</Link> })}</p>
        <SellHelp whatsapp={x.help} step={t("What")} />
      </main>
    </div>
  );
}
