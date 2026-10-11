-- Paying with USDT. A deal is still priced and held in naira: the buyer sends USDT to an address our crypto
-- partner opens for the deal, at an amount fixed for 30 minutes, and the partner turns it into naira for the
-- deal. Refunds go back as USDT to an address the buyer gives before they pay.

create table crypto_deposits (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              uuid not null references deals (id),
  network              text not null check (network in ('solana', 'bsc', 'base', 'ethereum')),
  provider             text not null,
  provider_ref         text not null unique,      -- the partner's reference for this address
  address              text not null,             -- where the buyer sends USDT
  amount_kobo          bigint not null check (amount_kobo > 0),          -- what the USDT pays: the deal's amount due
  usdt_micro           bigint not null check (usdt_micro > 0),           -- the USDT to send, in millionths
  rate_kobo_per_usdt   bigint not null check (rate_kobo_per_usdt > 0),
  quote_expires_at     timestamptz not null,
  refund_address_enc   bytea not null,            -- the buyer's own address on this network, for refunds
  refund_address_last4 text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (deal_id, network)
);
create trigger crypto_deposits_updated_at before update on crypto_deposits for each row execute function set_updated_at();

alter table payments
  add column method            text not null default 'bank' check (method in ('bank', 'usdt')),
  add column crypto_deposit_id uuid references crypto_deposits (id),
  add column network           text check (network in ('solana', 'bsc', 'base', 'ethereum')),
  add column tx_hash           text,
  add column amount_usdt_micro bigint check (amount_usdt_micro > 0),
  add constraint payments_usdt_details check (method <> 'usdt' or (network is not null and tx_hash is not null and amount_usdt_micro is not null));
create index payments_by_tx on payments (network, tx_hash) where tx_hash is not null;

-- With two ways to pay, a buyer may pay twice. A payment that arrives once the deal is already paid (or closed)
-- is sent straight back on its own, so it no longer counts towards the deal: refunds, payouts and the money check
-- leave it out. Each payment can be sent back once; a deal is still refunded in full only once (its state says so).
alter table payments add column sent_back boolean not null default false;
drop index transfers_one_refund_per_deal;
create unique index transfers_one_refund_per_payment on transfers (refund_payment_id) where kind = 'refund' and status <> 'failed' and refund_payment_id is not null;
create unique index transfers_one_refund_per_deal on transfers (deal_id) where kind = 'refund' and status <> 'failed' and refund_payment_id is null;

create or replace view held_funds_check as
select
  (select coalesce(sum(credit_kobo - debit_kobo), 0) from ledger_entries where account = 'held_funds') as ledger_held_kobo,
  (select coalesce(sum(p.amount_kobo), 0)
     from payments p join deals d on d.id = p.deal_id
    where d.state in ('held', 'disputed') and not p.sent_back)                                    as open_deals_kobo;
