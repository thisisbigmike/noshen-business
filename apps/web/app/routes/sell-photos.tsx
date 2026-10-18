import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-photos";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft } from "@noshen/engine/sellers";
import { storePhoto } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, TopBar } from "@noshen/ui/ui";
import { categoryOf } from "@noshen/shared/categories";
import { photoUrl } from "@noshen/shared/photos";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { shrinkPhotos } from "@noshen/ui/shrink";
import { MAX_PHOTOS, MIN_PHOTOS, photoShots } from "@noshen/shared/photo-shots";
import { SellSteps } from "../lib/sell-steps";
import { photosFrom } from "@noshen/engine/photos";

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

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    return await withApp(async (d) => {
      const user = await requireUser(request, d);
      const draft = await draftFor(d, user.id, params.id);
      let keys: string[] = draft.photo_keys ?? [];
      if (intent === "upload") {
        for (const p of photosFrom(form, "photos")) {
          if (keys.length < MAX_PHOTOS) keys.push(await storePhoto(`listings/${user.id}`, p.file, p.small));
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
        if (keys.length < MIN_PHOTOS) return { error: msg("Add at least 3 photos.") };
        throw redirect(`/sell/${draft.id}/details`);
      }
      return null;
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

/** The file input every "take a photo" control opens (the boxes and the bottom button are labels for it). */
const PICK = "photo-pick";

/**
 * Step 2 of selling: the three photos a buyer will want for this kind of item, one at a time, then up to five
 * more. Each is made smaller on the phone first (see @noshen/ui/shrink), then sent.
 */
export default function SellPhotos({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const nav = useNavigation();
  const [shrinking, setShrinking] = useState(false);
  const busy = nav.state !== "idle" || shrinking;
  const n = x.photos.length;
  const shots = photoShots(x.category);
  const remove = (k: string, i: number) => (
    <Form method="post" className="shot-remove">
      <input type="hidden" name="intent" value="remove" /><input type="hidden" name="key" value={k} />
      <button className="icon-btn" aria-label={t("Remove photo {n}", { n: i + 1 })}><Icon name="x" size={16} /></button>
    </Form>
  );
  return (
    <div className="sell-photos">
      <TopBar title={t("Photos")} back="/sell" />
      <main className="page narrow stack-4">
        <SellSteps at={2} id={x.draftId} />
        <div className="stack">
          <h1 className="heading">{t("Add photos")}</h1>
          <p className="body muted">{n < MIN_PHOTOS ? t("Take these 3 photos. You can add more after.") : t("All 3 done. Add more if you like, or go on to the details.")}</p>
          <p className="caption muted row" style={{ gap: 6 }}><Icon name={categoryOf(x.category).icon} size={16} />{t(categoryOf(x.category).label)} · <Link to="/sell">{t("Change")}</Link></p>
        </div>

        <Form method="post" encType="multipart/form-data" className="sr-only">
          <input type="hidden" name="intent" value="upload" />
          <input id={PICK} type="file" name="photos" accept="image/*" multiple disabled={n >= MAX_PHOTOS} aria-label={t("Add photos")} onChange={async (e) => {
            // Not disabled while busy: a disabled input isn't sent with the form. The controls that open it are.
            const input = e.currentTarget;
            if (shrinking) return;
            const small = input.form?.querySelector<HTMLInputElement>("input[name=photos_small]") ?? null;
            setShrinking(true);
            await shrinkPhotos(input, small).finally(() => setShrinking(false));
            input.form?.requestSubmit();
          }} />
          <input type="file" name="photos_small" multiple hidden tabIndex={-1} aria-hidden="true" />
        </Form>

        <ol className="shot-list">
          {shots.map((shot, i) => {
            const key = x.photos[i];
            const next = !key && i === n;
            return (
              <li key={i} className={`shot${key ? " done" : next ? " next" : ""}`}>
                {key ? (
                  <div className="shot-photo"><img src={photoUrl(key, "small")} alt={t(shot.title)} />{i === 0 ? <span className="tag">{t("Cover")}</span> : null}</div>
                ) : next ? (
                  <label htmlFor={PICK} className="shot-photo add" aria-disabled={busy || undefined}><Icon name="camera" size={24} /><span className="caption">{busy ? t("Adding…") : t("Take it")}</span></label>
                ) : (
                  <div className="shot-photo waiting" aria-hidden="true"><Icon name="camera" size={22} /></div>
                )}
                <div className="shot-text">
                  <p className="label row" style={{ gap: 8 }}><span className="shot-n" aria-hidden="true">{key ? <Icon name="check" size={14} /> : i + 1}</span>{t(shot.title)}</p>
                  <p className="caption muted">{t(shot.hint)}</p>
                </div>
                {key ? remove(key, i) : null}
              </li>
            );
          })}
        </ol>

        {n >= MIN_PHOTOS ? (
          <section className="stack" aria-labelledby="more-photos">
            <p id="more-photos" className="label">{t("More photos (optional)")}</p>
            <div className="photo-grid">
              {x.photos.slice(MIN_PHOTOS).map((k, j) => (
                <div key={k} className="photo-slot"><img src={photoUrl(k, "small")} alt={t("Photo {n}", { n: MIN_PHOTOS + j + 1 })} />{remove(k, MIN_PHOTOS + j)}</div>
              ))}
              {n < MAX_PHOTOS ? (
                <label htmlFor={PICK} className="photo-slot add" aria-disabled={busy || undefined}><Icon name="plus" size={22} /><span>{busy ? t("Adding…") : t("Add photo")}</span></label>
              ) : null}
            </div>
            <p className="caption muted">{n < MAX_PHOTOS ? t("You can add {n} more.", { n: MAX_PHOTOS - n }) : t("That's the most: {n} photos.", { n: MAX_PHOTOS })}</p>
          </section>
        ) : null}

        <ul className="photo-tips" aria-label={t("Photo tips")}>
          <li><Icon name="sun" size={18} />{t("Daylight, no filters")}</li>
          <li><Icon name="photo" size={18} />{t("Front, back and sides")}</li>
          <li><Icon name="eye" size={18} />{t("Show any damage")}</li>
        </ul>
        <ErrorText>{(actionData as any)?.error}</ErrorText>
        <BottomAction>
          {n < MIN_PHOTOS ? (
            <label htmlFor={PICK} className="nh-btn nh-btn-primary nh-btn-lg nh-btn-block" aria-disabled={busy || undefined}>
              <Icon name="camera" size={18} />{busy ? t("Adding…") : t("Take photo {n} of 3", { n: n + 1 })}
            </label>
          ) : (
            <Form method="post"><input type="hidden" name="intent" value="next" /><Button type="submit" variant="primary" size="lg" block disabled={busy} iconRight="arrow-right">{t("Next: details")}</Button></Form>
          )}
        </BottomAction>
      </main>
    </div>
  );
}
