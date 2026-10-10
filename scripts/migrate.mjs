// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... pnpm db:migrate
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { databaseUrl } from "./db-url.mjs";

const client = new pg.Client({ connectionString: databaseUrl() });
await client.connect();
await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
const dir = new URL("../db/migrations/", import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  process.stdout.write(`applying ${file} ... `);
  await client.query(readFileSync(new URL(file, dir), "utf8"));
  await client.query("insert into schema_migrations (name) values ($1)", [file]);
  console.log("done");
}
console.log("database is up to date");
// Keep the two sites' database logins in step with any new tables (see db/roles.sql).
const roles = await client.query("select count(*)::int as n from pg_roles where rolname in ('noshen_web', 'noshen_admin')");
if (roles.rows[0].n === 2) {
  await client.query(readFileSync(new URL("../db/roles.sql", import.meta.url), "utf8"));
  console.log("site logins updated (db/roles.sql)");
}
await client.end();
