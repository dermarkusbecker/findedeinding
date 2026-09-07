create unique index if not exists participant_progress_user_profile_unique
  on public.participant_progress(user_profile_id);

create or replace function public.program_week_is_released(
  participant_id uuid,
  target_week integer
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_week <= 0 then true
    else coalesce(
      (
        select progress.privacy_consent_at is not null
          and progress.start_commitment_at is not null
          and (now() at time zone 'Europe/Berlin')::date
            >= progress.program_start_date + ((target_week - 1) * 7)
        from public.participant_progress as progress
        where progress.user_profile_id = participant_id
        limit 1
      ),
      false
    )
  end;
$$;

create or replace function public.enforce_program_week_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_week integer;
begin
  if tg_table_name = 'participant_memory' then
    target_week := new.source_week;
  else
    target_week := new.week;
  end if;

  if tg_table_name = 'week_gates' then
    if new.completed_at is null then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.completed_at is not null then
      return new;
    end if;
  end if;

  if not public.program_week_is_released(new.user_profile_id, target_week) then
    raise exception 'Programm-Woche % ist für diesen Teilnehmer noch nicht freigeschaltet.', target_week
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_week_gate_release_before_write on public.week_gates;
create trigger enforce_week_gate_release_before_write
before insert or update of completed_at on public.week_gates
for each row execute function public.enforce_program_week_write();

drop trigger if exists enforce_process_entry_release_before_insert on public.process_entries;
create trigger enforce_process_entry_release_before_insert
before insert on public.process_entries
for each row execute function public.enforce_program_week_write();

drop trigger if exists enforce_document_release_before_insert on public.participant_documents;
create trigger enforce_document_release_before_insert
before insert on public.participant_documents
for each row execute function public.enforce_program_week_write();

drop trigger if exists enforce_question_release_before_insert on public.customer_questions;
create trigger enforce_question_release_before_insert
before insert on public.customer_questions
for each row execute function public.enforce_program_week_write();

do $$
begin
  if to_regclass('public.clara_messages') is not null then
    execute 'drop trigger if exists enforce_clara_message_release_before_insert on public.clara_messages';
    execute 'create trigger enforce_clara_message_release_before_insert before insert on public.clara_messages for each row execute function public.enforce_program_week_write()';
  end if;
  if to_regclass('public.participant_memory') is not null then
    execute 'drop trigger if exists enforce_participant_memory_release_before_insert on public.participant_memory';
    execute 'create trigger enforce_participant_memory_release_before_insert before insert on public.participant_memory for each row execute function public.enforce_program_week_write()';
  end if;
end;
$$;

comment on function public.program_week_is_released(uuid, integer) is
  'Einzige Datenbankregel für zeitbasierte Wochenfreigaben im Acht-Wochen-Programm.';

revoke execute on function public.program_week_is_released(uuid, integer) from public, anon, authenticated;
revoke execute on function public.enforce_program_week_write() from public, anon, authenticated;
