// Creates the two sites' database logins and sets what each may do (db/roles.sql), then checks it.
// Usage: pnpm db:roles   (as the database owner: DATABASE_URL; passwords: WEB_DB_PASSWORD, ADMIN_DB_PASSWORD)
// Production (Neon): run once against the production database with strong passwords, then create each
// site's Hyperdrive config with its own login. See README, "Two sites, two database logins".
import { readFileSync } from "node:fs";
import pg from "pg";
import { databaseUrl } from "./db-url.mjs";
import { devVars } from "./env.mjs";

const vars = devVars();
const owner = new pg.Client({ connectionString: databaseUrl() });
await owner.connect();

const logins = { noshen_web: vars.WEB_DB_PASSWORD, noshen_admin: vars.ADMIN_DB_PASSWORD };
for (const [role, password] of Object.entries(logins)) {
  if (!password || password === "change-me") {
    console.error(`Set ${role === "noshen_web" ? "WEB_DB_PASSWORD" : "ADMIN_DB_PASSWORD"} (in .dev.vars or the environment) first.`);
    process.exit(1);
  }
  const exists = (await owner.query("select 1 from pg_roles where rolname = $1", [role])).rowCount;
  const pw = owner.escapeLiteral(password);
  await owner.query(exists ? `alter role ${role} with login password ${pw}` : `create role ${role} with login nosuperuser nocreatedb nocreaterole noinherit password ${pw}`);
  const db = (await owner.query("select current_database() as d")).rows[0].d;
  await owner.query(`grant connect on database ${owner.escapeIdentifier(db)} to ${role}`);
  console.log(`${exists ? "updated" : "created"} login ${role}`);
}
await owner.query(readFileSync(new URL("../db/roles.sql", import.meta.url), "utf8"));
console.log("applied db/roles.sql");

// Prove it: each login can do its job and nothing it shouldn't.
const urlFor = (role) => Object.assign(new URL(databaseUrl()), { username: role, password: logins[role] }).toString();
async function check(role, cases) {
  const c = new pg.Client({ connectionString: urlFor(role) });
  await c.connect();
  let ok = 0;
  for (const [label, sql, expect] of cases) {
    let got;
    try { const r = await c.query(sql); got = expect === "denied" ? "allowed" : expect(r.rows[0]) ? "ok" : `unexpected ${JSON.stringify(r.rows[0])}`; }
    catch (e) { got = expect === "denied" && /permission denied/.test(e.message) ? "ok" : e.message; }
    if (got === "ok") ok++; else { console.error(`  ✗ ${role}: ${label}: ${got}`); process.exitCode = 1; }
  }
  await c.end();
  console.log(`${role}: ${ok}/${cases.length} checks passed`);
}
const any = () => true;
await check("noshen_web", [
  ["reads listings", "select count(*) from listings", any],
  ["can't read the staff audit log", "select * from staff_actions limit 1", "denied"],
  ["can't write the staff audit log", "insert into staff_actions (staff_id, action, target_type, target_id, reason) values (gen_random_uuid(), 'x', 'x', gen_random_uuid(), 'xxxxx')", "denied"],
  ["can't read staff names or roles", "select name, role from staff limit 1", "denied"],
  ["can't read two-factor keys", 'select * from "twoFactor" limit 1', "denied"],
  ["can't change settings", "update settings set key = key where false", "denied"],
  ["sees no staff password logins", `select count(*)::int as n from account where "providerId" = 'credential'`, (r) => r.n === 0],
  ["sees no staff sessions", `select count(*)::int as n from "session" s join staff st on st.auth_user_id = s."userId"`, (r) => r.n === 0],
]);
await check("noshen_admin", [
  ["reads the audit log", "select count(*) from staff_actions", any],
  ["reads staff", "select count(*) from staff", any],
  ["reads listings", "select count(*) from listings", any],
]);
await owner.end();
