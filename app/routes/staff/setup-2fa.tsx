import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/setup-2fa";
import { createAuth } from "../../../server/auth";
import { smsFor } from "../../../server/context";
import { requireStaff } from "../../../server/web";
import { Button, CodeInput, ErrorText, Info, TextField, Wordmark } from "../../components/ui";

export const meta = () => [{ title: "Set up two-factor · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request, { allowWithout2fa: true });
  if (staff.twoFactorEnabled) throw redirect("/staff");
  return { name: staff.name };
}

export async function action({ request }: Route.ActionArgs) {
  await requireStaff(request, { allowWithout2fa: true });
  const f = await request.formData();
  const auth = createAuth(smsFor());
  if (f.get("step") === "verify") {
    const res = await auth.api.verifyTOTP({ body: { code: String(f.get("code") ?? "") }, headers: request.headers, asResponse: true }).catch(() => null);
    if (!res?.ok) return { step: "verify" as const, uri: String(f.get("uri")), codes: JSON.parse(String(f.get("codes") ?? "[]")) as string[], error: "That code doesn’t match. Wait for the next code and try again." };
    const headers = new Headers();
    for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
    return redirect("/staff", { headers });
  }
  try {
    const r = await auth.api.enableTwoFactor({ body: { password: String(f.get("password") ?? "") }, headers: request.headers });
    return { step: "verify" as const, uri: r.totpURI, codes: r.backupCodes };
  } catch {
    return { step: "password" as const, error: "That password isn't right." };
  }
}

export default function Setup2fa({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const a = actionData as any;
  const secret = a?.uri ? new URL(a.uri).searchParams.get("secret") : null;
  return (
    <main className="auth-page">
      <Form method="post" className="auth-card">
        <Wordmark size="md" />
        <h1 className="heading">Turn on two-factor sign-in</h1>
        {a?.step === "verify" ? (
          <>
            <p className="body">Add NosHen staff to your authenticator app (Google Authenticator, 1Password, Authy) with this key:</p>
            <p className="release-code" style={{ fontSize: 18, letterSpacing: "0.08em", wordBreak: "break-all" }}>{secret?.match(/.{1,4}/g)?.join(" ")}</p>
            <details><summary className="caption">Setup link for apps that accept it</summary><p className="caption" style={{ wordBreak: "break-all" }}>{a.uri}</p></details>
            <Info icon="lock">Save these backup codes somewhere safe. Each works once if you lose your phone: {a.codes?.join(", ")}</Info>
            <input type="hidden" name="step" value="verify" />
            <input type="hidden" name="uri" value={a.uri} />
            <input type="hidden" name="codes" value={JSON.stringify(a.codes ?? [])} />
            <CodeInput name="code" label="Code from your app" autoFocus error={a?.error} />
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>Turn on and continue</Button>
          </>
        ) : (
          <>
            <p className="body muted">{loaderData.name}, staff accounts need a second step at sign-in. Enter your password to start.</p>
            <input type="hidden" name="step" value="password" />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required autoFocus />
            <ErrorText>{a?.error}</ErrorText>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button>
          </>
        )}
      </Form>
    </main>
  );
}
