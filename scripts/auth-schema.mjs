// Used only to generate Better Auth's tables (db/migrations/0002). The real configs are apps/web/server/auth.ts (customers) and apps/admin/server/auth.ts (staff).
import { betterAuth } from "better-auth";
import { phoneNumber, twoFactor } from "better-auth/plugins";
import pg from "pg";

export const auth = betterAuth({
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [phoneNumber({ sendOTP: async () => {} }), twoFactor()],
});
