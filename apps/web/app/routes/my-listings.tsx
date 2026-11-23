// My listings: everything a seller has listed, with the shop link, each with its own buttons to edit, set delivery
// prices, pause and choose who can see it. Moved out of Account so Account stays short.
import { Form, Link } from "react-router";
import type { Route } from "./+types/my-listings";
import { requireUser, withApp, messageOf } from "../../server/web";
import { myListings } from "@noshen/engine/queries";
import { setListingStatus, setVisibility } from "@noshen/engine/sellers";
import { offersDelivery } from "@noshen/shared/delivery";
import { isService } from "@noshen/shared/categories";
import { photoUrl } from "@noshen/shared/photos";
import { Button, ErrorText, Icon, TopBar } from "@noshen/ui/ui";
import { naira } from "@noshen/shared/money";
import { useT } from "@noshen/ui/i18n";
import { msg } from "@noshen/shared/i18n";
import { CopyButton } from "../lib/copy-button";

export const meta = () => [{ title: "My listings · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    return { listings: await myListings(d.db, user.id), userId: user.id, shop: `${new URL(request.url).origin}/s/${user.id}` };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const visibility = f.get("visibility");
      if (visibility === "public" || visibility === "link") await setVisibility(d, user.id, String(f.get("listing")), visibility);
      else await setListingStatus(d, user.id, String(f.get("listing")), String(f.get("status")) as "paused" | "live" | "removed");
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

const STATUS_WORD: Record<string, string> = { live: msg("Live"), paused: msg("Paused"), sold: msg("Sold"), draft: msg("Draft"), blocked: msg("Being checked") };

export default function MyListings({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  return (
    <div>
      <TopBar title={t("My listings")} back="/account" right={<Link to="/sell" className="icon-btn" aria-label={t("New listing")}><Icon name="plus" /></Link>} />
      <main className="page narrow stack-4">
        <div className="row-between desktop-only">
          <h1 className="heading">{t("My listings")}</h1>
          <Button variant="primary" pill to="/sell" icon="plus">{t("New listing")}</Button>
        </div>
        <ErrorText>{(actionData as any)?.error}</ErrorText>
        {x.listings.length ? (
          <ul className="my-listings">
            {x.listings.map((l: any) => {
              const draft = l.status === "draft";
              const open = l.status === "live" || l.status === "paused";
              const href = draft ? (l.title === "Untitled listing" ? `/sell/${l.id}/photos` : `/sell/${l.id}/review`) : `/l/${l.id}`;
              const requests = Number(l.requests);
              return (
                <li key={l.id} className="card my-listing">
                  <Link to={href} className="my-listing-main">
                    <span className="my-listing-thumb">
                      {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0], "small")} alt="" loading="lazy" decoding="async" /> : <Icon name="photo" size={22} />}
                    </span>
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="body my-listing-title">{l.title === "Untitled listing" ? t("Draft listing") : l.title}</span>
                      <span className="caption muted">
                        <span className="my-listing-status" data-status={l.status}>{t(STATUS_WORD[l.status] ?? l.status)}</span>
                        {" · "}{naira(l.price_kobo)}
                        {requests ? ` · ${requests === 1 ? t("1 request") : t("{n} requests", { n: requests })}` : ""}
                      </span>
                      {l.visibility === "link" ? <span className="caption muted row" style={{ gap: 4 }}><Icon name="link" size={14} />{t("Checkout link only")}</span> : null}
                    </span>
                    <Icon name="chevron-right" size={18} />
                  </Link>
                  {draft ? (
                    <div className="my-listing-actions"><Button size="sm" variant="primary" to={href} icon="edit">{t("Finish listing")}</Button></div>
                  ) : open ? (
                    <div className="my-listing-actions">
                      <Button size="sm" to={`/sell/${l.id}/edit`} icon="edit">{t("Edit")}</Button>
                      {!isService(l.category) ? <Button size="sm" to={`/sell/${l.id}/delivery`} icon="truck-delivery">{offersDelivery(l) ? t("Delivery") : t("Add delivery")}</Button> : null}
                      <Form method="post" preventScrollReset>
                        <input type="hidden" name="listing" value={l.id} />
                        <input type="hidden" name="status" value={l.status === "live" ? "paused" : "live"} />
                        <Button size="sm" type="submit" icon={l.status === "live" ? "player-pause" : "player-play"}>{l.status === "live" ? t("Pause") : t("Make live")}</Button>
                      </Form>
                      <Form method="post" preventScrollReset>
                        <input type="hidden" name="listing" value={l.id} />
                        <input type="hidden" name="visibility" value={l.visibility === "link" ? "public" : "link"} />
                        <Button size="sm" type="submit" icon={l.visibility === "link" ? "eye" : "link"}>{l.visibility === "link" ? t("Show on NosHen") : t("Link only")}</Button>
                      </Form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="card stack empty" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="empty-icon"><Icon name="tag" size={26} /></span>
            <p className="title">{t("Nothing listed yet")}</p>
            <p className="body muted">{t("List something and it shows here, with buttons to edit, pause or share it.")}</p>
            <Button variant="primary" pill to="/sell" icon="plus">{t("Sell something")}</Button>
          </div>
        )}
        {x.listings.length ? (
          <section className="card stack" aria-labelledby="shop-link">
            <p className="title" id="shop-link">{t("Your shop link")}</p>
            <p className="caption muted">{t("Put it in your Instagram bio or WhatsApp status: one link to everything you sell on NosHen, with your track record.")}</p>
            <div className="shop-link-row"><code className="caption">{x.shop}</code><CopyButton text={x.shop} label={t("Copy link")} /></div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" to={new URL(x.shop).pathname} icon="external-link">{t("See your shop")}</Button>
              <a href={`/s/${x.userId}/badge.svg`} target="_blank" rel="noreferrer" className="nh-btn nh-btn-secondary nh-btn-sm"><Icon name="download" size={18} />{t("Verified trust card")}</a>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
