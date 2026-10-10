import { useState } from "react";
import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/sell-details";
import { requireUser, withApp, messageOf } from "../../server/web";
import { saveDraft, publish } from "../../server/engine/sellers";
import { DealError } from "../../server/engine/core";
import { one } from "../../server/db";
import { BottomAction, Button, ErrorText, Icon, Info, TextArea, TextField, TopBar } from "../components/ui";
import { AREAS, CONDITIONS, type Condition } from "../../shared/deal";
import { CATEGORIES, categoryOf, isCategory, type CategoryKey } from "../../shared/categories";
import { feeFor, naira } from "../../shared/money";
import { settingsOf } from "../../server/engine/core";

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
    <Form method="post">
      <TopBar title={<span>Details <span className="caption muted">Step 2 of 3</span></span>} back="/sell" />
      <main className="page narrow stack-4">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>What are you selling?</legend>
          <div className="cat-grid">
            {CATEGORIES.map((x) => (
              <label key={x.key} className="cat-choice">
                <input type="radio" name="category" value={x.key} checked={cat === x.key} onChange={() => setCat(x.key)} required />
                <span className="cat-icon"><Icon name={x.icon} size={22} /></span>
                <span className="body">{x.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextField label="Title" name="title" defaultValue={untouched ? "" : l.title} placeholder={c?.titleExample ?? "What it is, in a few words"} maxLength={80} required />
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>Condition</legend>
          {CONDITIONS.map(([v, label, hint]) => (
            <label key={v} className="choice"><input type="radio" name="condition" value={v} checked={cond === v} onChange={() => setCond(v)} /><span className="stack" style={{ gap: 0 }}><span className="body">{label}</span><span className="caption muted">{hint}</span></span></label>
          ))}
        </fieldset>
        <TextField label="Price (₦)" name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d,]/g, ""))} placeholder="45,000" required
          hint={p >= min && p <= max ? `The buyer pays ${naira(p + feeFor(p, fee))} with NosHen's fee. You get ${naira(p)}.` : `From ${naira(min)} to ${naira(max)}.`} />
        <div className="nh-field" style={{ maxWidth: "none" }}>
          <label className="nh-field-label label" htmlFor="area">Area</label>
          <select id="area" name="area" className="nh-input" defaultValue={l.area}>{AREAS.map((a) => <option key={a}>{a}</option>)}</select>
        </div>
        {c?.id ? (
          <TextField key={c.key} label={c.id.label} name="imei" inputMode={c.id.numeric ? "numeric" : "text"} autoCapitalize="characters" defaultValue={l.category === c.key ? l.imei_or_serial ?? "" : ""}
            hint={c.id.hint} required={c.id.required} />
        ) : null}
        <TextArea label="Description (optional)" name="description" defaultValue={l.description ?? ""} maxLength={2000} placeholder={c?.describeHint ?? "Its condition, how long you've had it, and what comes with it."} />
        <Info icon="shield-check">Your listing shows "Protected by NosHen". Buyers pay NosHen, and you're paid when they give you their code.</Info>
        <ErrorText>{actionData?.error}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Publishing…" : "Publish listing"}</Button></BottomAction>
      </main>
    </Form>
  );
}
