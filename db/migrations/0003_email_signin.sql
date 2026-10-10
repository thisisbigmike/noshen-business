-- 0003: buyers and sellers sign in with an email code or Google instead of a phone number.
-- Phone numbers become optional (to be collected later for SMS updates); updates go by email and in the app.

begin;

alter table users alter column phone drop not null;
alter table users add column email text unique check (email is null or email = lower(email));
alter table users add constraint users_contact check (email is not null or phone is not null);

alter type notification_channel add value if not exists 'email';

commit;
