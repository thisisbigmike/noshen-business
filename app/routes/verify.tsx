import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/verify";
import { requireUser, withApp, messageOf } from "../../server/web";
import { addBankAccount, sellerReady, setName, verifiedName, verifyId } from "../../server/engine/sellers";
import { one } from "../../server/db";
import { isDev } from "../../server/context";
import { BottomAction, Button, ErrorText, Info, Select, TextField, TopBar } from "../components/ui";

export const handle = { tabs: false };
export const meta = () => [{ title: "Verify · NosHen" }];

const BANKS: [string, string][] = [["044", "Access Bank"], ["058", "GTBank"], ["057", "Zenith Bank"], ["011", "First Bank"], ["033", "UBA"], ["035", "Wema Bank"],
  ["070", "Fidelity Bank"], ["232", "Sterling Bank"], ["50515", "Moniepoint"], ["999992", "OPay"], ["999991", "PalmPay"], ["50211", "Kuda"]];
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/account");

export async function loader({ request }: Route.LoaderArgs) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  return withApp(async (d) => {
    const user = await requireUser(request, d);
    const ready = await sellerReady(d, user.id);
    if (ready.ready) throw redirect(next);
    const bank = await one(d.db, "select account_name from bank_accounts where user_id = $1 and removed_at is null order by created_at desc limit 1", [user.id]);
    return { next, name: user.full_name, idName: await verifiedName(d, user.id), ready, dev: isDev(), lastBank: bank?.account_name ?? null };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const step = String(f.get("step"));
  const next = safeNext(String(f.get("next")));
  try {
    const done = await withApp(async (d) => {
      const user = await requireUser(request, d);
      if (step === "name") await setName(d, user.id, String(f.get("name") ?? ""));
      if (step === "id") await verifyId(d, user.id, f.get("type") === "bvn" ? "bvn" : "nin", String(f.get("number") ?? ""));
      if (step === "bank") await addBankAccount(d, user.id, String(f.get("bank")), String(f.get("account") ?? ""));
      return (await sellerReady(d, user.id)).ready;
    });
    if (done) return redirect(next);
    return { ok: true, step };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { error: messageOf(e), step };
  }
}

export default function Verify({ loaderData: x, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const err = (s: string) => (actionData && "error" in actionData && actionData.step === s ? actionData.error : undefined);
  const step = !x.name ? "name" : !x.ready.idOk ? "id" : "bank";
  return (
    <Form method="post">
      <TopBar title="Verify to sell" back={x.next} />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading">{step === "bank" ? "Where should we pay you?" : step === "id" ? "Verify your ID" : "Your name"}</h1>
        <p className="body muted">{step === "bank"
          ? `Add a bank account in your own name (${x.idName}). Payouts go only to this account.`
          : step === "id" ? "So buyers can trust you and we can pay you. We check your NIN or BVN with an identity provider, and keep only the result and your verified name, never the number."
          : "Use the name on your bank account."}</p>
        <input type="hidden" name="step" value={step} />
        <input type="hidden" name="next" value={x.next} />
        {step === "name" ? <TextField label="Full name" name="name" autoComplete="name" required error={err("name")} /> : null}
        {step === "id" ? (
          <>
            <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ marginBottom: 8 }}>ID type</legend>
              <label className="choice grow"><input type="radio" name="type" value="nin" defaultChecked /><span className="body">NIN</span></label>
              <label className="choice grow"><input type="radio" name="type" value="bvn" /><span className="body">BVN</span></label>
            </fieldset>
            <TextField label="Number" name="number" inputMode="numeric" maxLength={11} autoComplete="off" hint="11 digits" required error={err("id")} />
            {x.dev ? <p className="dev caption">Development: the identity check is pretend. Any 11 digits pass, with the name on your account.</p> : null}
          </>
        ) : null}
        {step === "bank" ? (
          <>
            <Select name="bank" label="Bank" defaultValue="058" options={BANKS.map(([c, n]) => ({ value: c, label: n }))} />
            <TextField label="Account number" name="account" inputMode="numeric" maxLength={10} autoComplete="off" hint="10 digits" required error={err("bank")} />
            {x.dev ? <p className="dev caption">Development: the pretend bank says every account belongs to the name on your NosHen account.</p> : null}
          </>
        ) : null}
        <Info icon="lock">NosHen staff can't change your bank details. Only you can, after a fresh sign-in code.</Info>
        <ErrorText>{undefined}</ErrorText>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Checking…" : step === "bank" ? "Check and save" : "Continue"}</Button></BottomAction>
      </main>
    </Form>
  );
}
