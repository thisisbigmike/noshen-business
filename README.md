# NosHen app (first working version, in progress)

Buy and sell safely in Nigeria: the buyer's money is held by a licensed partner until they have the item.
Built from the Claude Design screens and the docs in the `noshen` repo (PRD, TRD, app flow, backend schema).

**Stack:** React Router 8 + Hono on Cloudflare Workers, Workflows for deal timers, R2 for photos,
PostgreSQL (Neon in production, via Hyperdrive with query caching off), Better Auth (phone + SMS code; staff email + two-factor).

## Status

- Done: database migrations (our schema + Better Auth), deal engine (request, accept, pay, hold, release by code,
  delivery, cancel, refund, disputes, review holds, timers, ledger), 12 engine tests + 23 schema checks passing,
  fake payment partner, ID check and SMS for development, buyer and seller pages (browse, listing, sign-in,
  buy request, deals, deal page with chat, pay, release code, enter code, report, evidence, sell, account, verify).
- Tested in the browser so far: browse, listing, sign-in with SMS code, buy request screen.
- Not done yet: staff console pages (`app/routes/staff/*` are placeholders), finishing the browser test of the
  whole deal flow, PostHog, Cloudflare Queues for webhooks, real partner/ID/SMS providers, deployment.

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
