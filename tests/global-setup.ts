// Creates a fresh test database from the migrations before the tests run.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import pg from "pg";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const vars = new URL("../.dev.vars", import.meta.url);
  if (existsSync(vars)) {
    const line = readFileSync(vars, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  }
  return "postgres://postgres:postgres@127.0.0.1:5432/noshen";
}

export function testDatabaseUrl() {
  const u = new URL(process.env.TEST_DATABASE_URL ?? databaseUrl());
  if (!process.env.TEST_DATABASE_URL) u.pathname = "/noshen_test";
  return u.toString();
}

export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.query(readFileSync(new URL(f, dir), "utf8"));
  await db.end();
  process.env.NOSHEN_TEST_DB = url.toString();
}
