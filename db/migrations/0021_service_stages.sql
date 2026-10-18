-- Escrow for services, paid in stages. A services listing names up to 4 stages and what share of the price each is
-- ("Work starts" 30%, "Work finished" 70%). The buyer pays the whole price into the deal as usual; each stage is then
-- released on its own: the seller marks it done, and the buyer releases it (or it's released by itself a few days
-- after it was marked done, if they say nothing). Each release pays the seller that stage's share. A dispute freezes
-- what's still held, and a refund returns only that: what's been released stays released.

alter table listings add column stages jsonb check (stages is null or jsonb_typeof(stages) = 'array');

alter table deals add column kind text not null default 'goods' check (kind in ('goods', 'service'));

create table deal_stages (
  deal_id        uuid not null references deals (id),
  n              smallint not null check (n between 1 and 4),
  title          text not null check (length(title) between 2 and 60),
  share_kobo     bigint not null check (share_kobo >= 0),  -- what the seller gets for this stage
  fee_kobo       bigint not null check (fee_kobo >= 0),    -- this stage's part of NosHen's fee
  done_at        timestamptz,                               -- the seller says it's done
  release_due_at timestamptz,                               -- released by itself then, if the buyer says nothing
  released_at    timestamptz,
  released_by    text check (released_by in ('buyer', 'timer', 'reviewer', 'staff')),
  primary key (deal_id, n),
  check ((released_at is null) = (released_by is null)),
  check (release_due_at is null or done_at is not null)
);

-- A stage's amounts are terms: fixed. Once released it stays released.
create function deal_stages_guard() returns trigger language plpgsql as $$
begin
  if (new.deal_id, new.n, new.share_kobo, new.fee_kobo, new.title) is distinct from (old.deal_id, old.n, old.share_kobo, old.fee_kobo, old.title) then
    raise exception 'deal %: stage % terms cannot change', old.deal_id, old.n using errcode = 'check_violation';
  end if;
  if old.released_at is not null and new.released_at is distinct from old.released_at then
    raise exception 'deal %: stage % is already released', old.deal_id, old.n using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger deal_stages_guard before update on deal_stages for each row execute function deal_stages_guard();
create trigger deal_stages_no_delete before delete on deal_stages for each row execute function forbid_change();

-- Payouts: one per deal, or one per stage of a service.
alter table transfers add column stage smallint check (stage between 1 and 4);
drop index transfers_one_payout_per_deal;
create unique index transfers_one_payout_per_deal on transfers (deal_id, coalesce(stage, 0)) where kind = 'payout' and status <> 'failed';

-- Money held: the ledger against payments into open deals, less any stages already released from them.
create or replace view held_funds_check as
select
  (select coalesce(sum(credit_kobo - debit_kobo), 0) from ledger_entries where account = 'held_funds') as ledger_held_kobo,
  (select coalesce(sum(p.amount_kobo), 0)
     from payments p join deals d on d.id = p.deal_id
    where d.state in ('held', 'disputed') and not p.sent_back)
  - (select coalesce(sum(s.share_kobo + s.fee_kobo), 0)
       from deal_stages s join deals d on d.id = s.deal_id
      where d.state in ('held', 'disputed') and s.released_at is not null)                      as open_deals_kobo;

-- How long a buyer has to release a stage the seller marked done, before it's released by itself.
insert into settings (key, value) values ('stage_confirm_hours', '72') on conflict (key) do nothing;
