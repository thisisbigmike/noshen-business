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
  shopify: {
    storefrontToken: process.env.SHOPIFY_STOREFRONT_TOKEN || "",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
  },
  ebay: {
    appId: process.env.EBAY_APP_ID || "",
  },
  aliexpress: {
    appKey: process.env.ALIEXPRESS_APP_KEY || "",
  },
  coinbase: {
    apiKeyName: process.env.COINBASE_API_KEY_NAME || "",
    apiKeySecret: process.env.COINBASE_API_KEY_SECRET || "",
  },
  skyfire: {
    apiKey: process.env.SKYFIRE_API_KEY || "",
  },
};
