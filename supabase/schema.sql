-- Sistema SER - schema para storage no Supabase

create extension if not exists pgcrypto;

create table if not exists public.ser_tasks (
  id text primary key,
  title text not null,
  detail text,
  frente text not null,
  type text not null,
  date date not null,
  start_time time,
  estimated_time integer not null default 30,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  follow_up_daily boolean not null default false,
  follow_up_time time,
  follow_up_client text,
  follow_up_subject text,
  source text not null default 'app'
);

create index if not exists ser_tasks_date_idx on public.ser_tasks (date);
create index if not exists ser_tasks_frente_idx on public.ser_tasks (frente);
create index if not exists ser_tasks_completed_idx on public.ser_tasks (completed_at);
create index if not exists ser_tasks_updated_idx on public.ser_tasks (updated_at desc);
alter table public.ser_tasks add column if not exists actual_time integer not null default 0;
alter table public.ser_tasks add column if not exists pomodoros_completed integer not null default 0;

create table if not exists public.ser_usage_events (
  id text primary key,
  ts timestamptz not null default now(),
  source text,
  endpoint text,
  usage_kind text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  audio_minutes numeric(12,6) not null default 0,
  usd numeric(12,6) not null default 0,
  mime_type text,
  duration_seconds numeric(12,3) not null default 0,
  metadata jsonb
);

create index if not exists ser_usage_events_ts_idx on public.ser_usage_events (ts desc);
create index if not exists ser_usage_events_kind_idx on public.ser_usage_events (usage_kind);

create table if not exists public.ser_energy_checkins (
  id text primary key default gen_random_uuid()::text,
  date text not null,
  time text not null,
  energy_level text not null,
  mood text,
  note text,
  source text default 'whatsapp',
  created_at timestamptz default now()
);

create index if not exists ser_energy_checkins_date_idx on public.ser_energy_checkins (date desc);

create table if not exists public.ser_time_logs (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references public.ser_tasks(id) on delete cascade,
  date text not null,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_minutes integer,
  type text default 'pomodoro',
  completed boolean default false,
  created_at timestamptz default now()
);

create index if not exists ser_time_logs_task_idx on public.ser_time_logs (task_id);
create index if not exists ser_time_logs_date_idx on public.ser_time_logs (date desc);

create table if not exists public.ser_gamification (
  id text primary key default 'sergio',
  xp integer default 0,
  level integer default 1,
  current_streak integer default 0,
  best_streak integer default 0,
  last_active_date text,
  streak_freezes_remaining integer default 1,
  badges jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.ser_xp_events (
  id text primary key default gen_random_uuid()::text,
  event_type text not null,
  xp_amount integer not null,
  description text,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists ser_xp_events_created_idx on public.ser_xp_events (created_at desc);
create index if not exists ser_xp_events_type_idx on public.ser_xp_events (event_type);

alter table public.ser_tasks disable row level security;
alter table public.ser_usage_events disable row level security;
alter table public.ser_energy_checkins disable row level security;
alter table public.ser_time_logs disable row level security;
alter table public.ser_gamification disable row level security;
alter table public.ser_xp_events disable row level security;
