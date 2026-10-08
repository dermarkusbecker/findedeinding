create table if not exists public.milestone_reports (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  milestone_week integer not null check (milestone_week in (4, 8)),
  process_version integer not null default 0,
  report jsonb not null,
  generator text not null,
  model text,
  version text not null,
  generated_at timestamptz not null default now(),
  unique (user_profile_id, milestone_week, process_version)
);

create index if not exists milestone_reports_user_idx on public.milestone_reports (user_profile_id, milestone_week);
alter table public.milestone_reports enable row level security;
comment on table public.milestone_reports is 'Private, evidence-based customer reports after weeks 4 and 8. Access is via authenticated server routes.';
