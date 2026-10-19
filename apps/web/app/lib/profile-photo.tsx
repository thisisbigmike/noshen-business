// The profile picture in Account: add, change or remove it. Made smaller on the phone first (see @noshen/ui/shrink),
// then sent; the page saves it as soon as a photo is picked.
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Avatar, ErrorText, Icon } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { shrinkPhotos } from "@noshen/ui/shrink";

export function ProfilePhoto({ name, photo, error }: { name: string; photo: string | null; error?: string | null }) {
  const t = useT();
  const nav = useNavigation();
  const [shrinking, setShrinking] = useState(false);
  const saving = nav.state !== "idle" && String(nav.formData?.get("intent") ?? "").startsWith("photo_");
  const busy = shrinking || saving;
  return (
    <div className="profile-photo">
      <Avatar name={name} photo={photo} size={72} />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <p className="title">{name}</p>
        <div className="row wrap" style={{ gap: 12 }}>
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="photo_upload" />
            <label className="link-btn photo-pick-label" aria-disabled={busy || undefined}>
              <Icon name="camera" size={16} />{busy ? t("Saving…") : photo ? t("Change photo") : t("Add a profile photo")}
              {/* Not disabled while busy: a disabled input isn't sent with the form. */}
              <input type="file" name="photo" accept="image/*" className="sr-only" onChange={async (e) => {
                const input = e.currentTarget;
                if (shrinking || !input.files?.length) return;
                const small = input.form?.querySelector<HTMLInputElement>("input[name=photo_small]") ?? null;
                setShrinking(true);
                await shrinkPhotos(input, small).finally(() => setShrinking(false));
                input.form?.requestSubmit();
              }} />
              <input type="file" name="photo_small" hidden tabIndex={-1} aria-hidden="true" />
            </label>
          </Form>
          {photo ? (
            <Form method="post"><input type="hidden" name="intent" value="photo_remove" /><button type="submit" className="link-btn caption" disabled={busy}>{t("Remove")}</button></Form>
          ) : null}
        </div>
        <p className="caption muted">{t("A clear photo of you or your shop's logo. Buyers see it with your name. Never someone else's photo, or a bank's or NosHen's logo.")}</p>
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
