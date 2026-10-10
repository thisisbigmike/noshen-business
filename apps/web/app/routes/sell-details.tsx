import { useState } from "react";
import { Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-details";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft, publish } from "@noshen/engine/sellers";
import { DealError } from "@noshen/engine/core";
import { one } from "@noshen/engine/db";
import { BottomAction, Button, CheckedForm, ErrorText, FieldError, Icon, Info, Select, TextArea, TextField, TopBar } from "@noshen/ui/ui";
import { AREAS, CONDITIONS, type Condition } from "@noshen/shared/deal";
import { CATEGORIES, categoryOf, idProblem, isCategory, type CategoryKey } from "@noshen/shared/categories";
import { feeFor, naira } from "@noshen/shared/money";
import { settingsOf } from "@noshen/engine/core";

export const meta = () => [{ title: "Details · Sell · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const l = await one(d.db, "select * from listings where id = $1", [params.id]);
    if (!l || l.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (l.status !== "draft") throw redirect(`/sell/${l.id}/share`);
    const st = await settingsOf(d);
    return { listing: l, min: st.deal_min_kobo, max: st.deal_max_kobo, fee: st.fee };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const f = await request.formData();
  const input = {
    category: (isCategory(f.get("category")) ? f.get("category") : "other") as CategoryKey,
    title: String(f.get("title") ?? ""), description: String(f.get("description") ?? ""),
    priceNaira: Number(String(f.get("price") ?? "").replace(/[^\d]/g, "")), condition: String(f.get("condition")) as Condition,
    area: String(f.get("area") ?? "Yaba"), imeiOrSerial: String(f.get("imei") ?? ""),
  };
  try {
    await withApp(async (d) => {
      const user = await requireUser(request, d);
      await saveDraft(d, user.id, params.id, [], input);
      try {
        await publish(d, user.id, params.id);
      } catch (e) {
        if (e instanceof DealError && e.code === "seller_checks") throw redirect(`/account/verify?next=${encodeURIComponent(`/sell/${params.id}/details`)}`);
        throw e;
      }
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
  return redirect(`/sell/${params.id}/share`);
}

export default function SellDetails({ loaderData: { listing: l, min, max, fee }, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const untouched = l.title === "Untitled listing";
  const [cat, setCat] = useState<string>(untouched ? "" : l.category);
  const [cond, setCond] = useState<string>(l.condition);
  const [price, setPrice] = useState<string>(untouched ? "" : String(Number(l.price_kobo) / 100));
  const p = Number(price.replace(/[^\d]/g, "")) * 100;
  const c = cat ? categoryOf(cat) : null;
  return (
    <CheckedForm method="post">
      <TopBar title={<span>Details <span className="caption muted">Step 2 of 3</span></span>} back="/sell" />
      <main className="page narrow stack-4">
        <h1 className="heading desktop-only">Details <span className="caption muted">Step 2 of 3</span></h1>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>What are you selling?</legend>
          <div className="cat-grid">
            {CATEGORIES.map((x) => (
              <label key={x.key} className="cat-choice">
                <input type="radio" name="category" value={x.key} checked={cat === x.key} onChange={() => setCat(x.key)} required data-missing="Choose what you're selling, so buyers can find it." />
                <span className="cat-icon"><Icon name={x.icon} size={22} /></span>
                <span className="body">{x.label}</span>
              </label>
            ))}
          </div>
          <FieldError name="category" />
        </fieldset>
        <TextField label="Title" name="title" defaultValue={untouched ? "" : l.title} placeholder={c?.titleExample ?? "What it is, in a few words"} maxLength={80} required
          missing={`Give it a title, like “${c?.titleExample ?? "iPhone 13, 128GB"}”.`} validate={(v) => (v.trim().length < 3 ? `Make the title a little longer: at least 3 characters, like “${c?.titleExample ?? "iPhone 13, 128GB"}”.` : null)} />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Condition</legend>
          {CONDITIONS.map(([v, label, hint]) => (
            <label key={v} className="choice"><input type="radio" name="condition" value={v} checked={cond === v} onChange={() => setCond(v)} /><span className="stack" style={{ gap: 0 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span></label>
          ))}
        </fieldset>
        <TextField label="Price (₦)" name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d,]/g, ""))} placeholder="45,000" required missing="Enter a price in naira, like 45,000."
          validate={(v) => { const k = Number(v.replace(/[^\d]/g, "")) * 100; return k < min ? `The lowest price on NosHen is ${naira(min)}. You've entered ${naira(k)}.` : k > max ? `The highest price on NosHen is ${naira(max)}. You've entered ${naira(k)}.` : null; }}
          hint={p >= min && p <= max ? `The buyer pays ${naira(p + feeFor(p, fee))} with NosHen's fee. You get ${naira(p)}.` : `From ${naira(min)} to ${naira(max)}.`} />
        <Select name="area" label="Area" defaultValue={l.area} options={AREAS.map((a) => ({ value: a, label: `${a}, Lagos` }))} />
        {c?.id ? (
          <TextField key={c.key} label={c.id.label} name="imei" inputMode={c.id.numeric ? "numeric" : "text"} autoCapitalize="characters" defaultValue={l.category === c.key ? l.imei_or_serial ?? "" : ""}
            hint={c.id.hint} required={c.id.required} missing={idProblem(c.key, "") ?? undefined} validate={(v) => idProblem(c.key, v)} />
        ) : null}
        <TextArea label="Description (optional)" name="description" defaultValue={l.description ?? ""} maxLength={2000} placeholder={c?.describeHint ?? "Its condition, how long you've had it, and what comes with it."} />
        <Info icon="shield-check">Your listing shows "Protected by NosHen". Buyers pay NosHen, and you're paid when they give you their code.</Info>
        <p className="caption muted">Some things can't be sold on NosHen, such as anything stolen or fake. See the <Link to="/prohibited-items">prohibited items</Link>.</p>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Publishing…" : "Publish listing"}</Button></BottomAction>
      </main>
    </CheckedForm>
  );
}
