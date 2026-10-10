-- NosHen is a marketplace for anything people sell, not only phones and laptops.
-- New categories, two problem reasons that fit them, a chassis number for cars, and a price range wide
-- enough for a pair of shoes and a car. (The new enum values are not used in this transaction:
-- the car rule compares category as text.)
begin;

alter type listing_category add value if not exists 'electronics';
alter type listing_category add value if not exists 'fashion';
alter type listing_category add value if not exists 'shoes';
alter type listing_category add value if not exists 'vehicle';
alter type listing_category add value if not exists 'home';
alter type listing_category add value if not exists 'other';

alter type dispute_reason add value if not exists 'counterfeit';
alter type dispute_reason add value if not exists 'documents_mismatch';

-- A live car listing carries the chassis number (VIN) the buyer matches against the papers.
alter table listings add constraint listings_vehicle_chassis
  check (category::text <> 'vehicle' or status in ('draft', 'removed') or coalesce(imei_or_serial ~ '^[A-Z0-9]{6,20}$', false));

update settings set value = '500000', updated_at = now() where key = 'deal_min_kobo';        -- ₦5,000
update settings set value = '2000000000', updated_at = now() where key = 'deal_max_kobo';    -- ₦20,000,000

commit;
