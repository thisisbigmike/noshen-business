-- Phase 1 & Phase 2 features:
-- 1. Extend existing blocklist table with id_number/email/social_handle kinds, masked label, and soft-removal.
-- 2. Saved listings (buyer watchlist).
-- 3. Quick Escrow Links (visibility = 'link') allowed without 3 marketplace photos; public listings still require 3+.
-- 4. Price offers (deals.listed_price_kobo keeps the asking price when a buyer makes a lower offer).

alter type blocklist_kind add value if not exists 'id_number';
alter type blocklist_kind add value if not exists 'email';
alter type blocklist_kind add value if not exists 'social_handle';

alter table blocklist add column if not exists label text;
alter table blocklist add column if not exists removed_at timestamptz;

-- Allow soft-deleted blocklist entries to be re-added later without violating uniqueness.
alter table blocklist drop constraint if exists blocklist_kind_value_hmac_key;
create unique index if not exists blocklist_active_unique on blocklist (kind, value_hmac) where removed_at is null;
create index if not exists blocklist_by_kind on blocklist (kind, at desc) where removed_at is null;

create table if not exists saved_listings (
  user_id    uuid not null references users (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index if not exists saved_listings_by_user on saved_listings (user_id, created_at desc);

-- Allow quick link-only checkout deals without 3 marketplace photos; public listings still enforce >= 3 photos.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'listings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%cardinality(photo_keys)%';
  if cname is not null then
    execute format('alter table listings drop constraint %I', cname);
  end if;
end $$;

alter table listings add constraint listings_photos_when_public
  check (status in ('draft', 'removed', 'blocked') or visibility = 'link' or cardinality(photo_keys) >= 3);

-- Remember the original listed price when a buyer submits a negotiated offer.
alter table deals add column if not exists listed_price_kobo bigint check (listed_price_kobo is null or listed_price_kobo > 0);
