// Sets a staff member's password. You type it in the terminal (shown as dots), so it never appears on screen,
// in a chat, or in any file. It also signs that account out everywhere and records the change in the audit log.
// Usage: pnpm staff:password email@noshen.ng                          (local database)
//        NOSHEN_VARS=.prod.vars pnpm staff:password email@noshen.ng   (the live database)
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { databaseUrl } from "./db-url.mjs";

const MIN = 12;

/** Reads a line without showing it: dots in a terminal, plain lines when piped (for scripts and tests). */
function hidden(prompt) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let buf = "";
      const onData = (d) => {
        buf += d;
        const i = buf.indexOf("\n");
        if (i < 0) return;
        stdin.off("data", onData);
        stdin.pause();
        stdin.unshift(Buffer.from(buf.slice(i + 1)));
        resolve(buf.slice(0, i).replace(/\r$/, ""));
      };
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.resume();
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let s = "";
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (c === "\u0003") { process.stdout.write("\nCancelled.\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") {
          if (s.length) { s = s.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        if (c >= " ") { s += c; process.stdout.write("•"); }
      }
    };
    stdin.on("data", onData);
  });
}

function problem(password, email) {
  if (password.length < MIN) return `Use at least ${MIN} characters. You typed ${password.length}.`;
  if (password.length > 128) return "Use 128 characters or fewer.";
  if (password.trim() !== password) return "Don't start or end it with a space.";
  if (password.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Don't include your email name in it.";
  return null;
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: pnpm staff:password email@noshen.ng");
  process.exit(1);
}

const db = new pg.Client({ connectionString: databaseUrl() });
await db.connect();
const who = (await db.query(
  `select u.id as auth_id, s.id as staff_id, s.name from "user" u join staff s on s.auth_user_id = u.id
   join account a on a."userId" = u.id and a."providerId" = 'credential' where lower(u.email) = $1`, [email])).rows[0];
if (!who) {
  console.error(`No staff account with a password for ${email}.`);
  await db.end();
  process.exit(1);
}

let password;
for (;;) {
  password = await hidden(`New password for ${who.name} (at least ${MIN} characters): `);
  const p = problem(password, email);
  if (p) { console.log(p); if (!process.stdin.isTTY) process.exit(1); continue; }
  const again = await hidden("Type it again: ");
  if (again === password) break;
  console.log("Those don't match. Let's try again.");
  if (!process.stdin.isTTY) process.exit(1);
}

await db.query("begin");
try {
  await db.query(`update account set password = $2, "updatedAt" = now() where "userId" = $1 and "providerId" = 'credential'`, [who.auth_id, await hashPassword(password)]);
  const ended = await db.query(`delete from "session" where "userId" = $1`, [who.auth_id]);
  await db.query(
    "insert into staff_actions (staff_id, action, target_type, target_id, reason) values ($1, 'set_password', 'staff', $1, $2)",
    [who.staff_id, "Password changed from the command line (pnpm staff:password)"]);
  await db.query("commit");
  console.log(`Password changed for ${email}. ${ended.rowCount ? `Signed out of ${ended.rowCount} session(s); s` : "S"}ign in again with the new password.`);
} catch (e) {
  await db.query("rollback");
  throw e;
} finally {
  await db.end();
}
