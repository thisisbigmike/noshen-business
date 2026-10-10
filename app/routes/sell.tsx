import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft, sellerReady } from "../../server/engine/sellers";
import { storePhoto } from "../../server/photos";
import { one } from "../../server/db";
import { BottomAction, Button, ErrorText, Icon, Info, TopBar } from "../components/ui";
import { photoUrl } from "../../shared/photos";

export const meta = () => [{ title: "Sell · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const draft = await one(d.db, "select id, photo_keys from listings where seller_id = $1 and status = 'draft' order by created_at desc limit 1", [user.id]);
    return { draftId: draft?.id ?? null, photos: (draft?.photo_keys ?? []) as string[], ready: await sellerReady(d, user.id) };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    return await withApp(async (d) => {
      const user = await requireUser(request, d);
      const draft = await one(d.db, "select id, photo_keys from listings where seller_id = $1 and status = 'draft' order by created_at desc limit 1", [user.id]);
      let keys: string[] = draft?.photo_keys ?? [];
      if (intent === "upload") {
        for (const f of form.getAll("photos")) {
          if (f instanceof File && f.size > 0 && keys.length < 8) keys.push(await storePhoto(`listings/${user.id}`, f));
        }
        await saveDraft(d, user.id, draft?.id ?? null, keys, null);
        return { ok: true };
      }
      if (intent === "remove" && draft) {
        keys = keys.filter((k) => k !== form.get("key"));
        await d.db.query("update listings set photo_keys = $2 where id = $1", [draft.id, keys]);
        return { ok: true };
      }
      if (intent === "next") {
        if (!draft || keys.length < 3) return { error: "Add at least 3 photos." };
        throw redirect(`/sell/${draft.id}/details`);
      }
      return null;
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

export default function Sell({ loaderData: x, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const n = x.photos.length;
  return (
    <div>
      <TopBar title={<span>Sell <span className="caption muted">Step 1 of 3</span></span>} back="/browse" />
      <main className="page narrow stack-4">
        <div className="stack"><h1 className="heading">Add photos</h1><p className="body muted">Add at least 3. Clear, honest photos sell faster.</p></div>
        {!x.ready.ready ? (
          <Info icon="shield-check">Before your listing goes live, <Link to="/account/verify?next=/sell">verify your ID and bank account</Link>. You can add photos now.</Info>
        ) : null}
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
        <Info icon="info-circle"><strong>Show what a buyer will check.</strong> The IMEI screen for a phone (dial *#06#), the size label for clothes and shoes, the papers for a car (cover your personal details). It builds trust.</Info>
        <section className="card stack">
          <p className="label">Photo tips</p>
          <p className="body muted">Use daylight. No filters or stickers. Show the front, back and sides, and any marks or damage. Honest photos mean fewer problems later.</p>
        </section>
        <ErrorText>{(actionData as any)?.error}</ErrorText>
        <BottomAction>
          <Form method="post"><input type="hidden" name="intent" value="next" /><Button type="submit" variant="primary" size="lg" block disabled={n < 3 || busy}>Next: details</Button></Form>
        </BottomAction>
      </main>
    </div>
  );
}
