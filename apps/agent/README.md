# NosHen Universal Agentic Commerce Bot

An autonomous commerce agent powered by **Google Gemini** (`gemini-2.0-flash`) capable of discovering, negotiating, and safely executing transactions across all major agent-compatible retail networks, wholesale suppliers, on-chain rails, and P2P escrow.

---

## Supported Commerce Platforms & Protocols

1. **Shopify (Storefront API & Agentic Commerce Protocol - ACP)**
   - Programmatic catalog search, variant inspection, and direct ACP cart/checkout URL generation.
2. **Stripe-Powered Marketplaces (Stripe Agent Toolkit)**
   - Autonomous payment intents, customer payment links, and invoice settlement.
3. **eBay (Official Buy & Order APIs)**
   - Browse listings, refurbished hardware verification, and guest order placement without CAPTCHAs.
4. **AliExpress / Alibaba Open Platform**
   - Wholesale supplier lookup, Trade Assurance checks, and direct factory sourcing.
5. **Coinbase AgentKit & Base Ecosystem**
   - On-chain smart wallet integration for autonomous USDC settlement on Base, Solana, and Ethereum.
6. **Skyfire Systems**
   - Agent payment rail for instant micro-settlements and merchant services.
7. **NosHen Escrow Protocol**
   - Physical P2P escrow bridging global crypto stablecoins (Solana/Base USDC) with local domestic fiat (Naira bank transfers), 6-digit release code validation, and dispute mediation.
8. **Gemini Multimodal Vision Inspection**
   - Automated visual parsing of courier waybills, tracking slips, and parcel packing photos before escrow advancement.

---

## Quickstart

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp apps/agent/.env.example apps/agent/.env
```
Add your free **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/):
```env
GEMINI_API_KEY=AIzaSy...
```
*(Optional: Add `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) to connect your Telegram bot).*

### 2. Run the Agent

**Interactive Terminal CLI:**
```bash
pnpm agent
```
or with auto-reload:
```bash
pnpm agent:dev
```

**Run Telegram Bot Listener:**
```bash
pnpm --filter @noshen/agent run telegram
```
