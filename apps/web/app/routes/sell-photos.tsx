import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-photos";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft } from "@noshen/engine/sellers";
import { storePhoto } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, Info, TopBar } from "@noshen/ui/ui";
import { categoryOf } from "@noshen/shared/categories";
import { photoUrl } from "@noshen/shared/photos";

export const handle = { tabs: false };
export const meta = () => [{ title: "Photos · Sell · NosHen" }];

/** The seller's draft, or a 404. A listing that's already published goes to its share screen. */
async function draftFor(d: Parameters<Parameters<typeof withApp>[0]>[0], userId: string, id: string) {
  const l = await one<{ id: string; seller_id: string; status: string; category: string; photo_keys: string[] | null }>(d.db,
    "select id, seller_id, status, category, photo_keys from listings where id = $1", [id]);
  if (!l || l.seller_id !== userId) throw data("Not found", { status: 404 });
  if (l.status !== "draft") throw redirect(`/sell/${l.id}/share`);
  return l;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await draftFor(d, user.id, params.id);
    return { draftId: l.id, category: l.category, photos: (l.photo_keys ?? []) as string[] };
  });
}

/** What a buyer will want to see in the photos, by category. */
const PHOTO_HINT: Record<string, string> = {
  phone: "Show the IMEI screen (dial *#06#), the screen switched on, and the back and sides.",
  laptop: "Show it switched on, the keyboard, the screen, and the label with the serial number underneath.",
  electronics: "Show it switched on and working, the model label, and any remote or cables that come with it.",
  fashion: "Show the size label, the front and back, and close-ups of the fabric and any marks.",
  shoes: "Show the size label inside, both shoes from the side, and the soles.",
  hair: "Show the length laid out, the lace or closure, and the colour in daylight.",
  beauty: "Show the seal or batch number, and how full it is. Sealed items sell faster.",
  jewellery: "Show any hallmark or brand mark, the clasp, and the item on a plain background.",
  home: "Show the whole item, close-ups of any wear, and a tape measure for the size.",
  vehicle: "Show all four sides, the dashboard with the mileage, the engine, and the papers (cover your personal details).",
  baby: "Show the whole item, any safety labels, and where it folds or clips.",
  sports: "Show the whole item, the size or weight, and any wear.",
  other: "Show the whole item from a few sides, and any marks or damage.",
};

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    return await withApp(async (d) => {
      const user = await requireUser(request, d);
      const draft = await draftFor(d, user.id, params.id);
      let keys: string[] = draft.photo_keys ?? [];
      if (intent === "upload") {
        for (const f of form.getAll("photos")) {
          if (f instanceof File && f.size > 0 && keys.length < 8) keys.push(await storePhoto(`listings/${user.id}`, f));
        }
        await saveDraft(d, user.id, draft.id, keys, null);
        return { ok: true };
      }
      if (intent === "remove") {
        keys = keys.filter((k) => k !== form.get("key"));
        await d.db.query("update listings set photo_keys = $2 where id = $1", [draft.id, keys]);
        return { ok: true };
      }
      if (intent === "next") {
        if (keys.length < 3) return { error: "Add at least 3 photos." };
        throw redirect(`/sell/${draft.id}/details`);
      }
      return null;
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

export default function SellPhotos({ loaderData: x, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const n = x.photos.length;
  return (
    <div>
      <TopBar title={<span>Photos <span className="caption muted">Step 2 of 3</span></span>} back="/sell" />
      <main className="page narrow stack-4">
        <div className="stack">
          <h1 className="heading">Add photos</h1>
          <p className="body muted">Add at least 3. Clear, honest photos sell faster.</p>
          <p className="caption muted row" style={{ gap: 6 }}><Icon name={categoryOf(x.category).icon} size={16} />{categoryOf(x.category).label} · <Link to="/sell">Change</Link></p>
        </div>
        <div className="photo-grid">
          {x.photos.map((k, i) => (
            <div key={k} className="photo-slot">
              <img src={photoUrl(k)} alt={`Photo ${i + 1}`} />
              {i === 0 ? <span className="tag">Cover</span> : null}
              <Form method="post" style={{ position: "absolute", top: 4, right: 4 }}>
                <input type="hidden" name="intent" value="remove" /><input type="hidden" name="key" value={k} />
                <button className="icon-btn" style={{ width: 32, height: 32, background: "var(--surface)" }} aria-label={`Remove photo ${i + 1}`}><Icon name="x" size={16} /></button>
              </Form>
            </div>
          ))}
          {n < 8 ? (
            <Form method="post" encType="multipart/form-data" className="photo-slot add">
              <input type="hidden" name="intent" value="upload" />
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", width: "100%", height: "100%", justifyContent: "center" }}>
                <Icon name="camera" size={24} />
                <span>{busy ? "Adding…" : "Add photo"}</span>
                <input type="file" name="photos" accept="image/*" multiple className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
              </label>
            </Form>
          ) : null}
        </div>
        <p className="caption muted">{n} added. You can add up to 8.</p>
        <Info icon="info-circle"><strong>Show what a buyer will check.</strong> {PHOTO_HINT[x.category] ?? PHOTO_HINT.other} It builds trust.</Info>
        <section className="card stack">
          <p className="label">Photo tips</p>
          <p className="body muted">Use daylight. No filters or stickers. Show the front, back and sides, and any marks or damage. Honest photos mean fewer problems later.</p>
        </section>
        <ErrorText>{(actionData as any)?.error}</ErrorText>
        <BottomAction>
          <Form method="post"><input type="hidden" name="intent" value="next" /><Button type="submit" variant="primary" size="lg" block disabled={n < 3 || busy}>{n < 3 ? `Add ${3 - n} more photo${3 - n === 1 ? "" : "s"}` : "Next: details"}</Button></Form>
        </BottomAction>
      </main>
    </div>
  );
}
