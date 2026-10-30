import { searchEbay } from "./ebay.js";
import { searchNoshenListings } from "./noshen.js";
import { evaluateRiskWithJev, jevConfigured } from "../jev.js";
import { searchKnowledge } from "../knowledge.js";

const jevDeclaration = {
  name: "jev_risk_evaluator",
  description:
    "Rate a deal's fraud risk with Jev AI: price far below market, counterfeit signs, fake-seller patterns. Use it when a price looks too good to be true " +
    "or before recommending a deal from an unknown seller. Returns a verdict (APPROVE, REVIEW or BLOCK_SCAM), the risk level (low, medium or high) and the reason.",
  parameters: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Item title or deal description" },
      priceUsd: { type: "NUMBER", description: "Quoted price in USD" },
      platform: { type: "STRING", description: "Marketplace or source (e.g. noshen, ebay, jiji)" },
      sellerDetails: { type: "STRING", description: "Seller reputation or location notes" },
    },
    required: ["title", "priceUsd", "platform"],
  },
};

export const commerceToolDeclarations = [
  {
    name: "search_noshen_help",
    description:
      "Search NosHen's own rules and help pages: how a protected deal works, the fee, time limits, paying by bank transfer or USDT/USDC, " +
      "release codes, delivery, reporting a problem and refunds, prohibited items, safety tips, accounts and privacy. " +
      "Use it for every question about how NosHen works or what its rules are, before answering. Returns the matching passages with the page they come from.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "The question in plain English, e.g. 'how long does the seller have to accept a request'" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_noshen_listings",
    description:
      "Search live listings for sale on NosHen, the Nigerian marketplace where the buyer's money is held until they have the item. " +
      "Matches words in listing titles. Returns each listing's price in naira as the site shows it, seller, details, its link, " +
      "and the link that starts a protected deal on it in the NosHen app. Also opens one listing from its link or ID.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Words from the item's title, e.g. 'iphone 13', or a listing's link or ID" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_ebay",
    description:
      "Search live eBay listings (action browse) or look at one listing (action get_item). Returns up to 5 listings with price in US dollars, " +
      "delivery cost, condition, seller rating and the listing's eBay link, plus a link to the same search on eBay's website. " +
      "The agent can't buy on eBay: to buy, the user opens the listing's link and checks out on eBay.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "What to search for, e.g. 'thinkpad t480'" },
        action: { type: "STRING", enum: ["browse", "get_item"], description: "browse searches listings; get_item looks at one listing" },
        maxPrice: { type: "NUMBER", description: "Highest price in US dollars" },
        condition: { type: "STRING", enum: ["NEW", "USED", "REFURBISHED"], description: "Only items in this condition" },
        itemId: { type: "STRING", description: "For get_item: the itemId from a search, or the listing's eBay link or number" },
      },
      required: ["query", "action"],
    },
  },
  // Jev is offered only with its API key: without one there's no real check to run.
  ...(jevConfigured() ? [jevDeclaration] : []),
];

// Actions that change something in the world (moving money, placing an order) run only after the user says yes.
// Each entry returns the action in plain words for the user to approve. No tool does that yet: every tool only reads.
const NEEDS_APPROVAL: Record<string, (args: Record<string, any>) => string | null> = {};

/** The action in plain words for the user to approve, or null when the call is safe to run straight away. */
export function approvalNeeded(name: string, args: Record<string, any>): string | null {
  return NEEDS_APPROVAL[name]?.(args) ?? null;
}

export async function executeCommerceTool(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "search_noshen_help": {
      const hits = await searchKnowledge(String(args.query ?? ""));
      if (hits.length === 0) return { success: false, message: "NosHen's help pages don't cover this." };
      return { success: true, message: hits.map((h) => `[${h.source}]\n${h.text}`).join("\n\n") };
    }
    case "search_noshen_listings":
      return await searchNoshenListings(args);
    case "search_ebay":
      return await searchEbay(args as any);
    case "jev_risk_evaluator":
      if (!jevConfigured()) throw new Error("Jev AI isn't connected (no JEV_API_KEY).");
      return await evaluateRiskWithJev(args as any);
    default:
      throw new Error(`Unknown commerce tool: ${name}`);
  }
}
