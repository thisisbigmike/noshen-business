import { existsSync, readFileSync } from "node:fs";

// DATABASE_URL from the environment, else from .dev.vars, else the local default.
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const vars = new URL("../.dev.vars", import.meta.url);
  if (existsSync(vars)) {
    const line = readFileSync(vars, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
  }
  return "postgres://postgres@127.0.0.1:5432/noshen";
}
