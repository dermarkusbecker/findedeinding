create table if not exists public.participant_form_drafts (
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  form_key text not null check (form_key in ('privacy_consent','start_commitment')),
  draft_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_profile_id, form_key)
);

alter table public.participant_form_drafts enable row level security;

comment on table public.participant_form_drafts is
  'Serverseitig zwischengespeicherte Onboarding-Formulare; Entwürfe stellen keine rechtliche Bestätigung dar.';
