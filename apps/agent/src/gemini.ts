import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";
import { commerceToolDeclarations, executeCommerceTool } from "./tools/index.js";

const SYSTEM_INSTRUCTION = `
You are the NosHen Universal Agentic Commerce Assistant.
Your job is to help users find, negotiate, compare, and safely buy physical items, wholesale supplies, and services across major commerce platforms:
1. Shopify (Storefront API & Agentic Commerce Protocol - ACP)
2. Stripe-Powered Marketplaces (Stripe Agent Toolkit)
3. eBay (Official Buy & Order APIs)
4. AliExpress / Alibaba (Wholesale Sourcing)
5. Coinbase AgentKit (On-chain crypto settlement on Base, Solana, Ethereum)
6. Skyfire Systems (Agent payment network)
7. NosHen Escrow Protocol (The global P2P escrow engine for physical delivery, locking crypto stablecoins and paying out domestic fiat safely upon verified inspection)
8. Multimodal Vision Inspection (Verifying waybill tracking numbers and parcel packing photos)
9. Jev AI - TypeSafe AI (System One fast decision model for sub-second fraud scoring, fake deal detection, and price anomaly evaluation)

Guidelines:
- When evaluating deals, if a price looks too good to be true or if a transaction needs risk scoring, invoke the jev_risk_evaluator tool to run a sub-second fraud score.
- When a user asks to buy or find an item:
  - If they mention local Nigerian or peer-to-peer commerce (or buying safely without being scammed), prioritize NosHen Escrow.
  - If they want brand new items from official online stores, query Shopify ACP or eBay.
  - If they need bulk factory sourcing, use AliExpress.
  - If they want to pay on-chain with crypto, use Coinbase AgentKit or NosHen.
- You have tools to search, generate checkouts, create escrows, transfer crypto, and inspect waybill photos.
- Always be helpful, concise, and provide the user with clear next steps or payment/escrow links.
- If the user writes in Nigerian Pidgin English (e.g. "abeg help me find..."), feel free to reply in natural Pidgin English or English with warm, helpful tone.
`;

export class CommerceAgent {
  private ai: GoogleGenAI;
  private chat: any = null;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: config.geminiApiKey || "demo_key",
    });
  }

  async initChat() {
    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    this.chat = this.ai.chats.create({
      model,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: commerceToolDeclarations as any }],
      },
    });
  }

  async sendMessage(userMessage: string, onChunk?: (chunk: string) => void): Promise<string> {
    if (!this.chat) {
      await this.initChat();
    }

    // Fallback if no valid Gemini API key is provided yet
    if (!config.geminiApiKey || config.geminiApiKey.startsWith("your_")) {
      return this.handleLocalSimulation(userMessage);
    }

    try {
      let response = await this.chat.sendMessage({ message: userMessage });

      // Handle tool calling loop
      let functionCalls = response.functionCalls;
      let iterations = 0;

      while (functionCalls && functionCalls.length > 0 && iterations < 5) {
        iterations++;
        const toolResponses = [];

        for (const call of functionCalls) {
          const toolName = call.name;
          const toolArgs = call.args || {};
          if (onChunk) onChunk(`\x1b[33m⚡ Calling tool: ${toolName}...\x1b[0m\n`);
          else console.log(`[Agent Tool Call] -> ${toolName}(${JSON.stringify(toolArgs)})`);

          let result: any;
          try {
            result = await executeCommerceTool(toolName, toolArgs);
          } catch (err: any) {
            result = { success: false, error: err.message };
          }

          toolResponses.push({
            functionResponse: {
              name: toolName,
              response: { output: result },
            },
          });
        }

        // Send tool results back to Gemini
        response = await this.chat.sendMessage({ message: toolResponses as any });
        functionCalls = response.functionCalls;
      }

      const text = response.text || "I have processed your request.";
      if (onChunk) onChunk(text);
      return text;
    } catch (error: any) {
      console.error("[Gemini Error]:", error?.message || error);
      return this.handleLocalSimulation(userMessage);
    }
  }

  /**
   * High-fidelity local simulation mode when testing before a Gemini key is entered
   */
  private async handleLocalSimulation(msg: string): Promise<string> {
    const lower = msg.toLowerCase();

    if (lower.includes("iphone") || lower.includes("phone") || lower.includes("laptop") || lower.includes("lagos") || lower.includes("escrow") || lower.includes("noshen")) {
      const res: any = await executeCommerceTool("noshen_escrow", {
        action: "create_escrow",
        query: msg,
        priceUsdc: 450,
        priceKobo: 72000000,
        deliveryState: "LA",
      });
      const data = (res.data || {}) as Record<string, any>;
      return `[NosHen Agent Simulation Mode]\n\nI initiated a NosHen Escrow Deal for you:\n\n` +
        `• Deal ID: ${data.dealId}\n` +
        `• Price: $${data.priceUsdc} USDC (Seller receives: ${data.sellerReceives})\n` +
        `• Dedicated Deposit Address: ${data.depositAddress}\n` +
        `• Escrow Protection: Funds stay locked in NosHen until you verify the item with the 6-digit release code.\n\n` +
        `Payment Link: ${res.checkoutUrl}\n\n` +
        `Tip: Add your free GEMINI_API_KEY to apps/agent/.env to enable live natural language reasoning!`;
    }

    if (lower.includes("shopify")) {
      const res: any = await executeCommerceTool("shopify_search_and_buy", {
        query: msg,
        action: "create_checkout",
      });
      return `[Shopify ACP Protocol]: Generated programmatic cart & checkout link:\n${res.checkoutUrl}`;
    }

    if (lower.includes("ebay")) {
      const res: any = await executeCommerceTool("ebay_browse_and_order", {
        query: msg,
        action: "browse",
      });
      return `[eBay Buy API]: Found verified items:\n${JSON.stringify(res.data, null, 2)}`;
    }

    return `Hello! I am your NosHen Universal Agentic Commerce Assistant.\n\n` +
      `I can search, negotiate, and execute purchases across:\n` +
      `1. NosHen Escrow (P2P Physical & Crypto-to-Fiat Escrow)\n` +
      `2. Shopify (Agentic Commerce Protocol - ACP)\n` +
      `3. Stripe Agent Toolkit\n` +
      `4. eBay Buy API\n` +
      `5. AliExpress Wholesale Sourcing\n` +
      `6. Coinbase AgentKit (Base / Solana on-chain transfers)\n` +
      `7. Skyfire Systems Agent Payments\n\n` +
      `Try asking: "Find a clean iPhone 13 in Lagos under $450 with escrow" or "Search Shopify for wireless headphones".`;
  }
}
