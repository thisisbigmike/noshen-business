import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Local R2 photos and timers live in the repo's .wrangler/state, shared with the staff site in development.
    cloudflare({ viteEnvironment: { name: "ssr" }, persistState: { path: fileURLToPath(new URL("../../.wrangler/state", import.meta.url)) } }),
    reactRouter(),
  ],
});
