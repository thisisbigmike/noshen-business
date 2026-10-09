import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { phoneNumber, twoFactor } from "better-auth/plugins";
import pg from "pg";
import type { SmsSender } from "./sms";

/**
 * Sign-in with Better Auth. Buyers and sellers use their phone number and an SMS code.
 * Staff use email, password and an authenticator app (two-factor); public email sign-up is off.
 * One instance per request: Workers can't share database connections between requests.
 */
function makeAuth(sms: SmsSender) {
  return betterAuth({
    appName: "NosHen",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 }),
    trustedOrigins: [env.APP_URL],
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        phoneNumberValidator: (p) => /^\+234[0-9]{10}$/.test(p),
        sendOTP: async ({ phoneNumber: to, code }) => {
          await sms.send(to, `NosHen: your sign-in code is ${code}. It expires in 5 minutes. Never share it with anyone.`);
        },
        signUpOnVerification: {
          getTempEmail: (p) => `${p.replace(/\D/g, "")}@phone.noshen.invalid`,
          getTempName: (p) => p,
        },
      }),
      twoFactor({ issuer: "NosHen staff" }),
    ],
  });
}

interface AuthUser { id: string; email: string; name: string; phoneNumber?: string | null; twoFactorEnabled?: boolean | null }

/** The parts of Better Auth that NosHen uses, typed explicitly (its inferred type is too large to name). */
export interface Auth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(o: { headers: Headers }): Promise<{ user: AuthUser; session: { id: string } } | null>;
    sendPhoneNumberOTP(o: { body: { phoneNumber: string } }): Promise<unknown>;
    verifyPhoneNumber(o: { body: { phoneNumber: string; code: string; disableSession?: boolean }; headers: Headers; asResponse: true }): Promise<Response>;
    signOut(o: { headers: Headers; asResponse: true }): Promise<Response>;
    signInEmail(o: { body: { email: string; password: string }; headers: Headers; asResponse: true }): Promise<Response>;
    verifyTOTP(o: { body: { code: string; trustDevice?: boolean }; headers: Headers; asResponse: true }): Promise<Response>;
    enableTwoFactor(o: { body: { password: string }; headers: Headers }): Promise<{ totpURI: string; backupCodes: string[] }>;
  };
}

export function createAuth(sms: SmsSender): Auth {
  return makeAuth(sms) as unknown as Auth;
}
