import type { Route } from "./+types/saved";
import { requireUser, withApp } from "../../server/web";
import { savedListingsFor } from "@noshen/engine/queries";
import { Button, ListingCard, TopBar } from "@noshen/ui/ui";
import { placeLabel } from "@noshen/shared/locations";
import { photoUrl } from "@noshen/shared/photos";
import { sizeLabel } from "@noshen/shared/sizes";
import { ago } from "@noshen/shared/time";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Saved items · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    return { listings: await savedListingsFor(d.db, user.id) };
  });
}

export default function Saved({ loaderData: { listings } }: Route.ComponentProps) {
  const t = useT();
  return (
    <div>
      <TopBar title={t("Saved items")} back="/account" />
      <main className="page no-tabs stack-4">
        <div className="stack">
          <h1 className="heading desktop-only">{t("Saved items")}</h1>
          <p className="body muted">{t("Listings you bookmarked to check back on later.")}</p>
        </div>

        {listings.length ? (
          <div className="grid-cards">
            {listings.map((l: any) => (
              <ListingCard
                key={l.id}
                href={`/l/${l.id}`}
                title={l.title}
                priceKobo={l.price_kobo}
                area={[sizeLabel(l.category, l.size_system, l.size), placeLabel(l.area, l.state)].filter(Boolean).join(" · ")}
                imageUrl={l.photo_keys?.[0] ? photoUrl(l.photo_keys[0], "small") : undefined}
                posted={ago(l.published_at)}
                sold={l.status === "sold"}
                left={l.status === "live" && Number(l.quantity) > 1 ? Math.max(0, Number(l.quantity) - Number(l.sold_count ?? 0)) : undefined}
              />
            ))}
          </div>
        ) : (
          <section className="card stack">
            <p className="title">{t("Nothing saved yet")}</p>
            <p className="body muted">{t("Tap Save on any listing to keep track of it here.")}</p>
            <div><Button variant="primary" to="/browse">{t("Browse listings")}</Button></div>
          </section>
        )}
      </main>
    </div>
  );
}
