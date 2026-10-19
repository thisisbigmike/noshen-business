// A seller's social handles, in Account: add one, put the code in that profile's bio, and NosHen checks it. Once
// verified, buyers who look the handle up ("Check a seller") see the seller's track record.
import { useState } from "react";
import { Form, Link } from "react-router";
import { Button, ErrorText, Icon, Select, TextField } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { PLATFORMS, platformOf, profileUrl, type Platform } from "@noshen/shared/social";
import { CopyButton } from "./copy-button";

export interface Handle { id: string; platform: Platform; handle: string; code: string; status: "added" | "submitted" | "verified" | "rejected"; reject_reason: string | null }

export function HandlesCard({ handles, idOk, error }: { handles: Handle[]; idOk: boolean; error?: string | null }) {
  const t = useT();
  const [platform, setPlatform] = useState<string>("instagram");
  return (
    <section className="card stack-4" aria-labelledby="handles-title">
      <div className="stack" style={{ gap: 4 }}>
        <p className="title" id="handles-title">{t("Your social handles")}</p>
        <p className="caption muted">{t("Selling on Instagram, TikTok, Facebook or X? Add your handle. Once we've checked it's yours, buyers who look it up on NosHen see your track record.")}</p>
      </div>
      {handles.length ? (
        <ul className="handle-list">
          {handles.map((h) => (
            <li key={h.id} className="stack" style={{ gap: 8 }}>
              <div className="row-between" style={{ gap: 8 }}>
                <a href={profileUrl(h.platform, h.handle)} target="_blank" rel="noreferrer" className="label">{t(platformOf(h.platform).label)} · @{h.handle}</a>
                <span className={`nh-status label ${h.status === "verified" ? "nh-status-released" : h.status === "rejected" ? "nh-status-dispute" : "nh-status-awaiting"}`}>
                  {h.status === "verified" ? t("Verified") : h.status === "submitted" ? t("Being checked") : h.status === "rejected" ? t("Not verified") : t("Code to add")}
                </span>
              </div>
              {h.status === "verified" ? <p className="caption muted">{t("Buyers who check @{handle} on NosHen see your track record. You can take the code out of your bio.", { handle: h.handle })}</p> : null}
              {h.status === "submitted" ? <p className="caption muted">{t("We're looking for {code} in your bio, usually within a day. Keep it there until then.", { code: h.code })}</p> : null}
              {h.status === "rejected" && h.reject_reason ? <p className="caption error-text">{h.reject_reason}</p> : null}
              {h.status === "added" || h.status === "rejected" ? (
                <>
                  <p className="caption">{t("Put this code anywhere in your {platform} bio, then tell us:", { platform: t(platformOf(h.platform).label) })}</p>
                  <div className="row wrap" style={{ gap: 8 }}><code className="handle-code">{h.code}</code><CopyButton text={h.code} label={t("Copy code")} /></div>
                  <Form method="post"><input type="hidden" name="intent" value="handle_submit" /><input type="hidden" name="handle" value={h.id} />
                    <Button type="submit" variant="primary" size="sm">{h.status === "rejected" ? t("I've added it: check again") : t("I've added it")}</Button>
                  </Form>
                </>
              ) : null}
              <Form method="post"><input type="hidden" name="intent" value="handle_remove" /><input type="hidden" name="handle" value={h.id} />
                <button type="submit" className="link-btn caption">{t("Remove")}</button>
              </Form>
            </li>
          ))}
        </ul>
      ) : null}
      {idOk ? (
        <Form method="post" className="stack">
          <input type="hidden" name="intent" value="handle_add" />
          <div className="handle-add">
            <Select name="platform" label={t("Where")} value={platform} onChange={setPlatform} options={PLATFORMS.map((p) => ({ value: p.key, label: t(p.label) }))} />
            <TextField name="handle" label={t("Your name there")} placeholder="@ada.styles" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={120}
              missing={t("Enter your name there, like @ada.styles.")} />
          </div>
          <ErrorText>{error}</ErrorText>
          <div><Button type="submit" icon="plus">{t("Add handle")}</Button></div>
        </Form>
      ) : (
        <p className="caption muted row" style={{ gap: 6 }}><Icon name="id" size={16} />{t.rich("<verify>Verify your ID</verify> first, so every handle on NosHen leads to a real person.", { verify: (s) => <Link to="/account/verify?next=/account">{s}</Link> })}</p>
      )}
    </section>
  );
}
