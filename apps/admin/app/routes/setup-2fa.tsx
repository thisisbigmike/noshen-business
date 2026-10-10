import { redirect, useNavigation } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/setup-2fa";
import { createAuth } from "../../server/auth";
import { requireStaff } from "../../server/web";
import { Button, CheckedForm, CodeInput, ErrorText, Info, TextField, Wordmark } from "@noshen/ui/ui";

export const meta = () => [{ title: "Set up two-factor · NosHen staff" }];

export async function loader({ request }: Route.LoaderArgs) {
  const staff = await requireStaff(request, { allowWithout2fa: true });
  if (staff.twoFactorEnabled) throw redirect("/");
  return { name: staff.name };
}

/**
 * The setup link as a QR code for the authenticator app to scan. Drawn here on the server, so the key is
 * never sent to an outside QR service. Dark on white with a wide margin, which phones read best.
 */
const qrFor = (uri: string) => renderSVG(uri, { ecc: "M", border: 4, pixelSize: 8, blackColor: "#000", whiteColor: "#fff" });

export async function action({ request }: Route.ActionArgs) {
  await requireStaff(request, { allowWithout2fa: true });
  const f = await request.formData();
  const auth = createAuth();
  if (f.get("step") === "verify") {
    const res = await auth.api.verifyTOTP({ body: { code: String(f.get("code") ?? "") }, headers: request.headers, asResponse: true }).catch(() => null);
    if (!res?.ok) {
      const uri = String(f.get("uri") ?? "");
      return { step: "verify" as const, uri, qr: uri.startsWith("otpauth://") ? qrFor(uri) : null, codes: JSON.parse(String(f.get("codes") ?? "[]")) as string[], error: "That code doesn’t match. Wait for the next code and try again." };
    }
    const headers = new Headers();
    for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
    return redirect("/", { headers });
  }
  try {
    const r = await auth.api.enableTwoFactor({ body: { password: String(f.get("password") ?? "") }, headers: request.headers });
    return { step: "verify" as const, uri: r.totpURI, qr: qrFor(r.totpURI), codes: r.backupCodes };
  } catch (e) {
    // Only a wrong password is the person's to fix; anything else is logged for us.
    if ((e as { body?: { code?: string } })?.body?.code === "INVALID_PASSWORD") return { step: "password" as const, error: "That password isn't right." };
    console.error("two-factor setup failed", e);
    return { step: "password" as const, error: "We couldn't start the setup. Please try again in a minute." };
  }
}

export default function Setup2fa({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const a = actionData as any;
  const secret = a?.uri ? new URL(a.uri).searchParams.get("secret") : null;
  return (
    <main className="auth-page">
      <CheckedForm method="post" className="auth-card">
        <Wordmark size="md" />
        <h1 className="heading">Turn on two-factor sign-in</h1>
        {a?.step === "verify" ? (
          <>
            <p className="body">Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password), tap <strong>+</strong> or <strong>Scan a QR code</strong>, and point your phone at this code:</p>
            {a.qr ? <div className="totp-qr" role="img" aria-label="QR code that adds NosHen staff to your authenticator app" dangerouslySetInnerHTML={{ __html: a.qr }} /> : null}
            <details>
              <summary className="caption">Can’t scan it? Type this key instead</summary>
              <p className="release-code" style={{ fontSize: 18, letterSpacing: "0.08em", wordBreak: "break-all", marginTop: 8 }}>{secret?.match(/.{1,4}/g)?.join(" ")}</p>
              <p className="caption muted">Choose “Enter a setup key”, name it NosHen staff, and keep it time-based.</p>
            </details>
            <Info icon="lock">Save these backup codes in your password manager, not in a screenshot or chat. Each works once if you lose your phone: {a.codes?.join(", ")}</Info>
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
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required autoFocus missing="Enter your password to start." />
            <ErrorText>{a?.error}</ErrorText>
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>Continue</Button>
          </>
        )}
      </CheckedForm>
    </main>
  );
}
