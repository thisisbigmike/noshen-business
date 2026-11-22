import { useState } from "react";
import { Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-quick";
import { requireUser, withApp, messageOf } from "../../server/web";
import { createQuickEscrowLink, sellerReady } from "@noshen/engine/sellers";
import { DealError, settingsOf } from "@noshen/engine/core";
import { CATEGORIES, categoryOf, isService, type CategoryKey } from "@noshen/shared/categories";
import { NIGERIA_STATES, stateLabel } from "@noshen/shared/locations";
import { feeFor, naira } from "@noshen/shared/money";
import { BottomAction, Button, CheckedForm, ErrorText, Info, Kv, Select, TextArea, TextField, TopBar } from "@noshen/ui/ui";
import { DeliveryFields, deliveryFromForm } from "../lib/delivery";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Quick Escrow Link · Sell · NosHen" }];

export async function loader({ request }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const [ready, s] = await Promise.all([sellerReady(d, user.id), settingsOf(d)]);
    return { ready, fee: s.fee, minKobo: s.deal_min_kobo };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  try {
    const res = await withApp(async (d) => {
      const user = await requireUser(request, d);
      const priceNaira = Number(String(f.get("price") ?? "").replace(/[₦,\s]/g, ""));
      const del = deliveryFromForm(f);
      try {
        return await createQuickEscrowLink(d, user.id, {
          category: String(f.get("category") ?? "other") as CategoryKey,
          title: String(f.get("title") ?? ""),
          priceNaira,
          state: String(f.get("state") ?? ""),
          area: String(f.get("area") ?? ""),
          description: String(f.get("description") ?? ""),
          imeiOrSerial: String(f.get("imei") ?? ""),
          deliveryLocalKobo: del.localKobo,
          deliveryOtherKobo: del.otherKobo,
        });
      } catch (e) {
        if (e instanceof DealError && e.code === "seller_checks") {
          throw redirect("/account/verify?next=/sell/quick");
        }
        throw e;
      }
    });
    return redirect(`/sell/${res.id}/share`);
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

/** 10-second Quick Escrow Link: skip marketplace photos when you already have a buyer on WhatsApp, Instagram or X. */
export default function SellQuick({ loaderData: x, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const [catKey, setCatKey] = useState<CategoryKey>("other");
  const [priceStr, setPriceStr] = useState("");
  const [state, setState] = useState("Lagos");
  const cat = categoryOf(catKey);
  const job = isService(catKey);
  const priceNaira = Number(priceStr.replace(/[₦,\s]/g, "")) || 0;
  const priceKobo = Math.round(priceNaira * 100);
  const feeKobo = priceKobo >= x.minKobo ? feeFor(priceKobo, x.fee) : 0;

  return (
    <CheckedForm method="post">
      <TopBar title={t("Quick escrow link")} back="/sell" />
      <main className="page sell-page no-tabs stack-4">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="heading">{t("Create a quick escrow link")}</h1>
          <p className="body muted">{t("Already agreed on a price on WhatsApp, Instagram or X? Make a private checkout link in seconds — no marketplace photos needed.")}</p>
        </div>

        <div className="sell-flow">
          <div className="sell-main">
            {!x.ready.ready ? (
              <Info icon="shield-check" tone="warn">
                {t.rich("You'll need to <verify>verify your ID and bank account</verify> before your escrow link can go live.", {
                  verify: (s) => <Link to="/account/verify?next=/sell/quick">{s}</Link>,
                })}
              </Info>
            ) : null}

            <section className="sell-card stack-4">
              <div className="sell-row">
                <Select
                  name="category"
                  label={t("Category")}
                  value={catKey}
                  onChange={(v) => setCatKey(v as CategoryKey)}
                  options={CATEGORIES.map((c) => ({ value: c.key, label: t(c.label) }))}
                />
                <TextField label={t("What are you selling?")} name="title" placeholder={cat.titleExample} maxLength={80} required />
              </div>

              <TextField
                label={t("Agreed price (₦)")}
                name="price"
                inputMode="numeric"
                placeholder="450000"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                hint={t("Minimum {min}. The buyer pays into NosHen escrow before handover.", { min: naira(x.minKobo) })}
                required
              />

              {cat.id ? (
                <TextField
                  key={cat.key}
                  label={t(cat.id.label)}
                  name="imei"
                  inputMode={cat.id.numeric ? "numeric" : "text"}
                  autoCapitalize="characters"
                  hint={t("Hidden until the buyer pays, so they can check it at handover.")}
                  required={cat.id.required}
                />
              ) : null}

              <div className="sell-row">
                <Select
                  name="state"
                  label={t("State")}
                  value={state}
                  onChange={setState}
                  options={NIGERIA_STATES.map((st) => ({ value: st, label: stateLabel(st) }))}
                />
                <TextField label={t("Town or area")} name="area" placeholder="Yaba, Ikeja, Wuse 2…" maxLength={60} required />
              </div>

              {!job ? <DeliveryFields state={state} local={null} other={null} /> : null}

              <TextArea label={t("Short note or terms (optional)")} name="description" placeholder={t("Colour, condition, accessories, or what's included…")} maxLength={2000} />
            </section>
          </div>

          <aside className="sell-side">
            <div className="sell-cta-card stack">
              {priceKobo >= x.minKobo ? (
                <div>
                  <p className="title" style={{ marginBottom: 4 }}>{t("Escrow breakdown")}</p>
                  <Kv k={t("Item price")} v={naira(priceKobo)} />
                  <Kv k={t("NosHen fee")} v={naira(feeKobo)} />
                  <Kv k={t("The buyer pays")} v={naira(priceKobo + feeKobo)} total />
                </div>
              ) : null}
              <ErrorText>{actionData?.error}</ErrorText>
              <BottomAction>
                <Button type="submit" variant="primary" size="lg" block icon="bolt" disabled={busy}>
                  {busy ? t("Creating link…") : t("Create escrow link")}
                </Button>
              </BottomAction>
            </div>
          </aside>
        </div>
      </main>
    </CheckedForm>
  );
}
