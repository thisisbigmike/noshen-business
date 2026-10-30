import readline from "node:readline";
import { CommerceAgent } from "../gemini.js";

export async function runCLI() {
  const agent = new CommerceAgent();
  await agent.initChat();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n=======================================================");
  console.log("   NOSHEN UNIVERSAL AGENTIC COMMERCE BOT (GEMINI)      ");
  console.log("=======================================================");
  console.log("Connected Platforms:");
  console.log("  [1] Shopify (Storefront API & ACP Protocol)");
  console.log("  [2] Stripe Agent Toolkit");
  console.log("  [3] eBay Buy & Order APIs");
  console.log("  [4] AliExpress Wholesale Sourcing");
  console.log("  [5] Coinbase AgentKit (Base / Solana on-chain)");
  console.log("  [6] Skyfire Agentic Payment Network");
  console.log("  [7] NosHen Escrow Protocol (Crypto-to-Fiat P2P Bridge)");
  console.log("  [8] Gemini Multimodal Vision (Waybill Verification)");
  console.log("  [9] Jev AI - TypeSafe AI (System One Fast Fraud & Risk Engine)");
  console.log("=======================================================\n");
  console.log("Type your prompt or question below (or 'exit' to quit):\n");

  const promptUser = () => {
    rl.question("\x1b[36mYou > \x1b[0m", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        promptUser();
        return;
      }
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\nGoodbye!");
        rl.close();
        process.exit(0);
      }

      console.log("\x1b[33m\n[Agent is processing...]\x1b[0m");
      try {
        const reply = await agent.sendMessage(trimmed);
        console.log(`\n\x1b[32mAgent > \x1b[0m${reply}\n`);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
      }

      promptUser();
    });
  };

  promptUser();
}
