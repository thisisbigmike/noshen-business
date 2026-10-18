import { useState } from "react";
import { data } from "react-router";
import type { Route } from "./+types/sell-share";
import { requireUser, withApp } from "../../server/web";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, Icon, Info, ProtectionBadge, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { photoUrl } from "@noshen/shared/photos";
import { categoryOf } from "@noshen/shared/categories";
import { placeLabel } from "@noshen/shared/locations";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";

export const meta = () => [{ title: "Share · Sell · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(d.db, "select id, title, price_kobo, area, state, category, status, photo_keys from listings where id = $1", [params.id]);
    if (!l) throw data("Not found", { status: 404 });
    const owner = await one(d.db, "select seller_id from listings where id = $1", [params.id]);
    if (owner?.seller_id !== user.id) throw data("Not found", { status: 404 });
    return { listing: l, url: `${new URL(request.url).origin}/l/${l.id}?r=share` };
  });
}

export default function Share({ loaderData: { listing: l, url } }: Route.ComponentProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const held = t("{place}. Your money is held until you have it.", { place: placeLabel(l.area, l.state) });
  const text = t("{title} · {price}. {place}. Your money is held until you have it. Buy it here: {url}", { title: l.title, price: naira(l.price_kobo), place: placeLabel(l.area, l.state), url });
  if (l.status === "blocked") {
    return (
      <main className="page narrow stack-4">
        <h1 className="heading">{t("We're checking your listing")}</h1>
        <Info icon="info-circle" tone="warn">{t("The same {number} is on another live listing, so a NosHen reviewer will check it. We'll email you.", { number: t(categoryOf(l.category).id?.label ?? msg("number")).replace(/ \(.*\)$/, "") })}</Info>
      </main>
    );
  }
  return (
    <div>
      <TopBar title={t("Share your listing")} back="/deals?tab=selling" />
      <main className="page narrow stack-4">
        <div className="stack"><h1 className="heading">{t("Your listing is live")}</h1><p className="body muted">{t("Share the link where your buyers are. Anyone who opens it can buy with protection.")}</p></div>
        <section className="stack">
          <p className="label">{t("How it looks in a WhatsApp chat")}</p>
          <div className="wa stack">
            <div className="preview">
              {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" width={64} height={64} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} /> : null}
              <div className="stack" style={{ gap: 2 }}>
                <p className="label">{l.title} · {naira(l.price_kobo)}</p>
                <p className="caption">{held}</p>
                <p className="caption muted">{new URL(url).host}</p>
              </div>
            </div>
            <p className="body">{t("Still available. Buy it here: {url}", { url })}</p>
          </div>
          <div className="row"><ProtectionBadge variant="brand" /></div>
        </section>
        <div className="row wrap">
          <Button icon="brand-facebook" to={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}>Facebook</Button>
          <Button icon="link" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true); }}>{copied ? t("Copied") : t("Copy link")}</Button>
        </div>
        <BottomAction>
          <a className="nh-btn nh-btn-primary nh-btn-lg nh-btn-block" style={{ textDecoration: "none" }} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <Icon name="brand-whatsapp" size={18} />{t("Share on WhatsApp")}
          </a>
        </BottomAction>
      </main>
    </div>
  );
}
