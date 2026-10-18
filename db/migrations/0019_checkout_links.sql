-- Checkout links: a listing can be shown on NosHen (public) or only to people with its link (link), for sellers who
-- sell on Instagram, WhatsApp or Facebook. A link listing never appears in Browse or search, and a buyer who opens it
-- is accepted straight away: the seller agreed to sell when they shared it.
alter table listings add column visibility text not null default 'public' check (visibility in ('public', 'link'));
