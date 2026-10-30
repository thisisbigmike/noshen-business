import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.dev.vars") });

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  noshenApiUrl: process.env.NOSHEN_API_URL || "https://noshen-web.usenoshen.workers.dev",
  /** The key the NosHen site gives this assistant for its /api/agent (AGENT_API_KEY there). Without it, no account lookups. */
  noshenAgentKey: process.env.NOSHEN_AGENT_KEY || "",
  ebay: {
    appId: process.env.EBAY_APP_ID || "",
    certId: process.env.EBAY_CERT_ID || "",
  },
};
