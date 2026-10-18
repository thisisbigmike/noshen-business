-- People who want NosHen in their country before it opens there (Ghana, Kenya, South Africa). One row per email and
-- country; asking twice changes nothing. Staff see the counts on the dashboard.
create table waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (length(email) between 3 and 254),
  country    text not null check (country in ('GH', 'KE', 'ZA')),
  lang       text check (lang in ('en', 'pcm')),
  created_at timestamptz not null default now(),
  unique (email, country)
);
