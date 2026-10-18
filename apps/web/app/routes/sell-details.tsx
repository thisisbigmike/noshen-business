import { useState } from "react";
import { Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-details";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft } from "@noshen/engine/sellers";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, CheckedForm, ErrorText, Icon, Info, Select, TextArea, TextField, TopBar } from "@noshen/ui/ui";
import { CONDITIONS, type Condition } from "@noshen/shared/deal";
import { NIGERIA_STATES, areaProblem, comingSoonList, stateLabel } from "@noshen/shared/locations";
import { categoryOf, idProblem, isCategory, type CategoryKey } from "@noshen/shared/categories";
import { feeFor, naira } from "@noshen/shared/money";
import { sizeProblem, sizeRuleFor } from "@noshen/shared/sizes";
import { settingsOf } from "@noshen/engine/core";
import { sellerLimit } from "@noshen/engine/deals";
import { overLimit, sellerLimitText } from "@noshen/shared/limits";
import { DeliveryFields, deliveryFromForm } from "../lib/delivery";
import { useT } from "@noshen/ui/i18n";

export const handle = { tabs: false };
export const meta = () => [{ title: "Details · Sell · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(d.db, "select * from listings where id = $1", [params.id]);
    if (!l || l.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (l.status !== "draft") throw redirect(`/sell/${l.id}/share`);
    if ((l.photo_keys ?? []).length < 3) throw redirect(`/sell/${l.id}/photos`);
    const st = await settingsOf(d);
    // A new listing starts where the seller's last one was, so a seller in Kano isn't shown Lagos.
    const last = l.state ? null : await one<{ state: string; area: string }>(d.db,
      "select state, area from listings where seller_id = $1 and state is not null and id <> $2 order by created_at desc limit 1", [user.id, l.id]);
    const place = { state: l.state ?? last?.state ?? "", area: l.area?.trim() ? l.area : last?.area ?? "" };
    // So a new seller hears about their deal limit while pricing, not from a buyer later.
    const limit = await sellerLimit(d.db, user.id, st);
    return { listing: l, place, limit, min: st.deal_min_kobo, max: st.deal_max_kobo, fee: st.fee };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  const delivery = deliveryFromForm(f);
  const input = {
    category: (isCategory(f.get("category")) ? f.get("category") : "other") as CategoryKey,
    title: String(f.get("title") ?? ""), description: String(f.get("description") ?? ""),
    priceNaira: Number(String(f.get("price") ?? "").replace(/[^\d]/g, "")), condition: String(f.get("condition")) as Condition,
    state: String(f.get("state") ?? ""), area: String(f.get("area") ?? ""), imeiOrSerial: String(f.get("imei") ?? ""),
    sizeSystem: String(f.get("size_system") ?? ""), size: String(f.get("size") ?? ""),
    quantity: Number(f.get("quantity") ?? 1),
    deliveryLocalKobo: delivery.localKobo, deliveryOtherKobo: delivery.otherKobo,
  };
  // Saved, not published: the seller checks everything on the next step first.
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await saveDraft(d, user.id, params.id, [], input);
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/sell/${params.id}/review`);
}

export default function SellDetails({ loaderData: { listing: l, place, limit, min, max, fee }, actionData }: Route.ComponentProps) {
  const t = useT();
  const busy = useNavigation().state !== "idle";
  const untouched = l.title === "Untitled listing";
  const [cond, setCond] = useState<string>(l.condition);
  const [qty, setQty] = useState<number>(Number(l.quantity ?? 1));
  // Size, for clothes, shoes, hair and baby items: first the kind (EU, UK, US, S/M/L…), then the size from its list.
  const sizeRule = sizeRuleFor(l.category);
  const [sizeKind, setSizeKind] = useState<string>(l.size_system ?? sizeRule?.systems[0]?.id ?? "");
  const [size, setSize] = useState<string>(l.size ?? "");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const kind = sizeRule?.systems.find((x) => x.id === sizeKind) ?? sizeRule?.systems[0];
  const [price, setPrice] = useState<string>(untouched ? "" : String(Number(l.price_kobo) / 100));
  // The delivery prices name the state ("Delivery within Lagos"), so they follow the state chosen here.
  const [itemState, setItemState] = useState<string>(place.state);
  const p = Number(price.replace(/[^\d]/g, "")) * 100;
  const c = categoryOf(l.category);
  return (
    <CheckedForm method="post" onSubmit={(e) => {
      const problem = sizeRule ? sizeProblem(l.category, kind?.id, size, t) : null;
      setSizeError(problem);
      if (problem) { e.preventDefault(); document.getElementById("size-field")?.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }}>
      <TopBar title={<span>{t("Details")} <span className="caption muted">{t("Step {n} of {total}", { n: 3, total: 4 })}</span></span>} back={`/sell/${l.id}/photos`} />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">{t("Details")} <span className="caption muted">{t("Step {n} of {total}", { n: 3, total: 4 })}</span></h1>
        <input type="hidden" name="category" value={l.category} />
        <div className="chosen-cat">
          <span className="cat-icon"><Icon name={c.icon} size={22} /></span>
          <span className="grow stack" style={{ gap: 0 }}><span className="caption muted">{t("Selling")}</span><span className="label">{t(c.label)}</span></span>
          <Link to="/sell" className="caption tap" style={{ padding: "0 8px" }}>{t("Change")}</Link>
        </div>
        <TextField label={t("Title")} name="title" defaultValue={untouched ? "" : l.title} placeholder={c.titleExample} maxLength={80} required
          missing={t("Give it a title, like “{example}”.", { example: c.titleExample })} validate={(v) => (v.trim().length < 3 ? t("Make the title a little longer: at least 3 characters, like “{example}”.", { example: c.titleExample }) : null)} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("Condition")}</legend>
          {CONDITIONS.map(([v, label, hint]) => (
            <label key={v} className="choice"><input type="radio" name="condition" value={v} checked={cond === v} onChange={() => setCond(v)} /><span className="stack" style={{ gap: 0 }}><span className="body">{t(label)}</span><span className="caption muted">{t(hint)}</span></span></label>
          ))}
        </fieldset>
        {sizeRule && kind ? (
          <fieldset id="size-field" className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 8 }}>{sizeRule.required ? t(sizeRule.label) : t("{label} (optional)", { label: t(sizeRule.label) })}</legend>
            {sizeRule.systems.length > 1 ? (
              <div className="size-kinds" role="radiogroup" aria-label={t("Kind of {what}", { what: t(sizeRule.label).toLowerCase() })}>
                {sizeRule.systems.map((x) => (
                  <label key={x.id} className="chip">
                    <input type="radio" name="size_system" value={x.id} checked={kind.id === x.id} className="sr-only"
                      onChange={() => { setSizeKind(x.id); setSize(x.values.length === 1 ? x.values[0] : ""); setSizeError(null); }} />
                    {t(x.label)}
                  </label>
                ))}
              </div>
            ) : <input type="hidden" name="size_system" value={kind.id} />}
            {kind.values.length > 1 ? (
              <Select key={kind.id} name="size" label={t(sizeRule.label)} hideLabel value={size} onChange={(v) => { setSize(v); setSizeError(null); }}
                options={[{ value: "", label: t("Choose {what}", { what: `${kind.prefix ? `${kind.prefix} ` : ""}${t(sizeRule.label).toLowerCase()}` }) }, ...kind.values.map((v) => ({ value: v, label: kind.prefix && kind.id !== "waist" ? `${kind.prefix} ${v}` : v }))]} />
            ) : <input type="hidden" name="size" value={kind.values[0]} />}
            {sizeError ? <p className="nh-field-msg nh-field-msg-error caption" role="alert"><Icon name="alert-triangle" size={16} />{sizeError}</p> : <p className="caption muted">{t(sizeRule.hint)}</p>}
          </fieldset>
        ) : null}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("How many do you have?")}</legend>
          <div className="qty-stepper">
            <button type="button" className="icon-btn" aria-label={t("One fewer")} disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}><span aria-hidden="true">−</span></button>
            <input name="quantity" type="number" inputMode="numeric" min={1} max={999} value={qty} aria-label={t("How many you have")}
              onChange={(e) => setQty(Math.min(999, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
            <button type="button" className="icon-btn" aria-label={t("One more")} disabled={qty >= 999} onClick={() => setQty((q) => Math.min(999, q + 1))}><Icon name="plus" size={18} /></button>
          </div>
          <p className="caption muted">{qty > 1 ? t("Each buyer gets one. Buyers see how many are left, and it shows as sold when all {n} have gone.", { n: qty }) : t("Selling more than one of the same thing? Set how many, and buyers can each buy one.")}</p>
        </fieldset>
        <TextField label={t("Price (₦)")} name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d,]/g, ""))} placeholder="45,000" required missing={t("Enter a price in naira, like 45,000.")}
          validate={(v) => { const k = Number(v.replace(/[^\d]/g, "")) * 100; return k < min ? t("The lowest price on NosHen is {min}. You've entered {price}.", { min: naira(min), price: naira(k) }) : max !== null && k > max ? t("The highest price on NosHen is {max}. You've entered {price}.", { max: naira(max), price: naira(k) }) : !Number.isSafeInteger(k) ? t("That price is too large. Check the number of zeros.") : null; }}
          hint={p >= min && (max === null || p <= max) && Number.isSafeInteger(p) ? t("The buyer pays {total} with NosHen's fee. You get {price}.", { total: naira(p + feeFor(p, fee)), price: naira(p) }) : max === null ? t("From {min}. There's no top price.", { min: naira(min) }) : t("From {min} to {max}.", { min: naira(min), max: naira(max) })} />
        {overLimit(p, limit) && (max === null || p <= max) ? <Info icon="alert-triangle" tone="warn">{sellerLimitText(limit, "seller", t)}</Info> : null}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t("Where the item is")}</legend>
          <Select name="state" label={t("State")} value={itemState} onChange={setItemState}
            options={[...(place.state ? [] : [{ value: "", label: t("Choose a state") }]), ...NIGERIA_STATES.map((s) => ({ value: s, label: stateLabel(s) }))]} />
          <TextField label={t("Area or town")} name="area" defaultValue={place.area} placeholder="Yaba, Wuse 2, GRA, Bodija…" maxLength={40} required
            hint={t("Buyers see this to plan the meet-up. Never your street address.")} missing={t("Add your area or town, like Yaba, Wuse 2 or GRA.")} validate={(v) => areaProblem(v, t)} />
          <p className="caption muted">{t("NosHen works in all 36 states and Abuja. {countries} are coming soon.", { countries: comingSoonList() })}</p>
        </fieldset>
        <DeliveryFields state={itemState} local={l.delivery_local_kobo} other={l.delivery_other_kobo} />
        {c?.id ? (
          <TextField key={c.key} label={t(c.id.label)} name="imei" inputMode={c.id.numeric ? "numeric" : "text"} autoCapitalize="characters" defaultValue={l.category === c.key ? l.imei_or_serial ?? "" : ""}
            hint={t(c.id.hint)} required={c.id.required} missing={idProblem(c.key, "", t) ?? undefined} validate={(v) => idProblem(c.key, v, t)} />
        ) : null}
        <TextArea label={t("Description (optional)")} name="description" defaultValue={l.description ?? ""} maxLength={2000} placeholder={t(c.describeHint)} />
        <Info icon="shield-check">{t("Your listing shows “Protected by NosHen”. Buyers pay NosHen, and you're paid when they give you their code.")}</Info>
        <p className="caption muted">{t.rich("Some things can't be sold on NosHen, such as anything stolen or fake. See the <list>prohibited items</list>.", { list: (s) => <Link to="/prohibited-items">{s}</Link> })}</p>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy} iconRight="arrow-right">{busy ? t("Saving…") : t("Next: review")}</Button></BottomAction>
      </main>
    </CheckedForm>
  );
}
