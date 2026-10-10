import { existsSync, readFileSync } from "node:fs";

/** The settings file the scripts read: .dev.vars, or another one named in NOSHEN_VARS (e.g. .prod.vars). */
export const varsFile = () => new URL(`../${process.env.NOSHEN_VARS ?? ".dev.vars"}`, import.meta.url);

// DATABASE_URL from the environment, else from the settings file, else the local default.
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const vars = varsFile();
  if (existsSync(vars)) {
    const line = readFileSync(vars, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    const value = line?.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
    if (value) return value;
    if (process.env.NOSHEN_VARS) throw new Error(`Set DATABASE_URL in ${process.env.NOSHEN_VARS} first.`);
  }
  return "postgres://postgres@127.0.0.1:5432/noshen";
}
