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
  const input = {
    category: (isCategory(f.get("category")) ? f.get("category") : "other") as CategoryKey,
    title: String(f.get("title") ?? ""), description: String(f.get("description") ?? ""),
    priceNaira: Number(String(f.get("price") ?? "").replace(/[^\d]/g, "")), condition: String(f.get("condition")) as Condition,
    state: String(f.get("state") ?? ""), area: String(f.get("area") ?? ""), imeiOrSerial: String(f.get("imei") ?? ""),
    sizeSystem: String(f.get("size_system") ?? ""), size: String(f.get("size") ?? ""),
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
  const busy = useNavigation().state !== "idle";
  const untouched = l.title === "Untitled listing";
  const [cond, setCond] = useState<string>(l.condition);
  // Size, for clothes, shoes, hair and baby items: first the kind (EU, UK, US, S/M/L…), then the size from its list.
  const sizeRule = sizeRuleFor(l.category);
  const [sizeKind, setSizeKind] = useState<string>(l.size_system ?? sizeRule?.systems[0]?.id ?? "");
  const [size, setSize] = useState<string>(l.size ?? "");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const kind = sizeRule?.systems.find((x) => x.id === sizeKind) ?? sizeRule?.systems[0];
  const [price, setPrice] = useState<string>(untouched ? "" : String(Number(l.price_kobo) / 100));
  const p = Number(price.replace(/[^\d]/g, "")) * 100;
  const c = categoryOf(l.category);
  return (
    <CheckedForm method="post" onSubmit={(e) => {
      const problem = sizeRule ? sizeProblem(l.category, kind?.id, size) : null;
      setSizeError(problem);
      if (problem) { e.preventDefault(); document.getElementById("size-field")?.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }}>
      <TopBar title={<span>Details <span className="caption muted">Step 3 of 4</span></span>} back={`/sell/${l.id}/photos`} />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">Details <span className="caption muted">Step 3 of 4</span></h1>
        <input type="hidden" name="category" value={l.category} />
        <div className="chosen-cat">
          <span className="cat-icon"><Icon name={c.icon} size={22} /></span>
          <span className="grow stack" style={{ gap: 0 }}><span className="caption muted">Selling</span><span className="label">{c.label}</span></span>
          <Link to="/sell" className="caption tap" style={{ padding: "0 8px" }}>Change</Link>
        </div>
        <TextField label="Title" name="title" defaultValue={untouched ? "" : l.title} placeholder={c?.titleExample ?? "What it is, in a few words"} maxLength={80} required
          missing={`Give it a title, like “${c?.titleExample ?? "iPhone 13, 128GB"}”.`} validate={(v) => (v.trim().length < 3 ? `Make the title a little longer: at least 3 characters, like “${c?.titleExample ?? "iPhone 13, 128GB"}”.` : null)} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Condition</legend>
          {CONDITIONS.map(([v, label, hint]) => (
            <label key={v} className="choice"><input type="radio" name="condition" value={v} checked={cond === v} onChange={() => setCond(v)} /><span className="stack" style={{ gap: 0 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span></label>
          ))}
        </fieldset>
        {sizeRule && kind ? (
          <fieldset id="size-field" className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 8 }}>{sizeRule.label}{sizeRule.required ? "" : " (optional)"}</legend>
            {sizeRule.systems.length > 1 ? (
              <div className="size-kinds" role="radiogroup" aria-label={`Kind of ${sizeRule.label.toLowerCase()}`}>
                {sizeRule.systems.map((x) => (
                  <label key={x.id} className="chip">
                    <input type="radio" name="size_system" value={x.id} checked={kind.id === x.id} className="sr-only"
                      onChange={() => { setSizeKind(x.id); setSize(x.values.length === 1 ? x.values[0] : ""); setSizeError(null); }} />
                    {x.label}
                  </label>
                ))}
              </div>
            ) : <input type="hidden" name="size_system" value={kind.id} />}
            {kind.values.length > 1 ? (
              <Select key={kind.id} name="size" label={sizeRule.label} hideLabel value={size} onChange={(v) => { setSize(v); setSizeError(null); }}
                options={[{ value: "", label: `Choose ${kind.prefix ? `${kind.prefix} ` : ""}${sizeRule.label.toLowerCase()}` }, ...kind.values.map((v) => ({ value: v, label: kind.prefix && kind.id !== "waist" ? `${kind.prefix} ${v}` : v }))]} />
            ) : <input type="hidden" name="size" value={kind.values[0]} />}
            {sizeError ? <p className="nh-field-msg nh-field-msg-error caption" role="alert"><Icon name="alert-triangle" size={16} />{sizeError}</p> : <p className="caption muted">{sizeRule.hint}</p>}
          </fieldset>
        ) : null}
        <TextField label="Price (₦)" name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d,]/g, ""))} placeholder="45,000" required missing="Enter a price in naira, like 45,000."
          validate={(v) => { const k = Number(v.replace(/[^\d]/g, "")) * 100; return k < min ? `The lowest price on NosHen is ${naira(min)}. You've entered ${naira(k)}.` : max !== null && k > max ? `The highest price on NosHen is ${naira(max)}. You've entered ${naira(k)}.` : !Number.isSafeInteger(k) ? "That price is too large. Check the number of zeros." : null; }}
          hint={p >= min && (max === null || p <= max) && Number.isSafeInteger(p) ? `The buyer pays ${naira(p + feeFor(p, fee))} with NosHen's fee. You get ${naira(p)}.` : max === null ? `From ${naira(min)}. There's no top price.` : `From ${naira(min)} to ${naira(max)}.`} />
        {overLimit(p, limit) && (max === null || p <= max) ? <Info icon="alert-triangle" tone="warn">{sellerLimitText(limit, "seller")}</Info> : null}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Where the item is</legend>
          <Select name="state" label="State" defaultValue={place.state}
            options={[...(place.state ? [] : [{ value: "", label: "Choose a state" }]), ...NIGERIA_STATES.map((s) => ({ value: s, label: stateLabel(s) }))]} />
          <TextField label="Area or town" name="area" defaultValue={place.area} placeholder="Yaba, Wuse 2, GRA, Bodija…" maxLength={40} required
            hint="Buyers see this to plan the meet-up. Never your street address." missing="Add your area or town, like Yaba, Wuse 2 or GRA." validate={areaProblem} />
          <p className="caption muted">NosHen works in all 36 states and Abuja. {comingSoonList()} are coming soon.</p>
        </fieldset>
        {c?.id ? (
          <TextField key={c.key} label={c.id.label} name="imei" inputMode={c.id.numeric ? "numeric" : "text"} autoCapitalize="characters" defaultValue={l.category === c.key ? l.imei_or_serial ?? "" : ""}
            hint={c.id.hint} required={c.id.required} missing={idProblem(c.key, "") ?? undefined} validate={(v) => idProblem(c.key, v)} />
        ) : null}
        <TextArea label="Description (optional)" name="description" defaultValue={l.description ?? ""} maxLength={2000} placeholder={c?.describeHint ?? "Its condition, how long you've had it, and what comes with it."} />
        <Info icon="shield-check">Your listing shows "Protected by NosHen". Buyers pay NosHen, and you're paid when they give you their code.</Info>
        <p className="caption muted">Some things can't be sold on NosHen, such as anything stolen or fake. See the <Link to="/prohibited-items">prohibited items</Link>.</p>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy} iconRight="arrow-right">{busy ? "Saving…" : "Next: review"}</Button></BottomAction>
      </main>
    </CheckedForm>
  );
}
