import { Bot } from "grammy";
import { config } from "../config.js";
import { CommerceAgent } from "../gemini.js";

export async function startTelegramBot() {
  if (!config.telegramToken || config.telegramToken.startsWith("your_")) {
    console.log("[Telegram]: No valid TELEGRAM_BOT_TOKEN provided. Skipping Telegram listener.");
    console.log("Tip: You can create a free bot token via @BotFather on Telegram and put it in apps/agent/.env");
    return;
  }

  const bot = new Bot(config.telegramToken);
  const agent = new CommerceAgent();
  await agent.initChat();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Hello! I am your NosHen Universal Agentic Commerce Assistant.\n\n" +
      "I help you search, compare, and safely buy goods across:\n" +
      "• NosHen Escrow (P2P Physical Escrow & Naira Payouts)\n" +
      "• Shopify (Agentic Commerce Protocol - ACP)\n" +
      "• Stripe Agent Toolkit\n" +
      "• eBay Buy API\n" +
      "• AliExpress Wholesale\n" +
      "• Coinbase AgentKit & Skyfire\n\n" +
      "Tell me what you're looking for! (e.g. 'Find a clean iPhone 13 in Lagos under $450')"
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    await ctx.replyWithChatAction("typing");

    try {
      const response = await agent.sendMessage(text);
      await ctx.reply(response, { parse_mode: "Markdown" }).catch(async () => {
        // Fallback without markdown if special characters conflict
        await ctx.reply(response);
      });
    } catch (err: any) {
      await ctx.reply(`Sorry, I encountered an error: ${err.message}`);
    }
  });

  console.log("[Telegram]: Bot polling started successfully.");
  bot.start();
}
