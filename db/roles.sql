-- What each site's database login may do. Run by `pnpm db:roles` (and again by `pnpm db:migrate`) as the
-- database owner, after the logins exist. Safe to run again. Migrations and scripts keep using the owner.
--
--   noshen_web    the customer site (apps/web)
--   noshen_admin  the staff site (apps/admin)
--
-- The customer site can't read or change staff accounts, staff passwords, staff sessions, two-factor keys
-- or the staff audit log, and can only read settings. A bug or injected query there can't reach them.

grant usage on schema public to noshen_web, noshen_admin;

-- The staff site runs every engine action (disputes, refunds, payouts, moderation), so it gets all tables.
grant select, insert, update, delete on all tables in schema public to noshen_admin;
grant usage, select on all sequences in schema public to noshen_admin;

-- The customer site: all tables, then the staff ones taken away.
grant select, insert, update, delete on all tables in schema public to noshen_web;
grant usage, select on all sequences in schema public to noshen_web;
revoke all on staff, staff_actions, "twoFactor" from noshen_web;
-- Only this column, to refuse a staff account a session on the customer site.
grant select (auth_user_id) on staff to noshen_web;
revoke insert, update, delete on settings from noshen_web;

-- New tables from future migrations: both logins get them; `pnpm db:migrate` re-runs this file afterwards.
alter default privileges in schema public grant select, insert, update, delete on tables to noshen_web, noshen_admin;
alter default privileges in schema public grant usage, select on sequences to noshen_web, noshen_admin;

-- Row by row: staff password logins and staff sessions are invisible to the customer site.
-- (Row-level security doesn't apply to the owner, so migrations, scripts and tests are unaffected.)
alter table account enable row level security;
drop policy if exists customer_site_accounts on account;
create policy customer_site_accounts on account to noshen_web
  using ("providerId" <> 'credential') with check ("providerId" <> 'credential');
drop policy if exists staff_site_accounts on account;
create policy staff_site_accounts on account to noshen_admin using (true) with check (true);

alter table "session" enable row level security;
drop policy if exists customer_site_sessions on "session";
create policy customer_site_sessions on "session" to noshen_web
  using (not exists (select 1 from staff s where s.auth_user_id = "session"."userId"))
  with check (not exists (select 1 from staff s where s.auth_user_id = "session"."userId"));
drop policy if exists staff_site_sessions on "session";
create policy staff_site_sessions on "session" to noshen_admin using (true) with check (true);
