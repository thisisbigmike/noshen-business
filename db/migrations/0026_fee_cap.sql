-- Fee cap, changed by the owner: 1.5% of the price, at least ₦500 and now at most ₦10,000 (was ₦7,500).
-- Deals already made keep the fee fixed on them.
update settings set value = jsonb_set(value, '{max_kobo}', '1000000'), updated_at = now() where key = 'fee';
