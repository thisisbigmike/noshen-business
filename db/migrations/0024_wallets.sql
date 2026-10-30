-- Everyone's NosHen wallet: fixed deposit addresses held by NosHen's wallet provider (Blockradar), and a balance in
-- each coin on each network. Nobody but NosHen holds the keys. Balances live in their own double-entry ledger, in
-- millionths of a coin, separate from the naira ledger: the database refuses an unbalanced transaction, and a
-- balance below zero.

create table wallet_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id),
  family       text not null check (family in ('solana', 'evm')),  -- one EVM address serves Base and BNB Smart Chain
  address      text not null unique,
  provider     text not null,
  provider_ref text not null unique,                                 -- the provider's id for the address
  created_at   timestamptz not null default now(),
  unique (user_id, family)
);

-- Every message the wallet provider sent, once each, as it was sent: for the record, and to process each only once.
create table wallet_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event        text not null,                 -- "deposit.success", "withdraw.failed", ...
  provider_ref text not null,                 -- the provider's id for the transaction
  network      text not null,
  payload      jsonb not null,
  result       text,                          -- what NosHen did with it
  received_at  timestamptz not null default now(),
  unique (provider, event, provider_ref)
);

create table wallet_transactions (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('deposit', 'withdrawal', 'withdrawal_sent', 'withdrawal_returned', 'adjustment')),
  user_id    uuid references users (id),
  memo       text,
  created_at timestamptz not null default now()
);

-- custody: the coin NosHen holds with its provider. user_balance: what NosHen owes each person.
-- withdrawals_out: taken from a balance and on its way out, until the network confirms it (or it comes back).
create table wallet_entries (
  id           bigint generated always as identity primary key,
  txn_id       uuid not null references wallet_transactions (id),
  account      text not null check (account in ('custody', 'user_balance', 'withdrawals_out')),
  user_id      uuid references users (id),
  coin         text not null check (coin in ('usdt', 'usdc')),
  network      text not null check (network in ('solana', 'base', 'bsc')),
  debit_micro  bigint not null default 0 check (debit_micro >= 0),
  credit_micro bigint not null default 0 check (credit_micro >= 0),
  at           timestamptz not null default now(),
  check ((debit_micro = 0) <> (credit_micro = 0)),                -- exactly one side per entry
  check ((account = 'user_balance') = (user_id is not null))       -- only a balance belongs to a person
);
create index wallet_entries_by_balance on wallet_entries (user_id, coin, network) where account = 'user_balance';
create trigger wallet_entries_append_only before update or delete on wallet_entries for each row execute function forbid_change();

-- Each transaction balances in every coin on every network: USDT owed can't be covered by USDC held.
create function wallet_check_balanced() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from wallet_entries where txn_id = new.txn_id
    group by coin, network having sum(debit_micro) <> sum(credit_micro)
  ) then
    raise exception 'wallet transaction % is unbalanced', new.txn_id using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger wallet_entries_balanced after insert on wallet_entries
  deferrable initially deferred for each row execute function wallet_check_balanced();

-- Nobody's balance ever goes below zero, however many withdrawals race each other.
create function wallet_check_not_negative() returns trigger language plpgsql as $$
begin
  if new.account = 'user_balance' and (
    select sum(credit_micro - debit_micro) from wallet_entries
    where account = 'user_balance' and user_id = new.user_id and coin = new.coin and network = new.network
  ) < 0 then
    raise exception 'wallet balance would go below zero' using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger wallet_balance_not_negative after insert on wallet_entries
  deferrable initially deferred for each row execute function wallet_check_not_negative();

create table wallet_deposits (
  id             uuid primary key default gen_random_uuid(),
  provider_ref   text not null unique,         -- the provider's id for the transaction: each deposit counts once
  user_id        uuid not null references users (id),
  address_id     uuid not null references wallet_addresses (id),
  coin           text not null check (coin in ('usdt', 'usdc')),
  network        text not null check (network in ('solana', 'base', 'bsc')),
  amount_micro   bigint not null check (amount_micro > 0),
  tx_hash        text,
  sender_address text,
  txn_id         uuid not null references wallet_transactions (id),
  received_at    timestamptz not null
);
create index wallet_deposits_by_user on wallet_deposits (user_id, received_at desc);

create table wallet_withdrawals (
  id               uuid primary key default gen_random_uuid(),   -- also the reference the provider is given
  user_id          uuid not null references users (id),
  coin             text not null check (coin in ('usdt', 'usdc')),
  network          text not null check (network in ('solana', 'base', 'bsc')),
  amount_micro     bigint not null check (amount_micro > 0),
  to_address_enc   bytea not null,
  to_address_last4 text not null,
  -- pending: taken from the balance, not yet accepted by the provider (or the answer was lost: check before sending
  -- again). sent: accepted. succeeded / failed: the network's answer; a failed one goes back to the balance.
  status           text not null default 'pending' check (status in ('pending', 'sent', 'succeeded', 'failed')),
  provider_ref     text unique,
  tx_hash          text,
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index wallet_withdrawals_by_user on wallet_withdrawals (user_id, created_at desc);
create trigger wallet_withdrawals_updated_at before update on wallet_withdrawals for each row execute function set_updated_at();
