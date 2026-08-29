-- FDD CRM: serverseitige Buchungszeiten und freie Google-Calendar-Slots
-- Einmal vollständig im Supabase SQL Editor ausführen.

create table if not exists public.booking_settings (
  id text primary key default 'default' check (id = 'default'),
  timezone text not null default 'Europe/Berlin',
  weekly_availability jsonb not null default '{"0":[],"1":[],"2":[],"3":[],"4":[],"5":[],"6":[]}'::jsonb,
  slot_interval_minutes integer not null default 15 check (slot_interval_minutes in (15, 30)),
  default_duration_minutes integer not null default 45 check (default_duration_minutes in (30, 45, 60, 90)),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 168),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 7 and 180),
  updated_at timestamptz not null default now()
);

insert into public.booking_settings (id) values ('default') on conflict (id) do nothing;
alter table public.booking_settings enable row level security;
