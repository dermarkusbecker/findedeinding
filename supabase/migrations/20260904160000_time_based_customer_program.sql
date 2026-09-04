alter table public.participant_progress
  alter column access_mode set default 'time_based';

update public.participant_progress
set access_mode = 'time_based',
    updated_at = now()
where access_mode = 'completion_based';

comment on column public.participant_progress.program_start_date is 'Individueller Projektstart; Woche N beginnt jeweils (N-1) mal sieben Tage später.';
comment on column public.participant_progress.access_mode is 'Zeitbasiert ist der Standard für das persönliche Acht-Wochen-Programm; Admin-Overrides bleiben möglich.';
