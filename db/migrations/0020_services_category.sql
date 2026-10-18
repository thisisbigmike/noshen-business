-- Services and repairs: jobs paid into escrow and released in stages (see 0021). Its own file: a new enum value
-- can't be used in the transaction that adds it.
alter type listing_category add value if not exists 'services';
