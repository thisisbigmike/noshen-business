import { shopifySearchAndBuy } from "./shopify.js";
import { stripeAgentPay } from "./stripe.js";
import { ebayBrowseAndOrder } from "./ebay.js";
import { aliexpressSource } from "./aliexpress.js";
import { coinbaseAgentTransfer } from "./coinbase.js";
import { skyfirePayMerchant } from "./skyfire.js";
import { noshenEscrow } from "./noshen.js";
import { verifyDeliveryProof } from "./vision.js";
import { evaluateRiskWithJev } from "../jev.js";

export const commerceToolDeclarations = [
  {
    name: "jev_risk_evaluator",
    description: "Use Jev AI (TypeSafe AI System One decision model) for sub-second fraud scoring, counterfeit detection, and price anomaly risk evaluation.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: "Item title or deal description" },
        priceUsd: { type: "NUMBER", description: "Quoted price in USD" },
        platform: { type: "STRING", description: "Marketplace or source (e.g. noshen, ebay, jiji, shopify)" },
        sellerDetails: { type: "STRING", description: "Seller reputation or location notes" },
      },
      required: ["title", "priceUsd", "platform"],
    },
  },
  {
    name: "shopify_search_and_buy",
    description: "Search Shopify stores and generate programmatic Agentic Commerce Protocol (ACP) checkout sessions.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search keyword or product name" },
        action: { type: "STRING", enum: ["search", "create_checkout"], description: "Whether to search or create checkout" },
        storeDomain: { type: "STRING", description: "Optional Shopify store domain" },
        variantId: { type: "STRING", description: "Product variant ID if checking out" },
        quantity: { type: "NUMBER", description: "Item quantity" },
      },
      required: ["query", "action"],
    },
  },
  {
    name: "stripe_agent_pay",
    description: "Use Stripe Agent Toolkit to create payment intents, links, or checkout sessions across Stripe-enabled merchants.",
    parameters: {
      type: "OBJECT",
      properties: {
        amount: { type: "NUMBER", description: "Payment amount in main currency units (e.g. 50.00)" },
        currency: { type: "STRING", description: "ISO 3-letter currency code (e.g. USD, EUR, NGN)" },
        description: { type: "STRING", description: "Payment description / item purpose" },
        customerEmail: { type: "STRING", description: "Optional customer email" },
      },
      required: ["amount", "currency", "description"],
    },
  },
  {
    name: "ebay_browse_and_order",
    description: "Search eBay Buy API for verified listings, refurbished items, and initiate orders without CAPTCHAs.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query for eBay" },
        action: { type: "STRING", enum: ["browse", "get_item", "create_order"], description: "Browse or order action" },
        maxPrice: { type: "NUMBER", description: "Maximum price filter in USD" },
        condition: { type: "STRING", enum: ["NEW", "USED", "REFURBISHED"], description: "Item condition filter" },
        itemId: { type: "STRING", description: "eBay item ID if creating an order" },
      },
      required: ["query", "action"],
    },
  },
  {
    name: "aliexpress_source",
    description: "Source products from AliExpress / Alibaba wholesale suppliers with trade assurance protection.",
    parameters: {
      type: "OBJECT",
      properties: {
        keyword: { type: "STRING", description: "Product keyword to source" },
        action: { type: "STRING", enum: ["search_suppliers", "create_sourcing_order"], description: "Search or place order" },
        minQuantity: { type: "NUMBER", description: "Minimum quantity needed" },
        shipToCountry: { type: "STRING", description: "Destination country code (e.g. US, NG, GB)" },
        productId: { type: "STRING", description: "Product ID for order creation" },
      },
      required: ["keyword", "action"],
    },
  },
  {
    name: "coinbase_agent_transfer",
    description: "Execute on-chain crypto payment or transfer using Coinbase AgentKit on Base, Solana, or Ethereum.",
    parameters: {
      type: "OBJECT",
      properties: {
        toAddress: { type: "STRING", description: "Recipient blockchain wallet or contract address" },
        amount: { type: "NUMBER", description: "Amount of crypto to transfer" },
        token: { type: "STRING", enum: ["USDC", "USDT", "ETH"], description: "Token to send (defaults to USDC)" },
        network: { type: "STRING", enum: ["base", "ethereum", "solana"], description: "Target blockchain network" },
        memo: { type: "STRING", description: "Optional transaction memo or order reference" },
      },
      required: ["toAddress", "amount"],
    },
  },
  {
    name: "skyfire_pay_merchant",
    description: "Settle instant payments to web services and merchants using the Skyfire agent payment network.",
    parameters: {
      type: "OBJECT",
      properties: {
        receiverServiceUrl: { type: "STRING", description: "URL or receiver ID of the service/merchant" },
        amount: { type: "NUMBER", description: "Payment amount in USDC" },
        purpose: { type: "STRING", description: "What the payment is for" },
      },
      required: ["receiverServiceUrl", "amount", "purpose"],
    },
  },
  {
    name: "noshen_escrow",
    description: "Manage physical P2P escrow contracts via NosHen. Locks crypto/fiat, bridges to domestic sellers, verifies handover.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: {
          type: "STRING",
          enum: ["search_listings", "create_escrow", "get_deposit_address", "check_status", "release_payout", "dispute"],
          description: "Escrow operation to perform",
        },
        query: { type: "STRING", description: "Listing search query" },
        priceUsdc: { type: "NUMBER", description: "Price in USDC" },
        priceKobo: { type: "NUMBER", description: "Price in Nigerian Kobo (100 kobo = ₦1)" },
        dealId: { type: "STRING", description: "Deal ID for status/release/dispute" },
        releaseCode: { type: "STRING", description: "6-digit release code for handover" },
        deliveryState: { type: "STRING", description: "State or region for delivery" },
        reason: { type: "STRING", description: "Reason if disputing" },
      },
      required: ["action"],
    },
  },
  {
    name: "verify_delivery_proof",
    description: "Use Gemini Multimodal Vision to inspect courier receipts, tracking slips, and packing proof.",
    parameters: {
      type: "OBJECT",
      properties: {
        waybillImageUrl: { type: "STRING", description: "URL or path of courier receipt" },
        packingPhotoUrl: { type: "STRING", description: "URL or path of packed parcel photo" },
        expectedItem: { type: "STRING", description: "Expected product description" },
        expectedRecipient: { type: "STRING", description: "Recipient name or destination" },
      },
    },
  },
];

export async function executeCommerceTool(name: string, args: Record<string, any>) {
  switch (name) {
    case "shopify_search_and_buy":
      return await shopifySearchAndBuy(args as any);
    case "stripe_agent_pay":
      return await stripeAgentPay(args as any);
    case "ebay_browse_and_order":
      return await ebayBrowseAndOrder(args as any);
    case "aliexpress_source":
      return await aliexpressSource(args as any);
    case "coinbase_agent_transfer":
      return await coinbaseAgentTransfer(args as any);
    case "skyfire_pay_merchant":
      return await skyfirePayMerchant(args as any);
    case "noshen_escrow":
      return await noshenEscrow(args as any);
    case "verify_delivery_proof":
      return await verifyDeliveryProof(args as any);
    case "jev_risk_evaluator":
      return await evaluateRiskWithJev(args as any);
    default:
      throw new Error(`Unknown commerce tool: ${name}`);
  }
}
