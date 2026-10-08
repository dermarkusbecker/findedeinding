alter table public.participant_progress
  add column if not exists manual_unlock_dates jsonb not null default '{}'::jsonb;

comment on column public.participant_progress.manually_unlocked_weeks is
  'Zusätzliche vom Admin freigeschaltete Programmwochen; der automatische Zeitplan bleibt bestehen.';
comment on column public.participant_progress.manual_unlock_dates is
  'Erstes Freigabedatum je manuell freigeschalteter Woche in Europe/Berlin.';
