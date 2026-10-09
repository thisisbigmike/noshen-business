-- NosHen v1 database schema (PostgreSQL 15 or later).
--
-- Conventions
--   * Money is in kobo, as bigint. Never floating point.
--   * Times are timestamptz. IDs are UUIDs unless a table is an append-only log.
--   * Secrets and bank account numbers are encrypted or HMAC'd by the API before they reach the
--     database (columns ending _enc and _hmac); the database never sees them in plain text.
--   * deal_events, ledger_entries and staff_actions are append-only.
--   * Deal timers run in Cloudflare Workflows, outside the database; sign-in moves to Better Auth
--     in migration 0002 (see docs/backend-schema.md). Hosted on Neon; nothing here is Neon-specific.
--
-- See docs/backend-schema.md for the reasoning, and db/tests.sql for the checks.

begin;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type user_status          as enum ('active', 'frozen', 'banned');
create type staff_role           as enum ('reviewer', 'admin');
create type staff_status         as enum ('active', 'disabled');
create type kyc_type             as enum ('nin', 'bvn');
create type kyc_result           as enum ('pending', 'verified', 'failed');
create type listing_category     as enum ('phone', 'laptop');
create type listing_condition    as enum ('new', 'like_new', 'good', 'fair');
create type listing_status       as enum ('draft', 'live', 'paused', 'sold', 'removed', 'blocked');
create type deal_state           as enum ('requested', 'accepted', 'held', 'disputed', 'released', 'paid_out', 'refunded', 'declined');
create type handover_method      as enum ('meetup', 'delivery');
create type fee_payer            as enum ('buyer', 'seller');
create type actor_type           as enum ('buyer', 'seller', 'staff', 'system', 'partner');
create type transfer_kind        as enum ('payout', 'refund', 'fee_sweep');
create type transfer_status      as enum ('pending', 'sent', 'succeeded', 'failed', 'reversed');
create type ledger_account       as enum ('partner_cash', 'held_funds', 'seller_payable', 'refunds_due', 'fee_revenue', 'operating_cash');
create type dispute_reason       as enum ('not_as_described', 'not_working', 'locked', 'imei_mismatch', 'not_delivered', 'other');
create type dispute_state        as enum ('collecting_evidence', 'in_review', 'decided');
create type dispute_decision     as enum ('refund_buyer', 'release_to_seller');
create type notification_channel as enum ('sms', 'in_app');
create type notification_status  as enum ('queued', 'sent', 'delivered', 'failed', 'read');
create type blocklist_kind       as enum ('phone', 'bank_account', 'device', 'imei');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table users (
  id                uuid primary key default gen_random_uuid(),
  phone             text not null unique check (phone ~ '^\+234[0-9]{10}$'),
  full_name         text check (full_name is null or length(full_name) between 2 and 120),
  status            user_status not null default 'active',
  max_deal_kobo     bigint check (max_deal_kobo is null or max_deal_kobo > 0), -- staff override; null = the rules in settings
  -- Where the person came from, for channel measurement (docs/pcf.md).
  signup_source     text,          -- 'listing_link', 'browse', 'referral', 'dealer_onboarding', ...
  signup_ref        text,          -- campaign or ref code from the link
  signup_listing_id uuid,          -- the listing link they arrived on; foreign key added below
  referred_by       uuid references users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger users_updated_at before update on users for each row execute function set_updated_at();

create table login_codes (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  code_hmac  bytea not null,
  attempts   smallint not null default 0 check (attempts between 0 and 5),
  ip         inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  check (expires_at > created_at)
);
create index login_codes_by_phone on login_codes (phone, created_at desc);
create index login_codes_by_ip    on login_codes (ip, created_at desc);

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id),
  token_hash   bytea not null unique,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index sessions_by_user on sessions (user_id);

create table staff (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  name            text not null,
  role            staff_role not null,
  totp_secret_enc bytea not null,
  status          staff_status not null default 'active',
  created_at      timestamptz not null default now()
);

create table staff_sessions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff (id),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table kyc_checks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id),
  type           kyc_type not null,
  provider       text not null,
  provider_ref   text not null,
  result         kyc_result not null default 'pending',
  verified_name  text,
  failure_reason text,
  checked_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (provider, provider_ref),
  check (result <> 'verified' or (verified_name is not null and checked_at is not null))
);
create index kyc_checks_by_user on kyc_checks (user_id, created_at desc);

create table bank_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users (id),
  bank_code              text not null,
  account_number_enc     bytea not null,  -- encrypted by the API; decrypted only to pay out
  account_number_hmac    bytea not null,  -- for duplicate and blocklist checks
  account_last4          text not null check (account_last4 ~ '^[0-9]{4}$'),
  account_name           text not null,   -- as returned by the partner's account check
  name_matches_id        boolean not null default false,
  partner_recipient_code text,            -- the partner's handle for paying this account
  is_default             boolean not null default false,
  verified_at            timestamptz,
  created_at             timestamptz not null default now(),
  removed_at             timestamptz,
  check (not is_default or (verified_at is not null and name_matches_id))
);
create unique index bank_accounts_one_default on bank_accounts (user_id) where is_default and removed_at is null;
create unique index bank_accounts_no_duplicates on bank_accounts (user_id, account_number_hmac) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------

create table listings (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references users (id),
  category       listing_category not null,
  title          text not null check (length(title) between 3 and 80),
  description    text check (length(description) <= 2000),
  price_kobo     bigint not null check (price_kobo > 0),
  condition      listing_condition not null,
  area           text not null,           -- 'Yaba', 'Ikeja', ...
  imei_or_serial text,
  photo_keys     text[] not null default '{}',
  status         listing_status not null default 'draft',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  published_at   timestamptz,
  unique (id, seller_id),                 -- lets deals prove their seller owns the listing
  check (status in ('draft', 'removed', 'blocked') or cardinality(photo_keys) >= 3),
  check (category <> 'phone' or status in ('draft', 'removed') or coalesce(imei_or_serial ~ '^[0-9]{15}$', false))
);
create trigger listings_updated_at before update on listings for each row execute function set_updated_at();
-- One live listing per device: a second listing with the same IMEI is kept as 'blocked' for review.
create unique index listings_one_live_per_device on listings (imei_or_serial) where status = 'live' and imei_or_serial is not null;
create index listings_browse on listings (category, area, published_at desc) where status = 'live';
create index listings_by_seller on listings (seller_id, created_at desc);

alter table users add foreign key (signup_listing_id) references listings (id);

-- ---------------------------------------------------------------------------
-- Deals
-- ---------------------------------------------------------------------------

create table deals (
  id                        uuid primary key default gen_random_uuid(),
  listing_id                uuid not null,
  buyer_id                  uuid not null references users (id),
  seller_id                 uuid not null references users (id),
  price_kobo                bigint not null check (price_kobo > 0),
  fee_kobo                  bigint not null check (fee_kobo >= 0),
  fee_payer                 fee_payer not null default 'buyer',
  amount_due_kobo           bigint generated always as
                              (case when fee_payer = 'buyer' then price_kobo + fee_kobo else price_kobo end) stored,
  seller_share_kobo         bigint generated always as
                              (case when fee_payer = 'seller' then price_kobo - fee_kobo else price_kobo end) stored,
  handover                  handover_method not null,
  state                     deal_state not null default 'requested',
  state_changed_at          timestamptz not null default now(),
  request_expires_at        timestamptz not null,  -- seller must answer by then (12 hours)
  payment_due_at            timestamptz,           -- buyer must pay by then once accepted
  handover_due_at           timestamptz,           -- 72 hours after payment
  delivered_at              timestamptz,
  release_due_at            timestamptz,           -- 24 hours after delivered
  collection_ref            text unique,           -- the partner's reference for this deal's collection account
  collection_account_number text,
  collection_bank_name      text,
  review_hold               boolean not null default false, -- set by fraud rules; blocks release until a reviewer clears it
  review_hold_reason        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  closed_at                 timestamptz,
  foreign key (listing_id, seller_id) references listings (id, seller_id),
  check (buyer_id <> seller_id),
  check (fee_payer = 'buyer' or fee_kobo < price_kobo),
  check (review_hold = (review_hold_reason is not null)),
  check (delivered_at is null or handover = 'delivery'),
  check ((state in ('paid_out', 'refunded', 'declined')) = (closed_at is not null))
);
create trigger deals_updated_at before update on deals for each row execute function set_updated_at();
-- Many buyers may request the same listing, but only one deal at a time can go ahead.
create unique index deals_one_active_per_listing on deals (listing_id) where state in ('accepted', 'held', 'disputed');
create index deals_by_buyer  on deals (buyer_id, created_at desc);
create index deals_by_seller on deals (seller_id, created_at desc);
create index deals_open      on deals (state, state_changed_at) where state not in ('paid_out', 'refunded', 'declined');

-- The state machine from the TRD, enforced by the database as well as the API.
create function deals_guard() returns trigger language plpgsql as $$
begin
  if new.state is distinct from old.state then
    if (old.state::text || '>' || new.state::text) not in (
         'requested>accepted', 'requested>declined',
         'accepted>held',      'accepted>declined',
         'held>released',      'held>refunded',     'held>disputed',
         'disputed>refunded',  'disputed>released',
         'released>paid_out') then
      raise exception 'deal %: % -> % is not an allowed move', old.id, old.state, new.state
        using errcode = 'check_violation';
    end if;
    if new.state = 'released' and old.review_hold then
      raise exception 'deal % is held for review and cannot be released', old.id using errcode = 'check_violation';
    end if;
    new.state_changed_at := now();
    if new.state in ('paid_out', 'refunded', 'declined') then
      new.closed_at := now();
    end if;
  end if;
  -- Terms are fixed once the seller accepts.
  if old.state <> 'requested' and (new.price_kobo, new.fee_kobo, new.fee_payer, new.buyer_id, new.seller_id, new.listing_id, new.handover)
     is distinct from (old.price_kobo, old.fee_kobo, old.fee_payer, old.buyer_id, old.seller_id, old.listing_id, old.handover) then
    raise exception 'deal %: terms cannot change after acceptance', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger deals_guard before update on deals for each row execute function deals_guard();

-- Timeline: every deal's history, append-only. The API sets noshen.actor and noshen.actor_id
-- (set_config(..., true)) in each transaction so state changes are logged with who made them.
create table deal_events (
  id         bigint generated always as identity primary key,
  deal_id    uuid not null references deals (id),
  type       text not null,
  actor      actor_type not null,
  actor_id   uuid,                 -- a user or staff id; null for system and partner
  from_state deal_state,
  to_state   deal_state,
  payload    jsonb not null default '{}',
  at         timestamptz not null default now()
);
create index deal_events_by_deal on deal_events (deal_id, id);
create trigger deal_events_append_only before update or delete on deal_events for each row execute function forbid_change();

create function deals_log() returns trigger language plpgsql as $$
begin
  insert into deal_events (deal_id, type, actor, actor_id, from_state, to_state)
  values (new.id,
          case when tg_op = 'INSERT' then 'created' else 'state_changed' end,
          coalesce(nullif(current_setting('noshen.actor', true), '')::actor_type, 'system'),
          nullif(current_setting('noshen.actor_id', true), '')::uuid,
          case when tg_op = 'INSERT' then null else old.state end,
          new.state);
  return null;
end $$;
create trigger deals_log_insert after insert on deals for each row execute function deals_log();
create trigger deals_log_state  after update of state on deals for each row
  when (old.state is distinct from new.state) execute function deals_log();

create table messages (
  id          bigint generated always as identity primary key,
  deal_id     uuid not null references deals (id),
  sender_id   uuid not null references users (id),
  body        text not null check (length(body) between 1 and 2000),
  flagged     boolean not null default false,  -- looks like off-platform payment
  flag_reason text,
  at          timestamptz not null default now()
);
create index messages_by_deal on messages (deal_id, id);

create table release_codes (
  deal_id         uuid primary key references deals (id),
  code_hmac       bytea not null,
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  used_at         timestamptz,
  voided_at       timestamptz,
  check (used_at is null or voided_at is null)
);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

-- Every webhook, stored after its signature is verified and before it is processed.
create table partner_events (
  id           uuid primary key default gen_random_uuid(),
  partner      text not null,
  event_id     text not null,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 0,
  error        text,
  unique (partner, event_id)        -- the same webhook twice is stored once
);
create index partner_events_unprocessed on partner_events (received_at) where processed_at is null;

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid references deals (id),  -- null when the payment could not be matched to a deal
  partner_event_id   uuid not null unique references partner_events (id),
  amount_kobo        bigint not null check (amount_kobo > 0),
  sender_name        text,
  sender_bank_code   text,
  sender_account_enc bytea,                       -- for refunds
  matches_amount_due boolean not null,
  matches_buyer_name boolean,
  received_at        timestamptz not null
);
create index payments_by_deal on payments (deal_id);

create table transfers (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid references deals (id),          -- null for a fee sweep covering many deals
  kind              transfer_kind not null,
  amount_kobo       bigint not null check (amount_kobo > 0),
  bank_account_id   uuid references bank_accounts (id),  -- payout to the seller, or refund to an account the buyer gave
  refund_payment_id uuid references payments (id),       -- refund to the account the payment came from
  idempotency_key   text not null unique,                -- deal id + action (+ attempt after a failure)
  partner_ref       text unique,
  status            transfer_status not null default 'pending',
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (kind <> 'payout' or (deal_id is not null and bank_account_id is not null)),
  check (kind <> 'refund' or (deal_id is not null and (bank_account_id is not null or refund_payment_id is not null)))
);
create trigger transfers_updated_at before update on transfers for each row execute function set_updated_at();
create unique index transfers_one_payout_per_deal on transfers (deal_id) where kind = 'payout' and status <> 'failed';
create unique index transfers_one_refund_per_deal on transfers (deal_id) where kind = 'refund' and status <> 'failed';

-- Double-entry ledger. Each transaction's debits equal its credits (checked at commit).
create table ledger_transactions (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid references deals (id),
  kind       text not null check (kind in ('payment_received', 'release', 'payout_sent', 'refund_due', 'refund_sent', 'fee_swept', 'adjustment')),
  memo       text,
  created_at timestamptz not null default now()
);

create table ledger_entries (
  id          bigint generated always as identity primary key,
  txn_id      uuid not null references ledger_transactions (id),
  account     ledger_account not null,
  deal_id     uuid references deals (id),
  debit_kobo  bigint not null default 0 check (debit_kobo >= 0),
  credit_kobo bigint not null default 0 check (credit_kobo >= 0),
  at          timestamptz not null default now(),
  check ((debit_kobo = 0) <> (credit_kobo = 0))     -- exactly one side per entry
);
create index ledger_entries_by_txn     on ledger_entries (txn_id);
create index ledger_entries_by_account on ledger_entries (account, deal_id);
create trigger ledger_entries_append_only before update or delete on ledger_entries for each row execute function forbid_change();

create function ledger_check_balanced() returns trigger language plpgsql as $$
declare
  debits  bigint;
  credits bigint;
begin
  select coalesce(sum(debit_kobo), 0), coalesce(sum(credit_kobo), 0)
    into debits, credits
    from ledger_entries where txn_id = new.txn_id;
  if debits <> credits then
    raise exception 'ledger transaction % is unbalanced: debits % <> credits %', new.txn_id, debits, credits
      using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_check_balanced();

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

create table disputes (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null unique references deals (id), -- one dispute per deal: release is final
  opened_by       uuid not null references users (id),
  reason          dispute_reason not null,
  description     text check (length(description) <= 2000),
  state           dispute_state not null default 'collecting_evidence',
  evidence_due_at timestamptz not null,  -- 24 hours after the report
  decision_due_at timestamptz not null,  -- 72 hours after the report
  decision        dispute_decision,
  decided_by      uuid references staff (id),
  decision_reason text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  check ((state = 'decided') = (decision is not null and decided_by is not null and decision_reason is not null and decided_at is not null))
);
create index disputes_queue on disputes (decision_due_at) where state <> 'decided';

create table evidence (
  id          uuid primary key default gen_random_uuid(),
  dispute_id  uuid not null references disputes (id),
  uploader_id uuid not null references users (id),
  file_key    text,
  note        text check (length(note) <= 2000),
  at          timestamptz not null default now(),
  check (file_key is not null or note is not null)
);
create index evidence_by_dispute on evidence (dispute_id, at);

-- ---------------------------------------------------------------------------
-- After the deal
-- ---------------------------------------------------------------------------

create table ratings (
  id       uuid primary key default gen_random_uuid(),
  deal_id  uuid not null references deals (id),
  rater_id uuid not null references users (id),
  ratee_id uuid not null references users (id),
  stars    smallint not null check (stars between 1 and 5),
  comment  text check (length(comment) <= 500),
  at       timestamptz not null default now(),
  unique (deal_id, rater_id),
  check (rater_id <> ratee_id)
);
create index ratings_by_ratee on ratings (ratee_id);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id),
  deal_id      uuid references deals (id),
  channel      notification_channel not null,
  template     text not null,             -- 'payment_held', 'decision_made', ...
  params       jsonb not null default '{}',
  status       notification_status not null default 'queued',
  provider_ref text,
  attempts     smallint not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  read_at      timestamptz
);
create index notifications_by_user on notifications (user_id, created_at desc);
create index notifications_pending on notifications (created_at) where status in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- Staff, risk and operations
-- ---------------------------------------------------------------------------

create table staff_actions (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references staff (id),
  action      text not null,              -- 'freeze_user', 'set_limit', 'decide_dispute', 'clear_review_hold', ...
  target_type text not null,
  target_id   uuid not null,
  reason      text not null check (length(reason) >= 5),
  payload     jsonb not null default '{}',
  at          timestamptz not null default now()
);
create index staff_actions_by_target on staff_actions (target_type, target_id);
create trigger staff_actions_append_only before update or delete on staff_actions for each row execute function forbid_change();

create table blocklist (
  id         uuid primary key default gen_random_uuid(),
  kind       blocklist_kind not null,
  value_hmac bytea not null,
  reason     text not null,
  added_by   uuid not null references staff (id),
  at         timestamptz not null default now(),
  unique (kind, value_hmac)
);

-- Deal rules and fraud thresholds, tunable during the pilot without a release.
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references staff (id),
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('deal_min_kobo',                '2000000'),                                          -- ₦20,000
  ('deal_max_kobo',                '200000000'),                                        -- ₦2,000,000
  ('fee',                          '{"percent": 1.5, "min_kobo": 50000, "max_kobo": 750000}'), -- 1.5%, ₦500 to ₦7,500
  ('request_ttl_hours',            '12'),
  ('payment_ttl_hours',            '24'),                                               -- proposed; not yet in the PRD
  ('handover_window_hours',        '72'),
  ('delivery_confirm_hours',       '24'),
  ('evidence_window_hours',        '24'),
  ('dispute_decision_hours',       '72'),
  ('release_code',                 '{"digits": 6, "max_attempts": 5, "lock_minutes": 30}'),
  ('new_seller',                   '{"deals": 3, "max_deal_kobo": 30000000}'),          -- 3 deals up to ₦300,000
  ('buyer_id_required_above_kobo', '50000000'),                                         -- ₦500,000
  ('login_code',                   '{"digits": 6, "ttl_minutes": 5, "per_phone_per_hour": 3}');

create table reconciliation_runs (
  id                   uuid primary key default gen_random_uuid(),
  day                  date not null unique,
  partner_balance_kobo bigint not null,
  ledger_balance_kobo  bigint not null,
  difference_kobo      bigint generated always as (partner_balance_kobo - ledger_balance_kobo) stored,
  details              jsonb not null default '{}',
  ran_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Views for the checks the TRD asks for
-- ---------------------------------------------------------------------------

-- Balance of every ledger account, overall and per deal. Positive = debit balance.
create view account_balances as
select account, deal_id, sum(debit_kobo) - sum(credit_kobo) as balance_kobo
from ledger_entries
group by account, deal_id;

-- Money the ledger says is held must equal the money paid into deals that are still open.
create view held_funds_check as
select
  (select coalesce(sum(credit_kobo - debit_kobo), 0) from ledger_entries where account = 'held_funds') as ledger_held_kobo,
  (select coalesce(sum(p.amount_kobo), 0)
     from payments p join deals d on d.id = p.deal_id
    where d.state in ('held', 'disputed'))                                                         as open_deals_kobo;

commit;
