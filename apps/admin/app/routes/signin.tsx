import { redirect, useNavigation } from "react-router";
import type { Route } from "./+types/signin";
import { createAuth } from "../../server/auth";
import { Button, CheckedForm, CodeInput, ErrorText, TextField, Wordmark } from "@noshen/ui/ui";
import { emailProblem } from "@noshen/shared/validate";

export const meta = () => [{ title: "Staff sign in · NosHen" }];

function forward(res: Response) {
  const headers = new Headers();
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return headers;
}

export async function action({ request }: Route.ActionArgs) {
  const f = await request.formData();
  const auth = createAuth();
  if (f.get("step") === "totp") {
    const res = await auth.api.verifyTOTP({ body: { code: String(f.get("code") ?? "") }, headers: request.headers, asResponse: true }).catch(() => null);
    if (!res?.ok) return { step: "totp" as const, error: "That code doesn’t match. Check your authenticator app and try again." };
    return redirect("/", { headers: forward(res) });
  }
  const res = await auth.api.signInEmail({ body: { email: String(f.get("email") ?? "").trim(), password: String(f.get("password") ?? "") }, headers: request.headers, asResponse: true }).catch(() => null);
  if (!res?.ok) return { step: "password" as const, error: "That email and password don’t match a staff account." };
  const body = (await res.clone().json().catch(() => ({}))) as { twoFactorRedirect?: boolean };
  if (body.twoFactorRedirect) return redirect("/signin?step=2fa", { headers: forward(res) });
  return redirect("/", { headers: forward(res) });
}

export async function loader({ request }: Route.LoaderArgs) {
  const u = new URL(request.url);
  const error = u.searchParams.get("error");
  return { step: u.searchParams.get("step") === "2fa" ? "totp" : "password", notStaff: error === "not-staff", accessMismatch: error === "access-mismatch" };
}

export default function StaffSignIn({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const step = actionData?.step ?? loaderData.step;
  return (
    <main className="auth-page">
      <CheckedForm method="post" className="auth-card">
        <Wordmark size="md" />
        {step === "totp" ? (
          <>
            <h1 className="heading">Enter your two-factor code</h1>
            <p className="body muted">Open your authenticator app and enter the 6-digit code for NosHen staff.</p>
            <input type="hidden" name="step" value="totp" />
            <CodeInput name="code" label="Authenticator code" autoFocus error={actionData?.error} />
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>Sign in</Button>
            <a href="/signin" className="caption">Use a different account</a>
          </>
        ) : (
          <>
            <h1 className="heading">Sign in</h1>
            <p className="body muted">Staff only. Use your NosHen work email.</p>
            {loaderData.notStaff ? <ErrorText>That account isn't an active staff account.</ErrorText> : null}
            {loaderData.accessMismatch ? <ErrorText>Sign in with the same work email you used for Cloudflare Access.</ErrorText> : null}
            <input type="hidden" name="step" value="password" />
            <TextField label="Email" name="email" type="email" autoComplete="username" required autoFocus missing="Enter your NosHen work email." validate={emailProblem} />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required error={actionData?.error} missing="Enter your password." />
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button>
          </>
        )}
        <p className="caption muted">Every sign-in and every action you take is recorded in the audit log.</p>
      </CheckedForm>
    </main>
  );
}
