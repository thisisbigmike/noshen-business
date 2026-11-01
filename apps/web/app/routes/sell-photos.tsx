import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-photos";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft } from "@noshen/engine/sellers";
import { deleteVideo, storePhoto, storeVideo } from "@noshen/engine/photos";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, ErrorText, Icon, TopBar } from "@noshen/ui/ui";
import { categoryOf } from "@noshen/shared/categories";
import { clock, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, photoUrl, posterUrl, videoUrl } from "@noshen/shared/photos";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { shrinkPhotos } from "@noshen/ui/shrink";
import { shrinkVideo } from "@noshen/ui/shrink-video";
import { MAX_PHOTOS, MIN_PHOTOS, photoShots } from "@noshen/shared/photo-shots";
import { SellSteps } from "../lib/sell-steps";
import { SellHelp } from "../lib/sell-help";
import { settingsOf } from "@noshen/engine/core";
import { photosFrom } from "@noshen/engine/photos";

export const handle = { tabs: false };
export const meta = () => [{ title: "Photos · Sell · NosHen" }];

/** The seller's draft, or a 404. A listing that's already published goes to its share screen. */
async function draftFor(d: Parameters<Parameters<typeof withApp>[0]>[0], userId: string, id: string) {
  const l = await one<{ id: string; seller_id: string; status: string; category: string; photo_keys: string[] | null; video_key: string | null; video_seconds: number | null }>(d.db,
    "select id, seller_id, status, category, photo_keys, video_key, video_seconds from listings where id = $1", [id]);
  if (!l || l.seller_id !== userId) throw data("Not found", { status: 404 });
  if (l.status !== "draft") throw redirect(`/sell/${l.id}/share`);
  return l;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await draftFor(d, user.id, params.id);
    return {
      draftId: l.id, category: l.category, photos: (l.photo_keys ?? []) as string[], video: l.video_key, videoSeconds: l.video_seconds,
      help: (await settingsOf(d)).support_whatsapp,
    };
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
      if (intent === "video") {
        const file = (k: string) => { const f = form.get(k); return f instanceof File && f.size > 0 ? f : null; };
        const video = file("video");
        if (!video) return { error: msg("Choose a video.") };
        const key = await storeVideo(`listings/${user.id}`, video, file("video_small"), file("video_poster"));
        const s = Number(form.get("video_seconds") || NaN);
        await d.db.query("update listings set video_key = $2, video_seconds = $3 where id = $1",
          [draft.id, key, Number.isFinite(s) ? Math.min(600, Math.max(0, Math.round(s))) : null]);
        // A draft's video was never shown to a buyer, so the one it replaces can go.
        if (draft.video_key) await deleteVideo(draft.video_key);
        return { ok: true };
      }
      if (intent === "remove-video") {
        await d.db.query("update listings set video_key = null, video_seconds = null where id = $1", [draft.id]);
        if (draft.video_key) await deleteVideo(draft.video_key);
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
/** The file input the "Add a video" box opens. */
const VIDEO_PICK = "video-pick";

/**
 * Step 2 of selling: the three photos a buyer will want for this kind of item, one at a time, then up to five
 * more, and a short video if the seller likes. Each is made smaller on the phone first (see @noshen/ui/shrink and
 * @noshen/ui/shrink-video), then sent.
 */
export default function SellPhotos({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const nav = useNavigation();
  const [shrinking, setShrinking] = useState(false);
  // How much of the chosen video the phone has converted (0 to 1), while it works on it.
  const [prep, setPrep] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const busy = nav.state !== "idle" || shrinking || prep !== null;
  const sendingVideo = nav.state === "submitting" && nav.formData?.get("intent") === "video";
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

        <Form method="post" encType="multipart/form-data" className="sr-only">
          <input type="hidden" name="intent" value="video" />
          <input id={VIDEO_PICK} type="file" name="video" accept="video/*" aria-label={t("Add a video")} onChange={async (e) => {
            const input = e.currentTarget;
            const form = input.form;
            const chosen = input.files?.[0];
            if (!chosen || !form || prep !== null) return;
            setVideoError(null);
            setPrep(0);
            const out = await shrinkVideo(chosen, setPrep).finally(() => setPrep(null));
            if (out.file.size > MAX_VIDEO_BYTES) {
              input.value = "";
              setVideoError(t("That video is too big to send. Try a shorter one, under 50 MB."));
              return;
            }
            // The converted video, its light copy and its still frame go in the form in place of what was chosen.
            const put = (el: HTMLInputElement | null, f: File | null) => {
              if (!el || typeof DataTransfer !== "function") return;
              const files = new DataTransfer();
              if (f) files.items.add(f);
              el.files = files.files;
            };
            put(input, out.file);
            put(form.querySelector<HTMLInputElement>("input[name=video_small]"), out.small);
            put(form.querySelector<HTMLInputElement>("input[name=video_poster]"), out.poster);
            const seconds = form.querySelector<HTMLInputElement>("input[name=video_seconds]");
            if (seconds) seconds.value = out.seconds === null ? "" : String(out.seconds);
            form.requestSubmit();
          }} />
          <input type="file" name="video_small" hidden tabIndex={-1} aria-hidden="true" />
          <input type="file" name="video_poster" hidden tabIndex={-1} aria-hidden="true" />
          <input type="hidden" name="video_seconds" />
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

        {n >= MIN_PHOTOS ? (
          <section className="stack" aria-labelledby="video-head">
            <p id="video-head" className="label">{t("Video (optional)")}</p>
            {x.video ? (
              <div className="sell-video">
                <video src={videoUrl(x.video)} poster={posterUrl(x.video)} controls playsInline preload="metadata" aria-label={t("Your video")} />
                {x.videoSeconds !== null ? <span className="tag">{clock(x.videoSeconds)}</span> : null}
                <Form method="post" className="shot-remove">
                  <input type="hidden" name="intent" value="remove-video" />
                  <button className="icon-btn" aria-label={t("Remove the video")} disabled={busy}><Icon name="x" size={16} /></button>
                </Form>
              </div>
            ) : (
              <label htmlFor={VIDEO_PICK} className={`sell-video-add${prep !== null || sendingVideo ? " working" : ""}`} aria-disabled={busy || undefined}>
                <span className="sell-video-icon" aria-hidden="true"><Icon name="video" size={22} /></span>
                <span className="sell-video-text">
                  <span className="label">{prep !== null ? t("Getting your video ready… {n}%", { n: Math.round(prep * 100) }) : sendingVideo ? t("Sending your video…") : t("Add a video")}</span>
                  <span className="caption muted">{t("Up to {n} seconds. Show it working and all round it: buyers trust what they can see.", { n: MAX_VIDEO_SECONDS })}</span>
                </span>
                {prep !== null || sendingVideo ? (
                  <span className={`sell-video-bar${sendingVideo ? " sending" : ""}`} aria-hidden="true"><span style={{ width: `${Math.round((prep ?? 1) * 100)}%` }} /></span>
                ) : null}
              </label>
            )}
          </section>
        ) : null}

        <ul className="photo-tips" aria-label={t("Photo tips")}>
          <li><Icon name="sun" size={18} />{t("Daylight, no filters")}</li>
          <li><Icon name="photo" size={18} />{t("Front, back and sides")}</li>
          <li><Icon name="eye" size={18} />{t("Show any damage")}</li>
        </ul>
        <ErrorText>{videoError ?? (actionData as any)?.error}</ErrorText>
        <SellHelp whatsapp={x.help} step={t("Photos")} />
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
