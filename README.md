# NosHen app (first working version, in progress)

Buy and sell safely in Nigeria: the buyer's money is held by a licensed partner until they have the item.
Built from the Claude Design screens and the docs in the `noshen` repo (PRD, TRD, app flow, backend schema).

**Stack:** React Router 8 + Hono on Cloudflare Workers, Workflows for deal timers, R2 for photos,
PostgreSQL (Neon in production, via Hyperdrive with query caching off), Better Auth (customers: email code or Google; staff: email, password and two-factor).

## One repo, two sites

```
apps/web         the customer site (noshen.com): browse, buy, sell, deals        → Worker "noshen-web"
apps/admin       the staff site (admin.noshen.com): disputes, holds, listings,    → Worker "noshen-admin"
                 people, money, audit log
packages/engine  the money engine both sites share: deals, ledger, disputes, sellers, staff actions, database
packages/shared  rules and words used in the browser and on the server: money, categories, deal states, field checks
packages/ui      components, icons, theme switch and styles
db/              migrations, schema checks, and roles.sql (what each site's database login may do)
scripts/         migrate, roles, seed, create staff, dev launcher
tests/           engine tests and the staff site's Cloudflare Access check
```

Both sites use the same engine and database, so a change to the money rules reaches both at once. They are
deployed and secured separately:

| | Customer site (`apps/web`) | Staff site (`apps/admin`) |
|---|---|---|
| Address | `noshen.com` | `admin.noshen.com`, behind Cloudflare Access |
| Sign-in | Email code or Google. Staff accounts are refused. | Email, password and authenticator code. Staff only; no sign-up. |
| Sign-in secret and cookies | Its own `BETTER_AUTH_SECRET`; `better-auth.*` cookies, 30-day sessions | A different `BETTER_AUTH_SECRET`; `noshen-staff.*` cookies, 12-hour sessions |
| Database login | `noshen_web`: no access to staff accounts, staff passwords, staff sessions, two-factor keys or the audit log; settings read-only | `noshen_admin` |
| Photos | Served to anyone with the link | Staff only, never cached by shared caches |
| Other | Partner webhooks, 15-minute deadline sweep | Refuses to be framed by other sites, never indexed; locked on https until Access is set up |

## Status

**Works, and tested end to end in the browser** (phone and desktop sizes):

- Landing page at `/` (what NosHen is, how it works, fees, questions), with the marketplace at `/browse`.
- Sign-in: **email code or Google only**. Type an email and get a 6-digit code (no password), or continue with Google.
- Updates go by **email and in the app**. Phone numbers and SMS come later.
- Buyer: browse → listing → sign in → buy request → pay into the deal account → money held → release-code checklist → code.
- Two ways to pay: naira by bank transfer, or a dollar stablecoin (USDT or USDC) on Solana, BNB Smart Chain, Base or Ethereum, shown with their real logos (`apps/web/app/assets/logos`, see its NOTICE). "Pay" opens a sheet with both, ordered by the country the buyer's device is in (from Cloudflare): bank transfer first in Nigeria, stablecoins first elsewhere, with local methods for Ghana, Kenya and South Africa shown as coming soon. The sheet quotes the deal in the chosen coin. Picking a network shows the deal's address straight away, with an exact amount fixed for 30 minutes; the buyer's own address is only needed for a refund (they can add it while paying, and a refund waits on the deal page until they do); the crypto partner turns it into naira for the deal, and refunds go back in the same coin. A second payment for a deal already paid is sent back on its own.
- Seller: accept → see what's held for them → enter the code (wrong codes count down and lock after 5) → released → payout confirmed by the partner.
- Delivery deals: mark delivered → buyer confirms, or the money releases 24 hours later.
- Problems: report with photos → money frozen → evidence → a staff reviewer decides → refund or release, with the reason sent to both.
- Selling: photos (stored in R2) → details → the ID and bank checks if not done yet → live listing → share screen with a WhatsApp preview.
- Staff site: dashboard (money held, sales, fees, 14-day chart; every tile opens its queue), disputes and review holds (lists and decisions), deals (every deal with filters for what needs attention; one deal's people, money in and out, history, chat and staff actions, with unlock release code, send a failed payout or refund again, and check deadlines now), listings (remove or approve with a reason the seller is told), people (one person's checks, deals and listings; freeze, ban, unfreeze and deal limits), money check, and an audit log you can filter. Counts and pages refresh every 15 seconds.
- Every deal deadline is a Cloudflare Workflow; a 15-minute sweep catches any that didn't fire.
- Checks: `pnpm test` (engine and Access tests), `pnpm db:test` (schema checks), `pnpm db:roles` (checks each site's database login), `pnpm typecheck`.

**Not done yet:**

- Real providers: the payment partner, the crypto partner for USDT and USDC, NIN/BVN checks and email sending are development stand-ins until they're chosen (see `packages/engine/src/partner/`, `idcheck.ts`, `email.ts`). The pretend crypto partner's addresses are deliberately invalid (`0xTEST…`, `TEST0…`) so no wallet can send real USDT to the demo, and its rates are fixed (₦1,500 per USDT, ₦1,498 per USDC). A site with a real bank partner offers bank transfer only until a crypto partner is added in `cryptoFor()` (`packages/engine/src/context.ts`), and the lawyer has confirmed stablecoin payments are allowed. Phone numbers and SMS updates are planned for later.
- Cloudflare Queues for webhooks and SMS retries (they're processed straight away for now), PostHog analytics, image resizing, and a generated 1200×630 link-preview image (the first photo is used).
- The blocklist (phone, bank account, device, IMEI) and seller tools like editing a live listing.
- Deployment: see below.

## Run it locally

```bash
pnpm install
cp .dev.vars.example .dev.vars                       # scripts: database owner, site logins' passwords
cp apps/web/.dev.vars.example apps/web/.dev.vars     # customer site secrets (openssl rand -base64 32)
cp apps/admin/.dev.vars.example apps/admin/.dev.vars # staff site secrets
pnpm db:migrate && pnpm db:roles && pnpm db:seed     # needs PostgreSQL; set DATABASE_URL in .dev.vars
pnpm test                                            # engine tests (creates a noshen_test database)
pnpm dev                                             # customer site: http://localhost:5173
pnpm dev:admin                                       # staff site:    http://localhost:5174
```

`pnpm dev` and `pnpm dev:admin` connect each site with its own database login (`scripts/dev.mjs`).
In development, no email is sent: sign-in codes appear on screen (and every email is printed in the server log), and the pay screen can pretend to be the buyer's bank.
`FIELD_KEY` and `RELEASE_CODE_SECRET` must be the same in all three `.dev.vars` files.
Seed sellers: tunde@example.com, kunle@example.com. Staff: tobi@noshen.test / noshen-dev-staff (on the staff site).

### Turning on Google sign-in

1. In Google Cloud Console, create an OAuth client (type: Web application).
2. Add the redirect URI `<APP_URL>/api/auth/callback/google` (for local development: `http://localhost:5173/api/auth/callback/google`).
3. Put the client ID and secret in `apps/web/.dev.vars` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), or as secrets of the `noshen-web` Worker in production. The "Continue with Google" button appears once both are set.

## Deploying (when the providers and region are decided)

1. **Database.** Create the Neon project (region per the lawyer's answer on data transfer). As the owner: `DATABASE_URL=... pnpm db:migrate`, then
   `DATABASE_URL=... WEB_DB_PASSWORD=... ADMIN_DB_PASSWORD=... pnpm db:roles` with two long random passwords. It creates `noshen_web` and `noshen_admin` and checks their limits.
2. **Hyperdrive, one per site** (caching off, each with its own login):
   `wrangler hyperdrive create noshen-web-db --connection-string=postgres://noshen_web:...@.../noshen --caching-disabled` → id into `apps/web/wrangler.jsonc`;
   `wrangler hyperdrive create noshen-admin-db --connection-string=postgres://noshen_admin:...@.../noshen --caching-disabled` → id into `apps/admin/wrangler.jsonc`.
3. **Photos.** `wrangler r2 bucket create noshen-photos` (both sites use it).
4. **Customer site secrets** (in `apps/web`): `wrangler secret put BETTER_AUTH_SECRET`, `RELEASE_CODE_SECRET`, `FIELD_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the partner's and email provider's keys. Set `APP_URL`, `PARTNER`, `EMAIL`, `ID_PROVIDER`.
5. **Staff site secrets** (in `apps/admin`): a **different** `BETTER_AUTH_SECRET`; the **same** `RELEASE_CODE_SECRET` and `FIELD_KEY`; the partner's and email provider's keys. Set `APP_URL` (the customer site) and `ADMIN_URL` (this site).
6. **Cloudflare Access for the staff site.** In Cloudflare Zero Trust → Access → Applications, add a self-hosted application for `admin.noshen.com` with a policy allowing only your staff's emails (and require a second factor in your identity provider). Copy its **Application Audience (AUD) tag** into `ACCESS_AUD` and your team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN` in `apps/admin/wrangler.jsonc`. Until both are set, the staff site refuses every request on https. It also checks that the staff account signing in matches the email Access let in.
7. **Addresses.** Add the custom domains to each `wrangler.jsonc` (`routes`), and set `"workers_dev": false` on the staff site so its `workers.dev` address can't be used to go around Access.
8. **Staff accounts.** `NOSHEN_VARS=.prod.vars pnpm staff:create "Name" email admin` (or `reviewer`); the email must be one Cloudflare Access allows. They set up two-factor at their first sign-in. To choose your own password: `NOSHEN_VARS=.prod.vars pnpm staff:password email` (typed hidden in the terminal; signs that account out everywhere and is recorded in the audit log).
9. `pnpm deploy:web` and `pnpm deploy:admin`.
