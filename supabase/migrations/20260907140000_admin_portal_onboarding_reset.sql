alter table public.participant_progress
  add column if not exists onboarding_reset_at timestamptz,
  add column if not exists onboarding_reset_by_profile_id uuid references public.user_profiles(id) on delete set null;

comment on column public.participant_progress.onboarding_reset_at is
  'Letzter administrativer Neustart des Kunden-Onboardings; ältere Onboarding-Dokumente bleiben archiviert, zählen aber nicht für den Neustart.';

comment on column public.participant_progress.onboarding_reset_by_profile_id is
  'Aktives Adminprofil, das den letzten Onboarding-Neustart ausgelöst hat.';
