import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell";
import { requireUser, withApp, messageOf } from "../../server/web";
import { sellerReady, startListing } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { ErrorText, Icon, Info, TopBar } from "@noshen/ui/ui";
import { CATEGORIES, categoryOf } from "@noshen/shared/categories";

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
  const nav = useNavigation();
  const choosing = nav.state !== "idle" ? String(nav.formData?.get("category") ?? "") : "";
  const draftCat = x.draft ? categoryOf(x.draft.category) : null;
  return (
    <div>
      <TopBar title={<span>Sell <span className="caption muted">Step 1 of 3</span></span>} back="/browse" />
      <main className="page narrow stack-4">
        <div className="stack">
          <h1 className="heading">What are you selling?</h1>
          <p className="body muted">Pick one. Next you'll add photos, then the price and details.</p>
        </div>

        {x.draft && draftCat ? (
          <Link to={`/sell/${x.draft.id}/${x.draft.next}`} className="resume-card" prefetch="intent">
            <span className="cat-icon"><Icon name={draftCat.icon} size={22} /></span>
            <span className="grow stack" style={{ gap: 0 }}>
              <span className="label">Carry on with your {x.draft.title ? `"${x.draft.title}"` : draftCat.label.toLowerCase()} listing</span>
              <span className="caption muted">{x.draft.photos} photo{x.draft.photos === 1 ? "" : "s"} added. Pick a category below to change it.</span>
            </span>
            <Icon name="chevron-right" size={20} />
          </Link>
        ) : null}

        <Form method="post" className="cat-grid cat-start" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button key={c.key} type="submit" name="category" value={c.key} className="cat-choice" aria-busy={choosing === c.key || undefined}
              disabled={!!choosing} aria-pressed={x.draft?.category === c.key && !!x.draft ? true : undefined}>
              <span className="cat-icon"><Icon name={c.icon} size={22} /></span>
              <span className="body">{c.label}</span>
            </button>
          ))}
        </Form>
        <ErrorText>{actionData?.error}</ErrorText>

        {!x.ready.ready ? (
          <Info icon="shield-check">Before your listing goes live, <Link to="/account/verify?next=/sell">verify your ID and bank account</Link>. You can start your listing now.</Info>
        ) : null}
        <p className="caption muted">Some things can't be sold on NosHen, such as anything stolen or fake. See the <Link to="/prohibited-items">prohibited items</Link>.</p>
      </main>
    </div>
  );
}
