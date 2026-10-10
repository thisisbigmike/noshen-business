import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { emailOTP, twoFactor } from "better-auth/plugins";
import pg from "pg";
import type { EmailSender } from "./email";

/** Google sign-in is offered only when its OAuth client is configured. */
export const googleEnabled = () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// Staff may only get a session through their password and, once set up, their authenticator code.
const STAFF_SIGN_IN_PATHS = new Set(["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/**
 * Sign-in with Better Auth. Buyers and sellers use a 6-digit code sent to their email, or Google.
 * Staff use email, password and an authenticator app (two-factor); public password sign-up is off.
 * One instance per request: Workers can't share database connections between requests.
 */
function makeAuth(mail: EmailSender) {
  const pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return betterAuth({
    appName: "NosHen",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    socialProviders: googleEnabled()
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } }
      : {},
    // Google checks the email, so a person who first used an email code and later uses Google
    // (or the other way round) lands in the same account.
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") return;
          await mail.send({
            to: email,
            subject: `Your NosHen sign-in code: ${otp}`,
            text: `Your NosHen sign-in code is ${otp}. It expires in 5 minutes.\n\nNever share it with anyone. NosHen will never ask you for it.\n\nIf you didn't try to sign in, you can ignore this email.`,
          });
        },
      }),
      twoFactor({ issuer: "NosHen staff" }),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const staff = await pool.query("select 1 from staff where auth_user_id = $1", [session.userId]);
            if (staff.rowCount && !STAFF_SIGN_IN_PATHS.has(ctx?.path ?? "")) return false;
          },
        },
      },
    },
  });
}

interface AuthUser { id: string; email: string; name: string; emailVerified?: boolean; twoFactorEnabled?: boolean | null }

/** The parts of Better Auth that NosHen uses, typed explicitly (its inferred type is too large to name). */
export interface Auth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(o: { headers: Headers }): Promise<{ user: AuthUser; session: { id: string } } | null>;
    sendVerificationOTP(o: { body: { email: string; type: "sign-in" } }): Promise<unknown>;
    signInEmailOTP(o: { body: { email: string; otp: string }; headers: Headers; asResponse: true }): Promise<Response>;
    signInSocial(o: { body: { provider: "google"; callbackURL: string; errorCallbackURL?: string }; headers: Headers; asResponse: true }): Promise<Response>;
    signOut(o: { headers: Headers; asResponse: true }): Promise<Response>;
    signInEmail(o: { body: { email: string; password: string }; headers: Headers; asResponse: true }): Promise<Response>;
    verifyTOTP(o: { body: { code: string; trustDevice?: boolean }; headers: Headers; asResponse: true }): Promise<Response>;
    enableTwoFactor(o: { body: { password: string }; headers: Headers }): Promise<{ totpURI: string; backupCodes: string[] }>;
  };
}

export function createAuth(mail: EmailSender): Auth {
  return makeAuth(mail) as unknown as Auth;
}
