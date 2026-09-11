-- One transaction for the check-in, its state snapshot and any follow-up task.
create or replace function public.save_weekly_clarity(
  p_participant_id uuid, p_week integer, p_score integer, p_note text,
  p_initial_state jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_saved jsonb;
  v_previous integer;
  v_key text;
  v_checkin_key text;
  v_note text := left(trim(coalesce(p_note, '')), 3000);
  v_lead_id uuid;
  v_name text;
  v_task_id uuid;
  v_details text;
begin
  if p_week is null or p_week not between 1 and 8 or p_score is null or p_score not between 1 and 10 then
    raise exception 'Bitte wähle eine gültige Woche und einen Klarheitswert zwischen 1 und 10.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_participant_id::text, 0));
  if not public.program_week_is_released(p_participant_id, p_week) then
    raise exception 'Diese Programm-Woche ist noch nicht freigeschaltet.' using errcode = '23514';
  end if;
  v_key := 'week_' || p_week;
  v_checkin_key := case when p_week = 1 then 'clarity_baseline' else 'clarity_checkin' end;
  select structured_data -> v_key into v_state from public.process_entries
    where user_profile_id = p_participant_id and week = p_week and data_block = v_key || '_state'
    order by created_at desc, id desc limit 1;
  v_saved := v_state -> v_checkin_key;
  if coalesce((v_saved ->> 'completed')::boolean, false) then
    if (v_saved ->> 'score')::integer is distinct from p_score then
      raise exception 'Für diese Woche wurde bereits ein anderer Klarheitswert gespeichert. Bitte lade die Seite neu.';
    end if;
    return jsonb_build_object('state', v_state, 'alreadySaved', true);
  end if;
  if v_state is null then v_state := p_initial_state; end if;
  if v_state is null or jsonb_typeof(v_state) <> 'object' then raise exception 'Der Wochenstand fehlt.'; end if;
  select score into v_previous from (
    select distinct on (week) week,
      case when week = 1 then (structured_data -> 'week_1' -> 'clarity_baseline' ->> 'score')::integer
        else (structured_data -> ('week_' || week) -> 'clarity_checkin' ->> 'score')::integer end as score
    from public.process_entries where user_profile_id = p_participant_id and week between 1 and p_week - 1
      and data_block = 'week_' || week || '_state'
    order by week, created_at desc, id desc
  ) history where score between 1 and 10 order by week desc limit 1;
  if p_score < v_previous and v_note = '' then
    raise exception 'Was glaubst du, warum deine Klarheit gerade niedriger ist? Auch „Ich weiß es noch nicht“ ist eine ehrliche Antwort.';
  end if;
  v_state := jsonb_set(v_state, array[v_checkin_key], case when p_week = 1 then
    jsonb_build_object('score', p_score, 'reason_raw', v_note, 'completed', true)
    else jsonb_build_object('score', p_score, 'note', v_note, 'changed', p_score is distinct from v_previous, 'completed', true, 'recorded_at', now()) end);
  v_state := jsonb_set(v_state, '{updated_at}', to_jsonb(now()));
  if p_week = 1 and v_state ->> 'current_step' = 'CLARITY_BASELINE' then
    v_state := jsonb_set(v_state, '{current_step}', '"CAREER_HISTORY"'::jsonb);
  end if;
  insert into public.process_entries(user_profile_id, week, data_block, raw_answer, structured_data, evidence_level)
    values (p_participant_id, p_week, v_key || '_state', p_score || '/10', jsonb_build_object(v_key, v_state), 'participant_statement');
  if p_score < v_previous then
    select name, source_lead_id into v_name, v_lead_id from public.user_profiles where id = p_participant_id;
    if v_lead_id is null then
      select id into v_lead_id from public.leads where converted_user_profile_id = p_participant_id limit 1;
    end if;
    v_details := 'Woche ' || p_week || ': Klarheit von ' || v_previous || ' auf ' || p_score || '/10. Einschätzung des Kunden: ' || v_note || E'\nBitte persönlich nachfragen und die nächsten Schritte gemeinsam klären.';
    if v_lead_id is not null then
      insert into public.lead_tasks(lead_id, title, details, due_at, task_type)
        values(v_lead_id, 'Markus: Klarheitsrückgang besprechen · ' || coalesce(v_name, 'Kunde'), v_details, current_date, 'clarity_decline') returning id into v_task_id;
    else
      -- Directly created customers have no lead. Their follow-up appears in
      -- the same admin attention list through the existing customer queue.
      insert into public.customer_questions(user_profile_id, week, question)
        values(p_participant_id, p_week, '[Klarheits-Nachgespräch für Markus] ' || v_details) returning id into v_task_id;
    end if;
  end if;
  update public.participant_progress set last_activity_at = now() where user_profile_id = p_participant_id;
  return jsonb_build_object('state', v_state, 'alreadySaved', false, 'followUpId', v_task_id);
end;
$$;
revoke all on function public.save_weekly_clarity(uuid, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_weekly_clarity(uuid, integer, integer, text, jsonb) to service_role;
