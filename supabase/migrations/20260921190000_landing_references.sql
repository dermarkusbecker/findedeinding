create table if not exists public.landing_references (
  id text primary key default 'default' check (id = 'default'),
  enabled boolean not null default false,
  videos jsonb not null default '[]'::jsonb check (jsonb_typeof(videos) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles(id) on delete set null,
  check (not enabled or jsonb_array_length(videos) > 0)
);

alter table public.landing_references enable row level security;
revoke all on public.landing_references from anon, authenticated;
grant all on public.landing_references to service_role;
insert into public.landing_references (id) values ('default') on conflict (id) do nothing;
comment on table public.landing_references is 'YouTube-Referenzen: öffentliche Ausgabe ausschließlich bei Aktivierung; Pflege über CRM-Einstellungen.';
