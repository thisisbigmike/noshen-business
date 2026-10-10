import { Form, Link, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/buy";
import { requireUser, withApp, messageOf } from "../../server/web";
import { listingView } from "../../server/engine/queries";
import { settingsOf } from "../../server/engine/core";
import { requestDeal } from "../../server/engine/deals";
import { BottomAction, Button, ErrorText, Icon, Kv, TextArea, TopBar, Info } from "../components/ui";
import { feeFor, naira } from "../../shared/money";
import { firstName } from "../../shared/deal";
import { photoUrl } from "../../shared/photos";
import { categoryOf } from "../../shared/categories";

export const handle = { tabs: false };
export const meta = () => [{ title: "Buy request · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await listingView(d.db, params.id);
    if (!v || v.listing.status !== "live") throw data("Not found", { status: 404 });
    if (v.listing.seller_id === user.id) throw redirect(`/l/${params.id}`);
    const s = await settingsOf(d);
    return { ...v, fee: feeFor(Number(v.listing.price_kobo), s.fee) };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const dealId = await withApp(async (d) => {
      const user = await requireUser(request, d);
      return requestDeal(d, user.id, {
        listingId: params.id,
        handover: form.get("handover") === "delivery" ? "delivery" : "meetup",
        note: String(form.get("note") ?? ""),
      });
    });
    return redirect(`/d/${dealId}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = messageOf(e);
    return { error: msg, needsId: msg.includes("verify your ID") };
  }
}

export default function Buy({ loaderData, actionData }: Route.ComponentProps) {
  const { listing: l, seller, fee } = loaderData;
  const noun = categoryOf(l.category).noun;
  const busy = useNavigation().state !== "idle";
  const name = firstName(seller.name);
  const price = Number(l.price_kobo);
  return (
    <Form method="post">
      <TopBar title="Buy request" back={`/l/${l.id}`} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading desktop-only">Buy request</h1>
        <div className="card row">
          <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "var(--canvas)", flex: "none" }}>
            {l.photo_keys?.[0] ? <img src={photoUrl(l.photo_keys[0])} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="camera" />}
          </div>
          <div className="grow"><p className="title">{l.title}</p><p className="caption muted">{name} · {l.area}, Lagos</p></div>
        </div>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>How do you want to get it?</legend>
          <label className="choice">
            <input type="radio" name="handover" value="meetup" defaultChecked />
            <span className="stack"><span className="title row"><Icon name="map-pin" size={18} />Meet-up</span>
              <span className="caption muted">Meet {name} in a public place in {l.area}. Check the {noun} before you give your code.</span></span>
          </label>
          <label className="choice">
            <input type="radio" name="handover" value="delivery" />
            <span className="stack"><span className="title row"><Icon name="truck-delivery" size={18} />Delivery</span>
              <span className="caption muted">{name} sends it to you. Check it when it arrives, before you confirm.</span></span>
          </label>
        </fieldset>

        <section className="card">
          <p className="label">What you'll pay</p>
          <Kv k="Price" v={naira(price)} />
          <Kv k="NosHen fee" v={naira(fee)} />
          <Kv k="Total" v={naira(price + fee)} total />
        </section>

        <TextArea label={`Note to ${name} (optional)`} name="note" placeholder="When and where works for you?" maxLength={500} />
        <Info icon="shield-check">You pay nothing until {name} accepts. Then you pay NosHen, and we hold the money until you have the {noun}.</Info>
        <p className="caption muted">Sending a request means you agree to the <Link to="/deal-terms">Protected Deal Terms</Link>.</p>
        <ErrorText>{actionData?.error}</ErrorText>
        {actionData?.needsId ? <Link to={`/account/verify?next=/l/${l.id}/buy`}>Verify your ID</Link> : null}
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Sending…" : "Send request"}</Button></BottomAction>
      </main>
    </Form>
  );
}
