import readline from "node:readline";
import { CommerceAgent, readApprovalReply, type ApprovalDecision } from "../gemini.js";
import { jevConfigured } from "../jev.js";
import { ebayConfigured } from "../tools/ebay.js";

export async function runCLI() {
  const agent = new CommerceAgent();
  await agent.initChat();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mYou > \x1b[0m",
  });

  console.log("\n=======================================================");
  console.log("   NOSHEN UNIVERSAL AGENTIC COMMERCE BOT (GEMINI)      ");
  console.log("=======================================================");
  console.log("Connected:");
  console.log("  • NosHen listings and help pages (live)");
  console.log(`  • eBay: ${ebayConfigured() ? "live listings" : "search links only (add EBAY_APP_ID and EBAY_CERT_ID for live listings)"}`);
  console.log(`  • Jev AI fraud check: ${jevConfigured() ? "on" : "off (add JEV_API_KEY)"}`);
  console.log("=======================================================\n");
  console.log("Type your prompt or question below ('/reset' to start over, 'exit' to quit):\n");

  const quit = () => {
    console.log("\nGoodbye!");
    process.exit(0);
  };
  rl.on("SIGINT", quit);

  // Input can end while a reply is still streaming (Ctrl+D, piped input); the prompt is then skipped.
  let inputClosed = false;
  const prompt = () => {
    if (!inputClosed) rl.prompt();
  };

  // While the agent waits for a yes or no, the next line typed is the answer, not a new message.
  let answerApproval: ((line: string) => void) | null = null;
  const askApproval = (action: string) =>
    new Promise<ApprovalDecision>((resolve) => {
      if (inputClosed) return resolve({ approved: false });
      process.stdout.write(`\n\x1b[35m🔐 Approve this? ${action}\x1b[0m\n\x1b[36mYes/No > \x1b[0m`);
      answerApproval = (line) => resolve(readApprovalReply(line));
    });

  // Lines typed while the agent is answering wait their turn.
  let busy = Promise.resolve();
  rl.on("line", (input) => {
    if (answerApproval) {
      const answer = answerApproval;
      answerApproval = null;
      answer(input);
      return;
    }
    busy = busy.then(() => handleLine(input.trim()));
  });
  rl.on("close", () => {
    inputClosed = true;
    // A pending approval can never be answered now.
    answerApproval?.("no");
    void busy.then(quit);
  });

  async function handleLine(trimmed: string) {
    if (!trimmed) return prompt();
    if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
      rl.close();
      return;
    }
    if (trimmed === "/reset") {
      await agent.reset();
      console.log("\x1b[2mConversation cleared.\x1b[0m\n");
      return prompt();
    }
    await answer(agent, trimmed, askApproval);
    prompt();
  }

  prompt();
}

/** Streams the agent's reply to the terminal as it arrives. */
async function answer(agent: CommerceAgent, message: string, askApproval: (action: string) => Promise<ApprovalDecision>) {
  const startedAt = Date.now();
  let status = "thinking…";
  let writingText = false;

  const clearStatus = () => process.stdout.write("\r\x1b[2K");
  const showStatus = () => process.stdout.write(`\r\x1b[2K\x1b[2m${status}\x1b[0m`);
  showStatus();

  try {
    await agent.sendMessage(message, {
      onEvent: (event) => {
        if (event.type === "usage") {
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
          process.stdout.write(`\n\x1b[2m(${seconds}s · ${event.inputTokens} tokens in, ${event.outputTokens} out)\x1b[0m`);
          return;
        }
        if (event.type === "tool") {
          if (writingText) process.stdout.write("\n");
          writingText = false;
          clearStatus();
          console.log(`\x1b[33m⚡ Calling tool: ${event.name}...\x1b[0m`);
          status = "working…";
          showStatus();
          return;
        }
        if (!writingText) {
          clearStatus();
          process.stdout.write("\x1b[32mAgent > \x1b[0m");
          writingText = true;
        }
        process.stdout.write(event.text);
      },
      onApproval: async (action) => {
        if (writingText) process.stdout.write("\n");
        writingText = false;
        clearStatus();
        const decision = await askApproval(action);
        console.log(decision.approved ? "\x1b[32m✔ Approved\x1b[0m" : "\x1b[31m✘ Not approved\x1b[0m");
        showStatus();
        return decision;
      },
    });
    if (!writingText) clearStatus();
    process.stdout.write("\n\n");
  } catch (err: any) {
    clearStatus();
    console.error(`\x1b[31mError: ${err.message}\x1b[0m\n`);
  }
}
