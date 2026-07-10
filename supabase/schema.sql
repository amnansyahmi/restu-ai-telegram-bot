-- Run this entire file once in Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists weddings (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id bigint unique not null,
  owner_name text,
  role text check (role in ('bride','groom','family')),
  partner_name text,
  wedding_date date,
  location text,
  budget numeric(12,2) default 0,
  guest_count integer default 0,
  event_type text default 'Nikah + Resepsi',
  onboarding_step text default 'role',
  reminders_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists collaborators (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings(id) on delete cascade not null,
  telegram_id bigint,
  role text default 'collaborator',
  invite_code text unique not null,
  accepted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings(id) on delete cascade not null,
  title text not null,
  category text not null,
  due_date date,
  status text default 'not_started' check (status in ('not_started','in_progress','completed','need_review')),
  assigned_telegram_id bigint,
  reminder_sent_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists budget_items (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings(id) on delete cascade not null,
  category text not null,
  allocated numeric(12,2) default 0,
  spent numeric(12,2) default 0,
  unique(wedding_id, category)
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  location text,
  price_from numeric(12,2),
  completion_score integer default 0,
  description text,
  contact_url text,
  active boolean default true
);

create table if not exists saved_vendors (
  wedding_id uuid references weddings(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete cascade,
  created_at timestamptz default now(),
  primary key(wedding_id, vendor_id)
);
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings(id) on delete cascade not null,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  created_at timestamptz default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references weddings(id) on delete cascade not null,
  name text not null,
  rsvp text default 'pending' check (rsvp in ('pending','yes','no')),
  pax integer default 1,
  created_at timestamptz default now()
);

-- Idempotent migrations: bring databases created by an older schema up to date.
-- Safe to run repeatedly; "add column if not exists" is a no-op when present.
alter table weddings add column if not exists reminders_enabled boolean default true;
alter table tasks add column if not exists assigned_telegram_id bigint;
alter table tasks add column if not exists reminder_sent_at timestamptz;
alter table saved_vendors add column if not exists compare_selected boolean default false;
alter table weddings add column if not exists card_venue text;
alter table weddings add column if not exists card_time text;
alter table weddings add column if not exists card_hosts text;
alter table weddings add column if not exists card_message text;

create index if not exists tasks_wedding_idx on tasks(wedding_id);
create index if not exists chat_wedding_idx on chat_messages(wedding_id, created_at);
create index if not exists guests_wedding_idx on guests(wedding_id);

-- The server uses the service-role key. Never expose that key in the Mini App.
alter table weddings enable row level security;
alter table collaborators enable row level security;
alter table tasks enable row level security;
alter table budget_items enable row level security;
alter table saved_vendors enable row level security;
alter table chat_messages enable row level security;
alter table guests enable row level security;

insert into vendors (name, category, location, price_from, completion_score, description)
select * from (values
  ('Selera Kampung Catering','Katering','Shah Alam',28,88,'Pakej katering Melayu untuk majlis besar.'),
  ('Dapur Mak Long','Katering','Klang',25,76,'Pilihan bajet dengan menu tradisional.'),
  ('Aroma Santan Events','Katering','Petaling Jaya',32,69,'Katering dan koordinasi majlis.'),
  ('Laman Seri Venue','Venue','Shah Alam',18000,84,'Dewan, pelamin dan sistem PA.'),
  ('Cerita Kita Studio','Fotografi','Selangor',3500,82,'Fotografi dan videografi perkahwinan.')
) as seed(name,category,location,price_from,completion_score,description)
where not exists (select 1 from vendors);
