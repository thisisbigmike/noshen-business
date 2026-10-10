-- More of what people sell in Lagos: hair and wigs, beauty and perfume, watches and jewellery,
-- baby and kids, sports and fitness. None needs an ID number at the hand-over.
begin;

alter type listing_category add value if not exists 'hair';
alter type listing_category add value if not exists 'beauty';
alter type listing_category add value if not exists 'jewellery';
alter type listing_category add value if not exists 'baby';
alter type listing_category add value if not exists 'sports';

commit;
