import { data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/enter-code";
import { requireUser, withApp, messageOf } from "../../server/web";
import { dealView } from "../../server/engine/queries";
import { releaseByCode } from "../../server/engine/deals";
import { BottomAction, Button, CheckedForm, CodeInput, Info, MoneyStatus, TopBar } from "../components/ui";
import { naira } from "../../shared/money";
import { firstName } from "../../shared/deal";

export const handle = { tabs: false };
export const meta = () => [{ title: "Enter release code · NosHen" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const v = await dealView(d.db, params.id);
    if (!v || v.deal.seller_id !== user.id) throw data("Not found", { status: 404 });
    if (v.deal.state !== "held") throw redirect(`/d/${params.id}`);
    return { dealId: v.deal.id, share: v.deal.seller_share_kobo, buyer: firstName(v.buyer.name), last4: v.sellerBank?.account_last4 ?? null };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const r = await withApp(async (d) => releaseByCode(d, (await requireUser(request, d)).id, params.id, String(form.get("code") ?? "")));
    if (r.ok) return redirect(`/d/${params.id}`);
    return { error: r.message };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e) };
  }
}

export default function EnterCode({ loaderData: x, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const amount = naira(x.share);
  return (
    <CheckedForm method="post">
      <TopBar title="Enter release code" back={`/d/${x.dealId}`} />
      <main className="page narrow no-tabs stack-4">
        <div className="row"><MoneyStatus state="held">{amount} held for you</MoneyStatus></div>
        <h1 className="heading">Ask {x.buyer} for the code</h1>
        <p className="body muted">It's on {x.buyer}'s phone. Enter it here and {amount} is released to your bank{x.last4 ? ` ••${x.last4}` : ""}.</p>
        <CodeInput name="code" autoFocus error={actionData?.error} />
        <Info icon="info-circle">If {x.buyer} isn't happy with the item, they won't give you the code. Talk it through, or they can report a problem and a reviewer will decide.</Info>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Release {amount}</Button></BottomAction>
      </main>
    </CheckedForm>
  );
}
