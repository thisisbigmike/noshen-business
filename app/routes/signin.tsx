import { Form, redirect, useNavigation, data } from "react-router";
import type { Route } from "./+types/signin";
import { createAuth } from "../../server/auth";
import { ConsoleSms } from "../../server/sms";
import { optionalUser, withApp, messageOf } from "../../server/web";
import { setName } from "../../server/engine/sellers";
import { smsFor, isDev } from "../../server/context";
import { normalisePhone, displayPhone } from "../../shared/deal";
import { BottomAction, Button, CodeInput, TextField, TopBar, Info } from "../components/ui";

export const handle = { tabs: false };
export const meta = () => [{ title: "Sign in · NosHen" }];

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/deals");

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const user = await optionalUser(request);
  const next = safeNext(url.searchParams.get("next"));
  if (user && user.full_name) throw redirect(next);
  return { needsName: !!user && !user.full_name, next };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const step = String(form.get("step"));
  const next = safeNext(String(form.get("next") ?? ""));

  if (step === "phone") {
    const phone = normalisePhone(String(form.get("phone") ?? ""));
    if (!phone) return { step: "phone" as const, error: "Enter a Nigerian mobile number, like 0803 412 7765." };
    const sms = smsFor();
    try {
      await createAuth(sms).api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
    } catch (e) {
      return { step: "phone" as const, error: "We couldn't send a code just now. Wait a minute and try again." };
    }
    const devCode = isDev() && sms instanceof ConsoleSms ? sms.sent.at(-1)?.text.match(/\d{6}/)?.[0] : undefined;
    return { step: "code" as const, phone, devCode };
  }

  if (step === "code") {
    const phone = String(form.get("phone"));
    const code = String(form.get("code") ?? "").replace(/\D/g, "");
    if (code.length !== 6) return { step: "code" as const, phone, error: "Enter all 6 digits." };
    let res: Response;
    try {
      res = await createAuth(smsFor()).api.verifyPhoneNumber({ body: { phoneNumber: phone, code, disableSession: false }, headers: request.headers, asResponse: true });
    } catch {
      return { step: "code" as const, phone, error: "That code doesn’t match or has expired. Check it, or ask for a new one." };
    }
    if (!res.ok) return { step: "code" as const, phone, error: "That code doesn’t match or has expired. Check it, or ask for a new one." };
    const headers = new Headers();
    for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
    return redirect(`/signin?next=${encodeURIComponent(next)}`, { headers });
  }

  if (step === "name") {
    const user = await optionalUser(request);
    if (!user) return redirect("/signin");
    try {
      await withApp((d) => setName(d, user.id, String(form.get("name") ?? "")));
    } catch (e) {
      return data({ step: "name" as const, error: messageOf(e) });
    }
    return redirect(next);
  }
  return null;
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const a = actionData as any;
  const step = loaderData.needsName ? "name" : a?.step === "code" ? "code" : "phone";
  const formAction = `/signin?next=${encodeURIComponent(loaderData.next)}`;

  if (step === "name") {
    return (
      <Form method="post" action={formAction}>
        <TopBar title="Your name" />
        <main className="page narrow no-tabs stack-4">
          <h1 className="heading">What's your name?</h1>
          <p className="body muted">Use the name on your bank account. Payments are checked against it, and sellers see your first name.</p>
          <input type="hidden" name="step" value="name" />
          <input type="hidden" name="next" value={loaderData.next} />
          <TextField label="Full name" name="name" autoComplete="name" placeholder="Chioma Obi" required error={a?.error} autoFocus />
          <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button></BottomAction>
        </main>
      </Form>
    );
  }

  if (step === "code") {
    return (
      <Form method="post" action={formAction}>
        <TopBar title="Sign in" back="/signin" />
        <main className="page narrow no-tabs stack-4">
          <h1 className="heading">Enter the 6-digit code</h1>
          <p className="body muted">We sent it by SMS to {displayPhone(a.phone)}.</p>
          <input type="hidden" name="step" value="code" />
          <input type="hidden" name="phone" value={a.phone} />
          <input type="hidden" name="next" value={loaderData.next} />
          <CodeInput name="code" label="SMS code" autoFocus error={a?.error} hint="Didn't get it? Go back and ask for a new code in a minute." />
          {a?.devCode ? <p className="dev caption">Development: no SMS is sent. Your code is <strong className="tabular">{a.devCode}</strong>.</p> : null}
          <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button></BottomAction>
        </main>
      </Form>
    );
  }

  return (
    <Form method="post" action={formAction}>
      <TopBar title="Sign in" back="/" />
      <main className="page narrow no-tabs stack-4">
        <h1 className="heading">What's your phone number?</h1>
        <p className="body muted">We'll text you a 6-digit code to sign in.</p>
        <input type="hidden" name="step" value="phone" />
        <input type="hidden" name="next" value={loaderData.next} />
        <TextField label="Phone number" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0803 412 7765"
          hint="11 digits, starting with 0" error={a?.error} required autoFocus />
        <Info icon="shield-check">We never show your number to the other person. You talk in the deal chat.</Info>
        <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? "Sending…" : "Send code"}</Button></BottomAction>
      </main>
    </Form>
  );
}

