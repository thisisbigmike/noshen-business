# NosHen app (first working version, in progress)

Buy and sell safely in Nigeria: the buyer's money is held by a licensed partner until they have the item.
Built from the Claude Design screens and the docs in the `noshen` repo (PRD, TRD, app flow, backend schema).

**Stack:** React Router 8 + Hono on Cloudflare Workers, Workflows for deal timers, R2 for photos,
PostgreSQL (Neon in production, via Hyperdrive with query caching off), Better Auth (phone + SMS code; staff email + two-factor).

## Status

**Works, and tested end to end in the browser** (phone and desktop sizes):

- Buyer: browse → listing → sign in with an SMS code → buy request → pay into the deal account → money held → release-code checklist → code.
- Seller: accept → see what's held for them → enter the code (wrong codes count down and lock after 5) → released → payout confirmed by the partner.
- Delivery deals: mark delivered → buyer confirms, or the money releases 24 hours later.
- Problems: report with photos → money frozen → evidence → a staff reviewer decides → refund or release, with the reason sent to both.
- Selling: photos (stored in R2) → details → the ID and bank checks if not done yet → live listing → share screen with a WhatsApp preview.
- Staff console: email, password and authenticator-app sign-in (two-factor is required), queues, dispute review and decision, review holds, money check, audit log.
- Every deal deadline is a Cloudflare Workflow; a 15-minute sweep catches any that didn't fire.
- Checks: 12 engine tests (`pnpm test`) and 23 schema checks (`pnpm db:test`) pass; the type check is clean.

**Not done yet:**

- Real providers: the payment partner, NIN/BVN checks and SMS are development stand-ins until they're chosen (see `server/partner/`, `server/idcheck.ts`, `server/sms.ts`).
- Cloudflare Queues for webhooks and SMS retries (they're processed straight away for now), PostHog analytics, image resizing, and a generated 1200×630 link-preview image (the first photo is used).
- The console's user page (freeze, limits, blocklist), and seller tools like editing a live listing.
- Deployment: a Neon production database, Hyperdrive (with caching off), R2 bucket and Workers secrets. See below.

## Run it locally

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then fill in secrets (openssl rand -base64 32)
pnpm db:migrate && pnpm db:seed  # needs PostgreSQL; set DATABASE_URL in .dev.vars
pnpm test                        # engine tests (creates a noshen_test database)
pnpm dev                         # http://localhost:5173
```

Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` if your database isn't at the default in `wrangler.jsonc`.
In development, sign-in codes appear on screen, and the pay screen can pretend to be the buyer's bank.
Seed sellers: Tunde 0803 412 7701, Kunle 0803 412 4471. Staff: tobi@noshen.test / noshen-dev-staff.

## Deploying (when the providers and region are decided)

1. Create the Neon project (region per the lawyer's answer on data transfer) and run `DATABASE_URL=... pnpm db:migrate`.
2. `wrangler hyperdrive create noshen-db --connection-string=... --caching-disabled`, and put its id in `wrangler.jsonc`.
3. `wrangler r2 bucket create noshen-photos`.
4. Set secrets: `wrangler secret put BETTER_AUTH_SECRET` (and `RELEASE_CODE_SECRET`, `FIELD_KEY`, the partner's keys). Set `APP_URL`, `PARTNER`, `SMS`, `ID_PROVIDER` vars.
5. Create staff with `pnpm staff:create "Name" email admin`; they set up two-factor at first sign-in.
6. `pnpm deploy`. Put Cloudflare Access in front of `/staff`.

