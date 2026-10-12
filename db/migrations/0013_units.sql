-- How many of an item a seller has, and how many have sold. Each deal is for one; every completed deal (released)
-- counts one sold, and the listing becomes 'sold' when the last one goes. Listings already sold count as one of one.
alter table listings
  add column quantity   integer not null default 1 check (quantity between 1 and 999),
  add column sold_count integer not null default 0 check (sold_count >= 0);
update listings set sold_count = 1 where status = 'sold';
alter table listings add constraint listings_sold_within_quantity check (sold_count <= quantity);
-- When it sold out, so Browse can show recent sales for a while.
alter table listings add column sold_at timestamptz;
update listings set sold_at = coalesce(published_at, created_at) where status = 'sold';
-- More than one deal can be under way on a listing now (one per unit). Acceptance checks the units left, under a
-- lock on the listing, instead of this one-deal-per-listing rule.
drop index deals_one_active_per_listing;
