create table if not exists public.customer_clarity_analyses (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null unique references public.user_profiles(id) on delete cascade,
  source_fingerprint text not null,
  analysis jsonb not null default '{}'::jsonb,
  generator text not null default 'grounded_fallback',
  model text,
  version text not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_clarity_analyses_generated_idx
  on public.customer_clarity_analyses(generated_at desc);

alter table public.customer_clarity_analyses enable row level security;

comment on table public.customer_clarity_analyses is
  'Interne, beleggebundene Gesprächsvorbereitung aus den freigegebenen Daten des Acht-Wochen-Prozesses.';
