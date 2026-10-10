import { Form, Link, redirect, useNavigation, data } from "react-router";
import type { Route } from "./+types/signin";
import { createAuth, googleEnabled } from "../../server/auth";
import { ConsoleEmail } from "@noshen/engine/email";
import { optionalUser, withApp, messageOf } from "../../server/web";
import { setName } from "@noshen/engine/sellers";
import { mailFor, isDev } from "@noshen/engine/context";
import { BottomAction, Button, CheckedForm, CodeInput, Icon, TextField, TopBar, Info, ErrorText, Wordmark } from "@noshen/ui/ui";
import { emailProblem, nameProblem } from "@noshen/shared/validate";
import type { IconName } from "@noshen/ui/icons";

export const handle = { tabs: false };
export const meta = () => [{ title: "Sign in · NosHen" }];

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/deals");

function forwardCookies(res: Response) {
  const headers = new Headers();
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return headers;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const user = await optionalUser(request);
  const next = safeNext(url.searchParams.get("next"));
  if (user && user.full_name) throw redirect(next);
  return { needsName: !!user && !user.full_name, next, google: googleEnabled(), dev: isDev(), googleError: url.searchParams.get("error") === "google" };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const step = String(form.get("step"));
  const next = safeNext(String(form.get("next") ?? ""));
  const back = `/signin?next=${encodeURIComponent(next)}`;

  if (step === "google") {
    if (!googleEnabled()) return { step: "email" as const, error: "Google sign-in isn't set up yet. Use your email instead." };
    const res = await createAuth(mailFor()).api.signInSocial({
      body: { provider: "google", callbackURL: back, errorCallbackURL: `${back}&error=google` }, headers: request.headers, asResponse: true,
    });
    const body = (await res.clone().json().catch(() => ({}))) as { url?: string };
    if (!res.ok || !body.url) return { step: "email" as const, error: "We couldn't reach Google just now. Try again, or use your email." };
    return redirect(body.url, { headers: forwardCookies(res) });
  }

  if (step === "email") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const problem = emailProblem(email);
    if (problem) return { step: "email" as const, error: problem };
    const mail = mailFor();
    try {
      await createAuth(mail).api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    } catch {
      return { step: "email" as const, error: "We couldn't send a code just now. Wait a minute and try again." };
    }
    const devCode = isDev() && mail instanceof ConsoleEmail ? mail.sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0] : undefined;
    return { step: "code" as const, email, devCode };
  }

  if (step === "code") {
    const email = String(form.get("email"));
    const otp = String(form.get("code") ?? "").replace(/\D/g, "");
    if (otp.length !== 6) return { step: "code" as const, email, error: "Enter all 6 digits." };
    const res = await createAuth(mailFor()).api.signInEmailOTP({ body: { email, otp }, headers: request.headers, asResponse: true }).catch(() => null);
    if (!res?.ok) return { step: "code" as const, email, error: "That code doesn’t match or has expired. Check it, or ask for a new one." };
    return redirect(back, { headers: forwardCookies(res) });
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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Sign-in steps sit in one card; on wide screens a panel beside it repeats the promise. */
function AuthFrame({ title, back, icon, heading, sub, children }: { title: string; back?: string; icon: IconName; heading: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <TopBar title={title} back={back} />
      <main className="auth-wrap">
        <div className="auth-box stack-4">
          <span className="auth-icon"><Icon name={icon} size={26} /></span>
          <div className="stack">
            <h1 className="heading">{heading}</h1>
            <p className="body muted">{sub}</p>
          </div>
          {children}
        </div>
        <aside className="auth-aside" aria-hidden="true">
          <Wordmark size="md" />
          <p className="auth-aside-title">Your money is held until you have the item.</p>
          <ul>
            <li><Icon name="building-bank" size={18} />A licensed partner bank holds every payment.</li>
            <li><Icon name="shield-lock" size={18} />Your release code lives only in the app.</li>
            <li><Icon name="scale" size={18} />A real person decides any problem within 72 hours.</li>
          </ul>
        </aside>
      </main>
    </div>
  );
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const a = actionData as any;
  const step = loaderData.needsName ? "name" : a?.step === "code" ? "code" : "email";
  const formAction = `/signin?next=${encodeURIComponent(loaderData.next)}`;

  if (step === "name") {
    return (
      <CheckedForm method="post" action={formAction}>
        <AuthFrame title="Your name" icon="user" heading="What's your name?" sub="Use the name on your bank account. Payments are checked against it, and the other person in a deal sees your first name.">
          <input type="hidden" name="step" value="name" />
          <input type="hidden" name="next" value={loaderData.next} />
          <TextField label="Full name" name="name" autoComplete="name" placeholder="Chioma Obi" required error={a?.error} autoFocus
            missing="Enter your full name, as it is on your bank account." validate={nameProblem} />
          <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button></BottomAction>
        </AuthFrame>
      </CheckedForm>
    );
  }

  if (step === "code") {
    return (
      <CheckedForm method="post" action={formAction}>
        <AuthFrame title="Sign in" back={formAction} icon="message-circle" heading="Check your email" sub={<>We sent a 6-digit code to <strong className="ink">{a.email}</strong>. It expires in 5 minutes.</>}>
          <input type="hidden" name="step" value="code" />
          <input type="hidden" name="email" value={a.email} />
          <input type="hidden" name="next" value={loaderData.next} />
          <CodeInput name="code" label="Sign-in code" autoFocus error={a?.error} hint="Not there? Check your spam folder, or go back and ask for a new code." />
          {a?.devCode ? <p className="dev caption">Development: no email is sent. Your code is <strong className="tabular">{a.devCode}</strong>.</p> : null}
          <BottomAction><Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button></BottomAction>
        </AuthFrame>
      </CheckedForm>
    );
  }

  return (
    <AuthFrame title="Sign in" back="/" icon="shield-check" heading="Sign in to NosHen" sub="New here? The same steps create your account.">
      {loaderData.googleError ? <ErrorText>Google sign-in didn't finish. Try again, or use your email.</ErrorText> : null}
      {loaderData.google ? (
        <Form method="post" action={formAction}>
          <input type="hidden" name="step" value="google" />
          <input type="hidden" name="next" value={loaderData.next} />
          <button type="submit" className="nh-btn nh-btn-secondary nh-btn-lg nh-btn-block" disabled={busy}><GoogleMark />Continue with Google</button>
        </Form>
      ) : loaderData.dev ? (
        <p className="dev caption">Development: Google sign-in appears here once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in .dev.vars.</p>
      ) : null}
      {loaderData.google ? <div className="or-rule"><span className="caption muted">or</span></div> : null}
      <CheckedForm method="post" action={formAction} className="stack-4">
        <input type="hidden" name="step" value="email" />
        <input type="hidden" name="next" value={loaderData.next} />
        <TextField label="Email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="chioma@gmail.com"
          hint="We'll email you a 6-digit code. No password needed." error={a?.step === "email" ? a.error : undefined} required autoFocus={!loaderData.google}
          missing="Enter your email address, so we can send you a code." validate={emailProblem} />
        <Button type="submit" variant="primary" size="lg" block disabled={busy} iconRight={busy ? undefined : "arrow-right"}>{busy && nav.formData?.get("step") === "email" ? "Sending…" : "Email me a code"}</Button>
      </CheckedForm>
      <Info icon="shield-check">We never show your email to the other person. You talk in the deal chat.</Info>
      <p className="caption muted consent">By continuing, you agree to NosHen's <Link to="/terms">Terms of Use</Link> and <Link to="/deal-terms">Protected Deal Terms</Link>, and you've read our <Link to="/privacy">Privacy Policy</Link>.</p>
    </AuthFrame>
  );
}
