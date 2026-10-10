import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";

// Staff get a session only through their password and then their authenticator code.
const STAFF_SIGN_IN_PATHS = new Set(["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/**
 * Sign-in for the staff site, with Better Auth: email, password and an authenticator app (two-factor).
 * It is separate from the customer site's sign-in: its own secret (BETTER_AUTH_SECRET in this Worker),
 * its own cookie names ("noshen-staff.*"), shorter sessions, and no email codes, Google or sign-up.
 * One instance per request: Workers can't share database connections between requests.
 */
function makeAuth() {
  const pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return betterAuth({
    appName: "NosHen staff",
    baseURL: env.ADMIN_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [env.ADMIN_URL],
    emailAndPassword: { enabled: true, disableSignUp: true },
    // A working day: staff sign in again each morning.
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    // Different cookie names from the customer site, so the two never mix (in development they share localhost).
    advanced: { cookiePrefix: "noshen-staff" },
    plugins: [twoFactor({ issuer: "NosHen staff" })],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!STAFF_SIGN_IN_PATHS.has(ctx?.path ?? "")) return false;
            const staff = await pool.query("select 1 from staff where auth_user_id = $1 and status = 'active'", [session.userId]);
            if (!staff.rowCount) return false;
          },
        },
      },
    },
  });
}

interface AuthUser { id: string; email: string; name: string; twoFactorEnabled?: boolean | null }

/** The parts of Better Auth the staff site uses, typed explicitly (its inferred type is too large to name). */
export interface StaffAuth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(o: { headers: Headers }): Promise<{ user: AuthUser; session: { id: string } } | null>;
    signOut(o: { headers: Headers; asResponse: true }): Promise<Response>;
    signInEmail(o: { body: { email: string; password: string }; headers: Headers; asResponse: true }): Promise<Response>;
    verifyTOTP(o: { body: { code: string; trustDevice?: boolean }; headers: Headers; asResponse: true }): Promise<Response>;
    enableTwoFactor(o: { body: { password: string }; headers: Headers }): Promise<{ totpURI: string; backupCodes: string[] }>;
  };
}

export function createAuth(): StaffAuth {
  return makeAuth() as unknown as StaffAuth;
}
