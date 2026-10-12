-- Staff notifications. The staff site's devices (staff_push_subscriptions), and an outbox of alerts (staff_alerts):
-- whichever site notices something for a reviewer writes an alert; the staff site sends it to every active staff
-- member's devices and marks it sent. The customer site can only add alerts: it can't read the outbox or the staff
-- devices (db/roles.sql).
create table staff_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     integer not null default 0
);

create table staff_alerts (
  id         bigint generated always as identity primary key,
  kind       text not null,
  title      text not null check (length(title) <= 120),
  body       text not null check (length(body) <= 300),
  url        text not null check (url ~ '^/'),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index staff_alerts_unsent on staff_alerts (id) where sent_at is null;
