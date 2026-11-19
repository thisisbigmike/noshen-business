import { data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-edit";
import { requireUser, withApp, messageOf } from "../../server/web";
import { updateLiveListing } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { CONDITIONS, type Condition } from "@noshen/shared/deal";
import { isService } from "@noshen/shared/categories";
import { NIGERIA_STATES, stateLabel } from "@noshen/shared/locations";
import { BottomAction, Button, CheckedForm, ErrorText, Info, Select, TextArea, TextField, TopBar } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Edit listing · Sell · NosHen" }];

/** Edits a live or paused listing (title, price, condition, location, quantity, description) without re-uploading photos. */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(
      d.db,
      "select id, seller_id, category, title, description, price_kobo, condition, state, area, quantity, sold_count, status from listings where id = $1",
      [params.id],
    );
    if (!l || l.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (l.status === "draft") throw redirect(`/sell/${l.id}/details`);
    if (!["live", "paused"].includes(l.status)) throw redirect(`/l/${l.id}`);
    return { listing: l };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      const priceNaira = Number(String(f.get("price") ?? "").replace(/[₦,\s]/g, ""));
      const qtyRaw = Number(String(f.get("quantity") ?? "1"));
      await updateLiveListing(d, user.id, params.id, {
        title: String(f.get("title") ?? ""),
        description: String(f.get("description") ?? ""),
        priceNaira,
        condition: (f.get("condition") ? String(f.get("condition")) : undefined) as Condition | undefined,
        state: String(f.get("state") ?? ""),
        area: String(f.get("area") ?? ""),
        quantity: Number.isInteger(qtyRaw) ? qtyRaw : 1,
      });
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/l/${params.id}`);
}

export default function SellEdit({ loaderData: { listing: l }, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const job = isService(l.category);
  const priceNaira = Math.round(Number(l.price_kobo) / 100);
  const minQty = Math.max(1, Number(l.sold_count ?? 0));

  return (
    <CheckedForm method="post">
      <TopBar title={t("Edit listing")} back={`/l/${l.id}`} />
      <main className="page narrow no-tabs stack-4">
        <div className="stack">
          <h1 className="heading desktop-only">{t("Edit listing")}</h1>
          <p className="body muted">{t("Update your price, details or quantity without taking your listing down.")}</p>
        </div>

        <TextField label={t("Title")} name="title" defaultValue={l.title} maxLength={80} required />
        <TextField label={t("Price (₦)")} name="price" inputMode="numeric" defaultValue={String(priceNaira)} required />

        {!job ? (
          <Select
            name="condition"
            label={t("Condition")}
            defaultValue={l.condition}
            options={CONDITIONS.map(([k, label]) => ({ value: k, label: t(label) }))}
          />
        ) : null}

        <TextField
          label={t("Quantity")}
          name="quantity"
          type="number"
          min={minQty}
          max={999}
          defaultValue={String(l.quantity ?? 1)}
          hint={Number(l.sold_count) > 0 ? t("{n} already sold.", { n: Number(l.sold_count) }) : undefined}
          required
        />

        <div className="row wrap" style={{ gap: 12 }}>
          <div className="grow">
            <Select
              name="state"
              label={t("State")}
              defaultValue={l.state ?? "Lagos"}
              options={NIGERIA_STATES.map((st) => ({ value: st, label: stateLabel(st) }))}
            />
          </div>
          <div className="grow">
            <TextField label={t("Town or area")} name="area" defaultValue={l.area} maxLength={60} required />
          </div>
        </div>

        <TextArea label={t("Description")} name="description" defaultValue={l.description ?? ""} maxLength={2000} />

        <Info icon="info-circle">{t("Changes apply to new buy requests. Active deals keep the price already agreed.")}</Info>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction>
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? t("Saving…") : t("Save changes")}
          </Button>
        </BottomAction>
      </main>
    </CheckedForm>
  );
}
