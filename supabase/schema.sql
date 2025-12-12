-- Create ENUMs
create type idea_status as enum ('draft', 'pending_approval', 'approved', 'rejected');
create type script_status as enum ('draft', 'finalized');

-- Create categories table
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- Create ideas table
create table ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status idea_status default 'draft',
  category_id uuid references categories(id),
  linear_issue_id text,
  linear_issue_url text,
  ai_metadata jsonb,
  thumbnail_url text,
  created_at timestamptz default now(),
  user_id uuid references auth.users(id)
);

-- Create scripts table
create table scripts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references ideas(id) not null,
  content text,
  seo_title text,
  seo_description text,
  hashtags text[],
  estimated_duration int,
  status script_status default 'draft',
  version int default 1,
  created_at timestamptz default now()
);

-- Enable RLS (Security)
alter table categories enable row level security;
alter table ideas enable row level security;
alter table scripts enable row level security;

-- Policies (Basic)
create policy "Public categories" on categories for select using (true);
create policy "Authenticated users insert categories" on categories for insert with check (auth.role() = 'authenticated');
create policy "Users manage their own ideas" on ideas using (auth.uid() = user_id);
create policy "Users manage their own scripts" on scripts using (
  exists (select 1 from ideas where ideas.id = scripts.idea_id and ideas.user_id = auth.uid())
);

-- Seed Categories
insert into categories (name, slug) values
('Software', 'software'),
('Hardware', 'hardware'),
('IA', 'ia'),
('Ciberseguridad', 'ciberseguridad'),
('Salud', 'salud'),
('Nutricion', 'nutricion'),
('Technology', 'tech'),
('Life Hacks', 'life-hacks'),
('Business', 'business')
on conflict do nothing;
