import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import pg from "pg";
import type { EmailSender } from "@noshen/engine/email";

/** Google sign-in is offered only when its OAuth client is configured. */
export const googleEnabled = () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
/** Email codes are offered only when email can be sent (not on a public demo without an email provider). */
export const emailSignInEnabled = () => env.EMAIL !== "none";

/**
 * Sign-in for the customer site, with Better Auth. Buyers and sellers use a 6-digit code sent to their
 * email, or Google. There are no passwords here: staff sign in on the staff site (apps/admin), which has
 * its own sign-in setup, cookies and secret, and staff accounts can't get a session on this site at all.
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
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    socialProviders: googleEnabled()
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } }
      : {},
    // Google checks the email, so a person who first used an email code and later uses Google
    // (or the other way round) lands in the same account.
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    plugins: mail.enabled === false ? [] : [
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
    ],
    databaseHooks: {
      // Nor can Google (or any other sign-in) be attached to a staff account from the customer site.
      account: {
        create: {
          before: async (account) => {
            const staff = await pool.query("select 1 from staff where auth_user_id = $1", [account.userId]);
            if (staff.rowCount) return false;
          },
        },
      },
      session: {
        create: {
          // A staff account never gets a session on the customer site, whatever the sign-in route.
          before: async (session) => {
            const staff = await pool.query("select 1 from staff where auth_user_id = $1", [session.userId]);
            if (staff.rowCount) return false;
          },
        },
      },
    },
  });
}

interface AuthUser { id: string; email: string; name: string; emailVerified?: boolean }

/** The parts of Better Auth that NosHen uses, typed explicitly (its inferred type is too large to name). */
export interface Auth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(o: { headers: Headers }): Promise<{ user: AuthUser; session: { id: string } } | null>;
    sendVerificationOTP(o: { body: { email: string; type: "sign-in" } }): Promise<unknown>;
    signInEmailOTP(o: { body: { email: string; otp: string }; headers: Headers; asResponse: true }): Promise<Response>;
    signInSocial(o: { body: { provider: "google"; callbackURL: string; errorCallbackURL?: string }; headers: Headers; asResponse: true }): Promise<Response>;
    signOut(o: { headers: Headers; asResponse: true }): Promise<Response>;
  };
}

export function createAuth(mail: EmailSender): Auth {
  return makeAuth(mail) as unknown as Auth;
}
