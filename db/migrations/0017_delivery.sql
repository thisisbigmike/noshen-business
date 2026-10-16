-- Delivery prices and packing proof.
--
-- The seller sets what delivery costs on the listing: within the item's state, and to other states (null: not
-- offered, 0: free). The buyer picks their state; the fee for that zone is fixed on the deal, paid in with the
-- price, held with it, and released to the seller with it (they pay the courier). A refund returns it too.
-- NosHen's fee is on the price only.
--
-- Before marking a delivery sent, the seller adds photos of the item being packed and the sealed package, who is
-- delivering it, and (to another state) the tracking or waybill number: evidence if the buyer says something else
-- arrived, and what the buyer follows while it's on the way.

alter table listings
  add column delivery_local_kobo bigint check (delivery_local_kobo between 0 and 50000000),
  add column delivery_other_kobo bigint check (delivery_other_kobo between 0 and 50000000);

alter table deals
  add column delivery_kobo      bigint not null default 0 check (delivery_kobo between 0 and 50000000),
  add column delivery_state     text check (delivery_state is null or delivery_state in ('Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara')),
  add column sent_at            timestamptz,
  add column courier            text check (length(courier) between 2 and 60),
  add column tracking_ref       text check (length(tracking_ref) between 1 and 60),
  add column packing_photo_keys text[] not null default '{}';

-- Deals marked delivered before this change count as sent at the same moment.
update deals set sent_at = delivered_at where delivered_at is not null and sent_at is null;

alter table deals
  add constraint deals_delivery_fields check (handover = 'delivery' or (delivery_kobo = 0 and delivery_state is null and sent_at is null)),
  add constraint deals_delivered_after_sent check (delivered_at is null or sent_at is not null);

-- What the buyer pays in, and what the seller gets on release, now include delivery.
alter table deals alter column amount_due_kobo set expression as
  ((case when fee_payer = 'buyer' then price_kobo + fee_kobo else price_kobo end) + delivery_kobo);
alter table deals alter column seller_share_kobo set expression as
  ((case when fee_payer = 'seller' then price_kobo - fee_kobo else price_kobo end) + delivery_kobo);

-- The delivery fee and where it goes are terms too: fixed once the seller accepts.
create or replace function deals_guard() returns trigger language plpgsql as $$
begin
  if new.state is distinct from old.state then
    if (old.state::text || '>' || new.state::text) not in (
         'requested>accepted', 'requested>declined',
         'accepted>held',      'accepted>declined',
         'held>released',      'held>refunded',     'held>disputed',
         'disputed>refunded',  'disputed>released',
         'released>paid_out') then
      raise exception 'deal %: % -> % is not an allowed move', old.id, old.state, new.state
        using errcode = 'check_violation';
    end if;
    if new.state = 'released' and old.review_hold then
      raise exception 'deal % is held for review and cannot be released', old.id using errcode = 'check_violation';
    end if;
    new.state_changed_at := now();
    if new.state in ('paid_out', 'refunded', 'declined') then
      new.closed_at := now();
    end if;
  end if;
  -- Terms are fixed once the seller accepts.
  if old.state <> 'requested' and (new.price_kobo, new.fee_kobo, new.fee_payer, new.buyer_id, new.seller_id, new.listing_id, new.handover, new.delivery_kobo, new.delivery_state)
     is distinct from (old.price_kobo, old.fee_kobo, old.fee_payer, old.buyer_id, old.seller_id, old.listing_id, old.handover, old.delivery_kobo, old.delivery_state) then
    raise exception 'deal %: terms cannot change after acceptance', old.id using errcode = 'check_violation';
  end if;
  -- What was sent, and the proof, can't be changed or taken back once given.
  if old.sent_at is not null and (new.sent_at, new.courier, new.tracking_ref, new.packing_photo_keys)
     is distinct from (old.sent_at, old.courier, old.tracking_ref, old.packing_photo_keys) then
    raise exception 'deal %: what was sent cannot change once it is marked sent', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- How long a delivery may be on its way before both people are asked whether it has arrived, by zone.
insert into settings (key, value) values ('delivery_transit_hours', '{"local": 48, "other": 120}') on conflict (key) do nothing;
