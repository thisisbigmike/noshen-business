<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/noshen-logo-white.png">
  <img src="brand/noshen-logo.png" width="420" alt="NosHen">
</picture></p>

<p align="center"><strong>Buy and sell anything in Nigeria. Your money is held until you have the item.</strong><br>
<em>If you don't trust the person you're dealing with, use NosHen.</em></p>

<p align="center"><a href="https://noshen-web.usenoshen.workers.dev">Live demo</a> · <a href="#try-the-demo">Try it</a> · <a href="#how-its-built">How it's built</a> · <a href="#run-it-locally">Run it locally</a></p>

> **The demo runs in test mode.** No real money moves: the bank, the crypto partner and the ID checks are stand-ins, and every screen where you'd type a payment, NIN, BVN or account number says so.

## The problem

Online deals between strangers in Nigeria fall apart at the payment, because someone has to go first:

- **Pay first:** the seller disappears, or sends something fake.
- **Hand over first:** the "payment" turns out to be a fake transfer alert.
- **Meet with cash:** you carry the full price across town to meet a stranger.

NosHen takes the risk out of the first step. The buyer pays NosHen, the money is held, and the seller is paid only once the buyer has checked the item.

## How a deal works

1. **Request.** The buyer finds a listing and sends a request. The seller accepts.
2. **Pay.** The buyer pays into that deal's own account, by naira bank transfer or with a dollar stablecoin. The money is **held**: the seller can see it, but can't touch it.
3. **Check the item.** They meet in a public place, or the seller delivers it. Before handing over anything, the app takes the buyer through checks for that kind of item (a phone's IMEI and account lock, a car's papers, and so on).
4. **Release.** The buyer gives the seller a 6-digit **release code**, which exists only in the buyer's app. The seller types it in, and the payout starts. For a delivery, the buyer confirms instead; if they do nothing, the money is released 24 hours after delivery.

If something is wrong, the buyer **reports a problem** before release. The money freezes, both sides add photos and notes for 24 hours, and a NosHen reviewer decides within 72 hours: refund the buyer or release to the seller, with the reason sent to both.

**Fee:** 1.5% of the price, at least ₦500 and at most ₦7,500. The buyer or the seller can pay it.

## Paying with stablecoins

Buyers outside Nigeria, including Nigerians abroad, can pay in **USDT or USDC on Solana, BNB Smart Chain, Base or Ethereum**:

- Each deal gets its own deposit address, so NosHen always knows exactly who paid for what. No memo or reference is needed.
- The exact coin amount is fixed for 30 minutes.
- A refund goes back in the same coin to the buyer's own address. They can add it while paying, or later; a refund waits until they do.
- The pay sheet is ordered by where the buyer's device is (from Cloudflare): bank transfer first in Nigeria, stablecoins first elsewhere.
- A second payment for a deal that's already paid is sent back on its own.

In the demo, the crypto partner is pretend. Its addresses are deliberately invalid (`0xTEST…`, `TEST0…`) so no wallet can send real coins to it.

## Try the demo

The live demo is at **https://noshen-web.usenoshen.workers.dev**. Sign in there with Google.

1. **Sell something.** Tap Sell, pick a category, add photos and details, then review and publish. The ID and bank checks are pretend: type any 11 digits for the NIN or BVN, and a made-up 10-digit account number.
2. **Buy it from a second account.** In another browser (or a private window), sign in with a different Google account, find the listing in Browse and send a request. Accept it as the seller.
3. **Pay.** Tap Pay as the buyer:
   - For a bank transfer: under "Pretend to be your bank", press **Send ₦… from my account**.
   - For crypto: pick a coin and network (e.g. USDC on Solana), then under "Pretend to be your wallet", press **Send …**.

   Both sides now see the money as held. The other test buttons (paying from someone else's account, or sending too little) show the review holds.
4. **Chat** on the deal page. Messages, "typing…" and who's online update live, and phones get a notification if you turn notifications on.
5. **Release.** The buyer opens the release code and the seller types it in. The deal closes and the payout is confirmed. To see the other path, report a problem instead.

## What's built

**Customer site**
- Listings in 13 categories across all 36 states and the FCT, with sizes for clothes and shoes, and more than one unit per listing.
- Search and filters, a share link for every listing (with a WhatsApp preview), and photos.
- Deals for meet-ups and deliveries, release codes, disputes with evidence, and ratings.
- Real-time chat, and notifications on the phone or computer (Web Push, with no third-party push service).
- Naira and stablecoin payments.
- Light and dark themes, and a layout that works from small phones to wide screens.

**Safety rules in the engine**
- **Payments from someone else's account** (a different name) are held for review. The buyer is asked who paid and can cancel to get the money back.
- **Wrong amounts** are held too.
- **Unverified sellers** are capped at ₦300,000 per deal. Verified sellers (ID plus a bank account in the same name) have no cap.
- **Release codes** lock after 5 wrong tries.
- **Refunds** always go back to where the money came from.

**Staff site**
- It sits behind Cloudflare Access, plus a password and an authenticator code.
- A dashboard, plus queues for disputes and payments held for review.
- Every deal in full, with staff actions: refund the buyer, release to the seller (admins only), give more time, open a dispute for the buyer, unlock a release code, and send a failed payout again.
- Listing moderation, freezing and banning accounts, and deal limits.
- A money check, and alerts on staff devices.
- Every action needs a reason and is kept in an append-only audit log.

## How it's built

**Stack:**
- **Hosting:** Cloudflare Workers. React Router 8 renders the pages and Hono serves the API.
- **Deadlines:** Cloudflare Workflows, one per deal deadline, plus a 15-minute sweep that catches any that didn't fire.
- **Live updates:** Durable Objects, one live room per deal, using WebSocket hibernation.
- **Photos:** R2.
- **Database:** PostgreSQL on Neon, reached through Hyperdrive with query caching off.
- **Sign-in:** Better Auth.

```
apps/web         the customer site: browse, sell, buy, deals, chat          → Worker "noshen-web"
apps/admin       the staff site: disputes, holds, deals, listings, people,  → Worker "noshen-admin"
                 money, audit log
packages/engine  the engine both sites share: the deal state machine, ledger, payments and refunds,
                 stablecoins, disputes, deadlines, notifications (Web Push), staff actions
packages/shared  rules used in the browser and on the server: money, fees, categories, sizes, places, payments
packages/ui      components, icons and styles
db/              migrations, schema checks (tests.sql), and roles.sql (what each site's database login may do)
scripts/         migrate, roles, seed, staff accounts, dev launcher
tests/           engine, Web Push and Cloudflare Access tests
brand/           the logo
```

**How the money is kept right**

- **Ledger.** Every naira and coin amount is recorded in kobo in a double-entry ledger. It's append-only, and the database refuses an unbalanced entry.
- **Deal states.** A deal moves between states (requested → accepted → held → released → paid out, or refunded, declined, disputed) only along allowed paths, which the database also enforces.
- **Locking.** Each action locks its deal row, so two actions on one deal can never interleave. Deadlines re-check under that lock, so a late or repeated timer does nothing.
- **Partner webhooks** are idempotent: the same event twice is processed once.

**Two sites, kept apart.** They share the engine and the database, but are deployed and secured separately.

| | Customer site | Staff site |
|---|---|---|
| Who can reach it | Anyone | Only staff emails allowed by Cloudflare Access |
| Sign-in | Google, or an emailed 6-digit code (no passwords). Staff accounts are refused. | Email, password and an authenticator code. No sign-up. |
| Sessions | 30 days, its own secret and cookies | 12 hours, a different secret and cookies |
| Database login | `noshen_web`: can't read staff accounts, staff sessions, two-factor keys or the audit log; can only add staff alerts | `noshen_admin` |

## Run it locally

You need Node 24, pnpm and PostgreSQL.

```bash
pnpm install
cp .dev.vars.example .dev.vars                       # scripts: database owner, the two site logins' passwords
cp apps/web/.dev.vars.example apps/web/.dev.vars     # customer site secrets (openssl rand -base64 32)
cp apps/admin/.dev.vars.example apps/admin/.dev.vars # staff site secrets
pnpm db:migrate && pnpm db:roles && pnpm db:seed     # set DATABASE_URL in .dev.vars first
pnpm dev                                             # customer site: http://localhost:5173
pnpm dev:admin                                       # staff site:    http://localhost:5174
```

- `FIELD_KEY` and `RELEASE_CODE_SECRET` must be the same in all three `.dev.vars` files.
- Locally, no email is sent: sign-in codes appear on screen, and the pay screens can pretend to be the bank or the wallet.
- `pnpm db:seed` adds sample listings and two sample sellers. On a local database it also creates a staff admin and prints its sign-in details in the terminal.
- Google sign-in is optional. Create an OAuth client (Web application) with the redirect URI `http://localhost:5173/api/auth/callback/google`, and put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `apps/web/.dev.vars`.

## Tests

```bash
pnpm test        # engine, Web Push and Cloudflare Access tests (uses a separate noshen_test database)
pnpm db:test     # schema checks: the ledger, deal states and money rules enforced by the database
pnpm db:roles    # creates the two site logins and checks what each can and can't do
pnpm typecheck
```

The engine tests cover:
- Deals, fees, disputes, deadlines and refunds.
- Bank and stablecoin payments, including second and wrong-name payments.
- Units and sizes.
- Staff actions and staff alerts.

The Web Push encryption is checked against the worked example in RFC 8291.

## Deploying

The demo is deployed like this:

1. **Database.** Create a Neon database. As its owner, run `pnpm db:migrate`, then `pnpm db:roles` with `WEB_DB_PASSWORD` and `ADMIN_DB_PASSWORD` set to two long random passwords.
   - The scripts read `.dev.vars`, or another file named in `NOSHEN_VARS` (e.g. `NOSHEN_VARS=.prod.vars`).
2. **Hyperdrive.** Create one Hyperdrive config per site, with caching off, each connecting with its own login. Put their ids in each `wrangler.jsonc`.
3. **Photos.** Create the R2 bucket `noshen-photos`.
4. **Secrets.**
   - **Customer site:** `BETTER_AUTH_SECRET`, `RELEASE_CODE_SECRET`, `FIELD_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `VAPID_PRIVATE_JWK`.
   - **Staff site:** a different `BETTER_AUTH_SECRET`, the same `RELEASE_CODE_SECRET` and `FIELD_KEY`, and `VAPID_PRIVATE_JWK`.
5. **Cloudflare Access for the staff site.** Add a self-hosted Access application allowing only staff emails. Put its AUD tag and team domain in `apps/admin/wrangler.jsonc` (`ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`). Until both are set, the staff site refuses every request on https.
6. **Staff accounts.** Create one with `pnpm staff:create "Name" email admin` (or `reviewer`). The person sets up two-factor at their first sign-in.
7. **Deploy:** `pnpm deploy:web` and `pnpm deploy:admin`.

## Not built yet

- **Real providers.** The payment partner (a licensed bank to hold naira), the stablecoin custody and conversion partner, NIN/BVN checks and email sending are all stand-ins. They plug in behind the interfaces in `packages/engine/src/partner/`, `idcheck.ts` and `email.ts`.
- **Phone sign-in and SMS updates.**
- **Smaller pieces:**
  - Cloudflare Queues for webhook retries.
  - Analytics.
  - Image resizing.
  - A blocklist for phones, bank accounts and devices.
  - Editing a live listing.
- **Other countries.** Ghana, Kenya and South Africa show as coming soon.
- **Legal pages.** The pages at `/terms`, `/privacy` and the others are drafts waiting for review by a Nigerian lawyer.

## Team

Built by **Big Mike** and **Nonso**.
