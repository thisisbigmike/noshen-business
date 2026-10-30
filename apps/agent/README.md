# NosHen Universal Agentic Commerce Bot

A shopping assistant for NosHen, powered by **Google Gemini** (`gemini-flash-lite-latest` by default; set `GEMINI_MODEL` to change it). It works in the terminal and on Telegram.

---

## What It Can Do

1. **NosHen listings**: live search of the items for sale on NosHen, with each listing's link and the link that starts a protected deal on it.
2. **NosHen help**: answers about the fee, time limits, paying, release codes, disputes and safety, from NosHen's own help pages.
3. **eBay (Browse API)**: live listings with price, delivery cost to Nigeria, condition and seller rating. Buying happens on the listing's own eBay page, because eBay doesn't let outside apps check out for a buyer. Without eBay API keys the agent sends a link to the same search on eBay's website.
4. **Jev AI fraud check**: rates a deal's fraud risk through TypeSafe AI's API. Offered only when `JEV_API_KEY` is set.

The agent only reads. It can't pay, move money, place orders, or start, check or dispute a NosHen deal: it gives people the link to do those themselves.

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

*(Optional: for live eBay listings, add `EBAY_APP_ID` and `EBAY_CERT_ID`, the App ID and Cert ID of a Production keyset from [developer.ebay.com](https://developer.ebay.com/my/keys). eBay switches a Production keyset on only after you set up account-deletion notifications or declare that you're exempt. Without the keys the agent sends a link to the same search on eBay's website.)*

*(Optional: add `JEV_API_KEY`, a TypeSafe AI key, to switch on the Jev AI fraud check.)*

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

### 3. Check It Before People Use It
```bash
pnpm --filter @noshen/agent eval          # every case
pnpm --filter @noshen/agent eval kano     # only cases whose question contains "kano"
```
Asks the agent a fixed set of questions and checks each answer: NosHen's rules, a scam attempt, a request it must refuse, one it must admit it can't answer, and a payment it must say it can't make. Add a case whenever a real person catches the agent out. On Gemini's free tier (about 15 requests a minute) a full run takes a few minutes.

---

## How It Stays Safe And Accurate

- **NosHen's own rules, not guesses.** `search_noshen_help` searches the README's customer sections and the help pages in `apps/web/app/legal/`, with the real fee and time limits filled in from the deal rules. The index is embedded once and cached in `apps/agent/.cache/`; it rebuilds by itself when the pages change.
- **Reads only.** Every tool looks things up; none pays, orders or changes a deal. The approval step (Approve and Cancel buttons on Telegram, yes or no in the terminal, declined after 5 minutes) is ready for the first tool that does.
- **No release codes, no made-up addresses.** The agent can't ask for a release code or produce a deposit address; both live only in the NosHen app.
- **Limits.** At most 5 rounds of tool calls per message, the last 12 messages of history, and messages up to 4,000 characters.
- **Usage.** The terminal shows the time and tokens for every answer; the Telegram bot logs them per chat.
