-- When a payment is held for review, the buyer can say who paid (someone they know, their own account under another
-- name, or they don't know), with a short note. The reviewer sees it on the hold before deciding.
alter table deals
  add column hold_payer        text check (hold_payer in ('someone_i_know', 'my_other_account', 'unknown')),
  add column hold_note         text check (hold_note is null or length(hold_note) <= 500),
  add column hold_explained_at timestamptz;
