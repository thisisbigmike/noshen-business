// Starts one site's dev server, connected to the database with that site's own login.
// Usage: node scripts/dev.mjs web|admin [extra vite args]   (pnpm dev / pnpm dev:admin)
import { spawn } from "node:child_process";
import { databaseUrl } from "./db-url.mjs";
import { devVars } from "./env.mjs";

const site = process.argv[2];
const login = { web: ["noshen_web", "WEB_DB_PASSWORD"], admin: ["noshen_admin", "ADMIN_DB_PASSWORD"] }[site];
if (!login) {
  console.error("Usage: node scripts/dev.mjs web|admin");
  process.exit(1);
}
const vars = devVars();
let url = databaseUrl();
if (vars[login[1]]) url = Object.assign(new URL(url), { username: login[0], password: vars[login[1]] }).toString();
else console.warn(`${login[1]} isn't set, so the ${site} site connects as the database owner. Run \`pnpm db:roles\` to give it its own login.`);

const child = spawn("pnpm", ["--filter", `@noshen/${site}`, "run", "dev", ...process.argv.slice(3)], {
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: url },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
