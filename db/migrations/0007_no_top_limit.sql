-- Deal limits, changed by the owner: there's no top price on NosHen any more, and a seller who has passed the
-- ID and bank checks can take deals of any size. Only sellers who haven't verified yet keep a starter limit
-- (₦300,000). Staff can still set a limit on one account (users.max_deal_kobo).
update settings set value = 'null'::jsonb, updated_at = now() where key = 'deal_max_kobo';
update settings set key = 'unverified_seller_max_kobo', value = to_jsonb(coalesce((value ->> 'max_deal_kobo')::bigint, 30000000)), updated_at = now()
  where key = 'new_seller';
