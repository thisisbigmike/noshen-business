import { data } from "react-router";
import type { Route } from "./+types/shop";
import { withApp } from "../../server/web";
import { sellerShop } from "@noshen/engine/queries";
import { verifiedHandles } from "@noshen/engine/handles";
import { platformOf, profileUrl } from "@noshen/shared/social";
import { Icon, ListingCard, ProtectionBadge, TopBar, Wordmark } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { firstName } from "@noshen/shared/deal";
import { placeLabel } from "@noshen/shared/locations";
import { photoUrl } from "@noshen/shared/photos";
import { sizeLabel } from "@noshen/shared/sizes";
import { ago } from "@noshen/shared/time";
import { SellerRecord } from "../lib/track-record";
import { ShareButton } from "../lib/share";

export const handle = { tabs: false };

/** A seller's shop: one link for their Instagram bio or WhatsApp status, with their track record and what's for sale. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const shop = await withApp(async (d) => {
    const s = await sellerShop(d.db, params.id);
    return s ? { ...s, handles: await verifiedHandles(d.db, s.summary.id) } : null;
  });
  if (!shop) throw data("Not found", { status: 404 });
  return { ...shop, origin: new URL(request.url).origin };
}

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [{ title: "Shop not found · NosHen" }];
  const title = `${firstName(d.summary.name)}'s shop on NosHen`;
  const desc = `${d.summary.completedDeals} sales completed. Every deal protected: your money is held until you have the item.`;
  const img = d.listings[0]?.photo_keys?.[0] ? `${d.origin}${photoUrl(d.listings[0].photo_keys[0])}` : undefined;
  return [
    { title }, { name: "description", content: desc },
    { property: "og:title", content: title }, { property: "og:description", content: desc }, { property: "og:url", content: `${d.origin}/s/${d.summary.id}` },
    ...(img ? [{ property: "og:image", content: img }] : []),
  ];
};

export default function Shop({ loaderData: x }: Route.ComponentProps) {
  const t = useT();
  const name = firstName(x.summary.name);
  const live = x.listings.filter((l: any) => l.status !== "sold").length;
  return (
    <div>
      <TopBar title={<Wordmark size="sm" />} back="/browse" right={<ShareButton kind="icon" path={`/s/${x.summary.id}`} title={t("{name}'s shop on NosHen", { name })} text={t("{name}'s shop on NosHen. Every deal protected: your money is held until you have the item.", { name })} />} />
      <main className="page stack-4">
        <div className="row-between wrap">
          <h1 className="heading">{t("{name}'s shop", { name })}</h1>
          <ProtectionBadge>{t("Every deal protected")}</ProtectionBadge>
        </div>
        <SellerRecord person={x.summary} shop />
        {x.handles.length ? (
          <p className="caption shop-handles">
            <span className="muted">{t("Verified on")}</span>
            {x.handles.map((h) => (
              <a key={`${h.platform}:${h.handle}`} href={profileUrl(h.platform, h.handle)} target="_blank" rel="noreferrer"><Icon name="circle-check" size={14} />{t(platformOf(h.platform).label)} @{h.handle}</a>
            ))}
          </p>
        ) : null}
        <h2 className="label muted">{live ? t("{n} for sale", { n: live }) : t("Nothing for sale right now")}</h2>
        {x.listings.length ? (
          <div className="grid-cards">
            {x.listings.map((l: any) => (
              <ListingCard key={l.id} href={`/l/${l.id}`} title={l.title} priceKobo={l.price_kobo} area={[sizeLabel(l.category, l.size_system, l.size), placeLabel(l.area, l.state)].filter(Boolean).join(" · ")}
                posted={ago(l.published_at)} imageUrl={l.photo_keys?.[0] ? photoUrl(l.photo_keys[0], "small") : undefined}
                sold={l.status === "sold"} left={l.quantity > 1 ? l.quantity - l.sold_count : null} />
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
