-- Sellers' social handles (Instagram, TikTok, Facebook, X), for "Check a seller": a buyer who found a vendor on
-- social media can look the handle up and see their NosHen track record. A handle shows only once NosHen has seen
-- the seller's code in that profile's bio, so nobody can borrow another vendor's name.
--   added     the seller added it and has a code to put in their bio
--   submitted they say the code is there; staff check the profile
--   verified  staff saw the code; buyers can find it
--   rejected  staff couldn't see the code (or it's verified for someone else); the seller can try again
--   removed   the seller took it off
create table social_handles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id),
  platform      text not null check (platform in ('instagram', 'tiktok', 'facebook', 'x')),
  handle        text not null check (handle ~ '^[a-z0-9._]{1,50}$'),
  code          text not null check (code ~ '^NOSHEN-[A-Z2-9]{4}$'),
  status        text not null default 'added' check (status in ('added', 'submitted', 'verified', 'rejected', 'removed')),
  submitted_at  timestamptz,
  checked_at    timestamptz,
  checked_by    uuid references staff (id),
  reject_reason text check (length(reject_reason) <= 300),
  created_at    timestamptz not null default now()
);

-- A handle belongs to one seller: only one verified row per platform and handle.
create unique index social_handles_one_verified on social_handles (platform, handle) where status = 'verified';
-- A seller lists each handle once.
create unique index social_handles_once_per_seller on social_handles (user_id, platform, handle) where status <> 'removed';
create index social_handles_lookup on social_handles (handle) where status = 'verified';
create index social_handles_to_check on social_handles (submitted_at) where status = 'submitted';
