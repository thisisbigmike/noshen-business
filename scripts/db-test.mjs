// Runs db/tests.sql (23 checks of the schema's money rules) against the database. It rolls back.
import { readFileSync } from "node:fs";
import pg from "pg";
import { databaseUrl } from "./db-url.mjs";

const db = new pg.Client({ connectionString: databaseUrl() });
await db.connect();
let ok = 0;
db.on("notice", (n) => { if (n.message.startsWith("ok:")) ok++; else console.log(n.message); });
await db.query(readFileSync(new URL("../db/tests.sql", import.meta.url), "utf8"));
await db.end();
console.log(`${ok} schema checks passed`);
