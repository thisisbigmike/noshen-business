// Creates a staff account (reviewer or admin) that signs in to /staff with email and password.
// Usage: pnpm staff:create "Tobi Bello" tobi@noshen.ng admin
// The password is printed once. Staff must turn on two-factor at first sign-in.
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { databaseUrl } from "./db-url.mjs";

export async function createStaff(db, name, email, role, password) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())`, [id, name, email]);
  await db.query(
    `insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), id, await hashPassword(password)]);
  const r = await db.query("insert into staff (email, name, role, auth_user_id) values ($1, $2, $3, $4) returning id", [email, name, role, id]);
  return r.rows[0].id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name, email, role = "reviewer"] = process.argv.slice(2);
  if (!name || !email || !["reviewer", "admin"].includes(role)) {
    console.error('Usage: pnpm staff:create "Full Name" email@noshen.ng [reviewer|admin]');
    process.exit(1);
  }
  const password = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  await createStaff(db, name, email, role, password);
  await db.end();
  console.log(`Staff account created for ${email} (${role}). Temporary password: ${password}`);
}
