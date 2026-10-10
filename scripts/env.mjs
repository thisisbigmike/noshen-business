import { existsSync, readFileSync } from "node:fs";
import { varsFile } from "./db-url.mjs";

/** Reads KEY=value lines from the settings file (.dev.vars, or NOSHEN_VARS), for the scripts. */
export function devVars() {
  const f = varsFile();
  const out = {};
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return { ...out, ...process.env };
}
