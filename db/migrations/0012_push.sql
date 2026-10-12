-- Phone and computer notifications (Web Push). One row per device that turned notifications on: where its push
-- service is, and the keys to encrypt messages for it. A device that turns them off (or is gone) is removed when
-- its push service says so.
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     integer not null default 0
);
create index push_subscriptions_by_user on push_subscriptions (user_id);
