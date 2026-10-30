import { runCLI } from "./channels/cli.js";
import { startTelegramBot } from "./channels/telegram.js";
import { config } from "./config.js";

async function main() {
  const isTelegramOnly = process.argv.includes("--telegram");

  if (isTelegramOnly) {
    await startTelegramBot();
    return;
  }

  // If a Telegram token is configured, start bot in background alongside CLI
  if (config.telegramToken && !config.telegramToken.startsWith("your_")) {
    startTelegramBot().catch((err) => console.error("[Telegram Error]:", err.message));
  }

  // Launch interactive CLI
  await runCLI();
}

main().catch((err) => {
  console.error("Fatal Agent Error:", err);
  process.exit(1);
});
