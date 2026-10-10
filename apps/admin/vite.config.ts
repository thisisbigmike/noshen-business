import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Shares the repo's local .wrangler/state with the customer site, so staff see the same local photos.
    cloudflare({ viteEnvironment: { name: "ssr" }, persistState: { path: fileURLToPath(new URL("../../.wrangler/state", import.meta.url)) } }),
    reactRouter(),
  ],
});
