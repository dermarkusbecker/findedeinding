update public.participant_progress
set access_mode = 'time_based',
    manually_unlocked_weeks = '{}'::integer[],
    manually_locked_weeks = '{}'::integer[],
    updated_at = now()
where access_mode is distinct from 'time_based'
   or cardinality(manually_unlocked_weeks) > 0
   or cardinality(manually_locked_weeks) > 0;

alter table public.participant_progress
  alter column access_mode set default 'time_based';

alter table public.participant_progress
  drop constraint if exists participant_progress_access_mode_check;

alter table public.participant_progress
  add constraint participant_progress_access_mode_check
  check (access_mode = 'time_based');

comment on column public.participant_progress.access_mode is 'Fester zeitbasierter Acht-Wochen-Ablauf: Woche N öffnet sich automatisch (N-1) mal sieben Tage nach dem Projektstart.';
comment on column public.participant_progress.manually_unlocked_weeks is 'Legacy-Feld; manuelle Freischaltungen sind im festen zeitbasierten Ablauf deaktiviert.';
comment on column public.participant_progress.manually_locked_weeks is 'Legacy-Feld; manuelle Sperren sind im festen zeitbasierten Ablauf deaktiviert.';
