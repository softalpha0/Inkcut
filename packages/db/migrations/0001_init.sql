-- Inkcut v1 schema (spec §6). Run in the Supabase SQL editor or with `supabase db push`.
-- Additions to the spec: projects.minutes / audio_path / animate, scenes.video_path,
-- statuses transcribing / animating / expired, and bump_usage() for atomic daily limits.

create extension if not exists pgcrypto;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── projects ────────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled video',
  input_mode text not null check (input_mode in ('topic', 'script', 'audio')),
  topic text,
  script text,
  minutes int check (minutes between 1 and 5),
  audio_path text,
  style_id text not null default 'stickman-classic',
  aspect text not null default '16:9' check (aspect in ('16:9', '9:16')),
  voice_id text not null default 'en-US-GuyNeural',
  captions boolean not null default true,
  animate boolean not null default false,
  status text not null default 'draft' check (status in (
    'draft', 'queued', 'scripting', 'transcribing', 'planning', 'voicing',
    'drawing', 'animating', 'rendering', 'done', 'failed', 'expired')),
  current_stage text,
  error text,
  output_path text,
  output_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_created on public.projects (user_id, created_at desc);
create index if not exists projects_expiry on public.projects (output_expires_at) where status <> 'expired';

-- ── scenes ──────────────────────────────────────────────────────────────────
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  index int not null check (index >= 0),
  narration text not null,
  visual text not null default '',
  image_prompt text not null,
  motion text not null default 'static',
  duration_sec numeric,
  audio_path text,
  image_path text,
  video_path text,
  updated_at timestamptz not null default now(),
  unique (project_id, index)
);

-- ── usage_daily ─────────────────────────────────────────────────────────────
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  videos_started int not null default 0,
  redraws int not null default 0,
  primary key (user_id, day)
);

-- updated_at bookkeeping
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
drop trigger if exists scenes_touch on public.scenes;
create trigger scenes_touch before update on public.scenes
  for each row execute function public.touch_updated_at();

-- ── atomic daily limits ─────────────────────────────────────────────────────
-- Increments today's (UTC) counter if it is below p_limit. Returns the new count,
-- or -1 when the limit is already reached. Called by the API with the service role.
create or replace function public.bump_usage(p_user uuid, p_kind text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_kind not in ('videos_started', 'redraws') then
    raise exception 'unknown usage kind %', p_kind;
  end if;
  insert into public.usage_daily (user_id, day) values (p_user, v_day)
    on conflict (user_id, day) do nothing;
  if p_kind = 'videos_started' then
    update public.usage_daily set videos_started = videos_started + 1
      where user_id = p_user and day = v_day and videos_started < p_limit
      returning videos_started into v_count;
  else
    update public.usage_daily set redraws = redraws + 1
      where user_id = p_user and day = v_day and redraws < p_limit
      returning redraws into v_count;
  end if;
  return coalesce(v_count, -1);
end;
$$;

revoke all on function public.bump_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, text, int) to service_role;

-- ── row level security: users see only their own rows ──────────────────────
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.scenes enable row level security;
alter table public.usage_daily enable row level security;

drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "projects: own read" on public.projects;
create policy "projects: own read" on public.projects
  for select using (auth.uid() = user_id);
drop policy if exists "projects: own insert" on public.projects;
create policy "projects: own insert" on public.projects
  for insert with check (auth.uid() = user_id);
drop policy if exists "projects: own update" on public.projects;
create policy "projects: own update" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "projects: own delete" on public.projects;
create policy "projects: own delete" on public.projects
  for delete using (auth.uid() = user_id);

drop policy if exists "scenes: own read" on public.scenes;
create policy "scenes: own read" on public.scenes
  for select using (exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));
drop policy if exists "scenes: own update" on public.scenes;
create policy "scenes: own update" on public.scenes
  for update using (exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists "usage: own read" on public.usage_daily;
create policy "usage: own read" on public.usage_daily
  for select using (auth.uid() = user_id);

-- ── storage: private buckets; all access goes through signed URLs ─────────
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false), ('assets', 'assets', false), ('outputs', 'outputs', false)
on conflict (id) do nothing;

-- ── realtime: the progress screen listens to project and scene changes ─────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.projects;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.scenes;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
