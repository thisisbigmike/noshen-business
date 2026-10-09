import { existsSync, readFileSync } from "node:fs";

/** Reads KEY=value lines from .dev.vars (the Worker's local secrets), for the scripts. */
export function devVars() {
  const f = new URL("../.dev.vars", import.meta.url);
  const out = {};
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return { ...out, ...process.env };
}
