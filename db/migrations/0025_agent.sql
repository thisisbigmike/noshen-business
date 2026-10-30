-- The NosHen assistant (the Telegram bot) acting for a person: the chats linked to accounts, the one-time codes that
-- link them, what the assistant asked for, and the switch staff use to stop it for one person.

create table agent_links (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id),
  channel       text not null check (channel in ('telegram')),
  external_id   text not null,                 -- the person's id on that channel (a Telegram user id)
  external_name text,                          -- their name there, as the channel gave it, so people recognise it
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    text check (revoked_by in ('user', 'staff', 'relinked')),
  check ((revoked_at is null) = (revoked_by is null))
);
-- One account per chat at a time; linking again moves the chat to the new account.
create unique index agent_links_one_live on agent_links (channel, external_id) where revoked_at is null;
create index agent_links_by_user on agent_links (user_id);

-- A code is only ever in the link the assistant sends; the database keeps a hash of it.
create table agent_link_codes (
  code_hash     text primary key,
  channel       text not null check (channel in ('telegram')),
  external_id   text not null,
  external_name text,
  expires_at    timestamptz not null,
  used_at       timestamptz
);

-- Every request the assistant made for a linked person, for staff to see.
create table agent_requests (
  id      bigint generated always as identity primary key,
  link_id uuid not null references agent_links (id),
  action  text not null,
  ok      boolean not null,
  at      timestamptz not null default now()
);
create index agent_requests_by_link on agent_requests (link_id, at desc);

alter table users add column agent_blocked_at timestamptz;  -- staff stopped the assistant acting for this person
