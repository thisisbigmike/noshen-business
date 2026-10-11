-- NosHen covers all of Nigeria, not just Lagos. Every listing now has a state (one of the 36 states or the
-- FCT) as well as its area (a town or neighbourhood), and a country: Nigeria only for now, more coming soon.
-- Existing listings were all in Lagos. A draft may not have a state yet; a published listing must.

alter table listings add column state text;
update listings set state = 'Lagos';
alter table listings add constraint listings_state_known check (state is null or state in ('Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'));
alter table listings add constraint listings_state_when_published check (status = 'draft' or (state is not null and length(btrim(area)) >= 2));

alter table listings add column country text not null default 'NG' check (country in ('NG'));

drop index if exists listings_browse;
create index listings_browse on listings (state, category, published_at desc) where status = 'live';
