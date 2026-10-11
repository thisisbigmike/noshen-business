-- Checks for db/schema.sql. Run against a fresh database after the schema:
--   psql -v ON_ERROR_STOP=1 -f db/schema.sql -f db/tests.sql
-- Every check raises an exception if it fails; the whole run rolls back at the end.

begin;

-- Money already held by real deals, so the ledger check also works on a database that isn't empty.
create temp table baseline as select ledger_held_kobo as held from held_funds_check;

create function pg_temp.expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (refused: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % was allowed', label;
end $$;

create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Fixtures: Tunde sells an iPhone 13 for ₦450,000; Chioma buys it.
insert into users (id, phone, full_name) values
  ('00000000-0000-0000-0000-00000000000a', '+2348030000001', 'Tunde Bakare'),
  ('00000000-0000-0000-0000-00000000000b', '+2348030000002', 'Chioma Obi'),
  ('00000000-0000-0000-0000-00000000000c', '+2348030000003', 'Third Person');
insert into staff (id, email, name, role, totp_secret_enc) values
  ('00000000-0000-0000-0000-0000000000f1', 'reviewer@noshen.test', 'Reviewer', 'reviewer', '\x00');
insert into listings (id, seller_id, category, title, price_kobo, condition, area, state, imei_or_serial, photo_keys, status, published_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'phone', 'iPhone 13, 128GB',
   45000000, 'good', 'Yaba', 'Lagos', '356789012345678', '{p1,p2,p3}', 'live', now());

-- 1. Listings
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, state, imei_or_serial, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'phone', 'Same phone again', 40000000, 'good', 'Ikeja', 'Lagos',
          '356789012345678', '{p1,p2,p3}', 'live') $$, 'a second live listing with the same IMEI');
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, state, imei_or_serial, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'phone', 'Two photos only', 40000000, 'good', 'Ikeja', 'Lagos',
          '356789012345679', '{p1,p2}', 'live') $$, 'a live listing with fewer than 3 photos');
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, state, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'phone', 'No IMEI', 40000000, 'good', 'Ikeja', 'Lagos', '{p1,p2,p3}', 'live') $$,
  'a live phone listing without an IMEI');
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, state, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'vehicle', 'No chassis number', 500000000, 'good', 'Ikeja', 'Lagos', '{p1,p2,p3}', 'live') $$,
  'a live car listing without a chassis number');
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, state, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'fashion', 'Nowhere', 2000000, 'good', 'Somewhere', 'Atlantis', '{p1,p2,p3}', 'live') $$,
  'a listing in a state that isn''t in Nigeria');
select pg_temp.expect_error($$
  insert into listings (seller_id, category, title, price_kobo, condition, area, photo_keys, status)
  values ('00000000-0000-0000-0000-00000000000c', 'fashion', 'No state', 2000000, 'good', 'Yaba', '{p1,p2,p3}', 'live') $$,
  'a published listing without a state');
select pg_temp.expect_error($$ insert into users (phone) values ('08030000004') $$, 'a phone number not in +234 format');

-- 2. Deals: who and what
select pg_temp.expect_error($$
  insert into deals (listing_id, buyer_id, seller_id, price_kobo, fee_kobo, handover, request_expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b',
          '00000000-0000-0000-0000-00000000000c', 45000000, 675000, 'meetup', now() + interval '12 hours') $$,
  'a deal whose seller does not own the listing');
select pg_temp.expect_error($$
  insert into deals (listing_id, buyer_id, seller_id, price_kobo, fee_kobo, handover, request_expires_at)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-00000000000a', 45000000, 675000, 'meetup', now() + interval '12 hours') $$,
  'a seller buying from themselves');

insert into deals (id, listing_id, buyer_id, seller_id, price_kobo, fee_kobo, handover, request_expires_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-00000000000a', 45000000, 675000, 'meetup', now() + interval '12 hours');
select pg_temp.expect((select amount_due_kobo = 45675000 and seller_share_kobo = 45000000 from deals
                       where id = '00000000-0000-0000-0000-0000000000d1'),
                      'buyer pays the fee: due ₦456,750, seller gets ₦450,000');

-- 3. State machine
select pg_temp.expect_error($$ update deals set state = 'held' where id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'requested -> held (skipping acceptance)');
select set_config('noshen.actor', 'seller', true), set_config('noshen.actor_id', '00000000-0000-0000-0000-00000000000a', true);
update deals set state = 'accepted', payment_due_at = now() + interval '24 hours' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.expect_error($$ update deals set price_kobo = 40000000 where id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'changing the price after acceptance');

-- A second buyer's request is fine, but it cannot also be accepted.
insert into deals (id, listing_id, buyer_id, seller_id, price_kobo, fee_kobo, handover, request_expires_at) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000c',
   '00000000-0000-0000-0000-00000000000a', 45000000, 675000, 'delivery', now() + interval '12 hours');
select pg_temp.expect_error($$ update deals set state = 'accepted' where id = '00000000-0000-0000-0000-0000000000d2' $$,
                            'two accepted deals on one listing');

-- 4. Payment arrives: webhook stored once, ledger posts balanced.
select set_config('noshen.actor', 'partner', true), set_config('noshen.actor_id', '', true);
insert into partner_events (id, partner, event_id, type, payload) values
  ('00000000-0000-0000-0000-0000000000e1', 'testpartner', 'evt_1', 'collection.received', '{}');
select pg_temp.expect_error($$ insert into partner_events (partner, event_id, type, payload)
                               values ('testpartner', 'evt_1', 'collection.received', '{}') $$, 'the same webhook stored twice');
insert into payments (id, deal_id, partner_event_id, amount_kobo, sender_name, matches_amount_due, matches_buyer_name, received_at) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
   45675000, 'CHIOMA OBI', true, true, now());
insert into ledger_transactions (id, deal_id, kind) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000d1', 'payment_received');
insert into ledger_entries (txn_id, account, deal_id, debit_kobo, credit_kobo) values
  ('00000000-0000-0000-0000-000000000101', 'partner_cash', '00000000-0000-0000-0000-0000000000d1', 45675000, 0),
  ('00000000-0000-0000-0000-000000000101', 'held_funds',   '00000000-0000-0000-0000-0000000000d1', 0, 45675000);
update deals set state = 'held', handover_due_at = now() + interval '72 hours' where id = '00000000-0000-0000-0000-0000000000d1';
set constraints ledger_entries_balanced immediate;
set constraints ledger_entries_balanced deferred;
select pg_temp.expect((select ledger_held_kobo = open_deals_kobo and ledger_held_kobo = (select held from baseline) + 45675000 from held_funds_check),
                      'held funds in the ledger equal money paid into open deals');

-- An unbalanced posting is refused when it is checked.
savepoint unbalanced;
insert into ledger_transactions (id, deal_id, kind) values
  ('00000000-0000-0000-0000-000000000199', '00000000-0000-0000-0000-0000000000d1', 'adjustment');
insert into ledger_entries (txn_id, account, debit_kobo) values ('00000000-0000-0000-0000-000000000199', 'partner_cash', 100);
select pg_temp.expect_error($$ set constraints ledger_entries_balanced immediate $$, 'an unbalanced ledger transaction');
rollback to savepoint unbalanced;

-- 5. Review hold blocks release.
update deals set review_hold = true, review_hold_reason = 'payer name differs' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.expect_error($$ update deals set state = 'released' where id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'releasing a deal held for review');
update deals set review_hold = false, review_hold_reason = null where id = '00000000-0000-0000-0000-0000000000d1';

-- 6. Release by code, then payout.
select set_config('noshen.actor', 'seller', true), set_config('noshen.actor_id', '00000000-0000-0000-0000-00000000000a', true);
insert into ledger_transactions (id, deal_id, kind) values
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000d1', 'release');
insert into ledger_entries (txn_id, account, deal_id, debit_kobo, credit_kobo) values
  ('00000000-0000-0000-0000-000000000102', 'held_funds',     '00000000-0000-0000-0000-0000000000d1', 45675000, 0),
  ('00000000-0000-0000-0000-000000000102', 'seller_payable', '00000000-0000-0000-0000-0000000000d1', 0, 45000000),
  ('00000000-0000-0000-0000-000000000102', 'fee_revenue',    '00000000-0000-0000-0000-0000000000d1', 0, 675000);
update deals set state = 'released' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.expect_error($$ update deals set state = 'disputed' where id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'disputing after release (release is final)');
update deals set state = 'paid_out' where id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.expect((select closed_at is not null from deals where id = '00000000-0000-0000-0000-0000000000d1'),
                      'a paid-out deal is closed');
select pg_temp.expect_error($$ update deals set state = 'refunded' where id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'any move out of paid_out');
set constraints ledger_entries_balanced immediate;
set constraints ledger_entries_balanced deferred;

-- 7. Timeline and audit logs
select pg_temp.expect((select array_agg(to_state::text order by id) = '{requested,accepted,held,released,paid_out}'
                         from deal_events where deal_id = '00000000-0000-0000-0000-0000000000d1'),
                      'every state change is on the timeline');
select pg_temp.expect((select actor = 'partner' from deal_events
                        where deal_id = '00000000-0000-0000-0000-0000000000d1' and to_state = 'held'),
                      'the timeline records who moved the deal');
select pg_temp.expect_error($$ delete from deal_events where deal_id = '00000000-0000-0000-0000-0000000000d1' $$,
                            'deleting from the timeline');
select pg_temp.expect_error($$ update ledger_entries set credit_kobo = 1 $$, 'editing the ledger');

-- 8. Disputes need a full decision.
select pg_temp.expect_error($$
  insert into disputes (deal_id, opened_by, reason, state, evidence_due_at, decision_due_at)
  values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000c', 'not_working', 'decided',
          now() + interval '24 hours', now() + interval '72 hours') $$, 'a decided dispute with no decision or reason');

-- 9. Transfers: one live payout per deal.
insert into bank_accounts (id, user_id, bank_code, account_number_enc, account_number_hmac, account_last4, account_name,
                           name_matches_id, is_default, verified_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', '058', '\x01', '\x02', '1234',
   'TUNDE BAKARE', true, true, now());
insert into transfers (deal_id, kind, amount_kobo, bank_account_id, idempotency_key, status) values
  ('00000000-0000-0000-0000-0000000000d1', 'payout', 45000000, '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000d1:payout', 'succeeded');
select pg_temp.expect_error($$
  insert into transfers (deal_id, kind, amount_kobo, bank_account_id, idempotency_key)
  values ('00000000-0000-0000-0000-0000000000d1', 'payout', 45000000, '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000d1:payout:2') $$, 'a second payout for the same deal');

-- Paying with USDT: a USDT payment must say which network and transaction it came in on.
insert into partner_events (id, partner, event_id, type, payload) values
  ('00000000-0000-0000-0000-0000000000e9', 'fake-crypto', 'evt_schema_usdt', 'crypto.received', '{}');
select pg_temp.expect_error($$
  insert into payments (deal_id, partner_event_id, amount_kobo, matches_amount_due, received_at, method)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e9', 1000, true, now(), 'usdt') $$,
  'a USDT payment without its network and transaction');
select pg_temp.expect_error($$
  insert into payments (deal_id, partner_event_id, amount_kobo, matches_amount_due, received_at, method, network, tx_hash, amount_usdt_micro)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e9', 1000, true, now(), 'usdt', 'tron', '0xab', 1) $$,
  'USDT on a network NosHen does not take');

select 'all schema checks passed' as result;

rollback;
