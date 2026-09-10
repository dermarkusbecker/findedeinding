alter table public.lead_tasks
  add column if not exists task_type text not null default 'manual';

create index if not exists lead_tasks_follow_up_idx
  on public.lead_tasks(lead_id, task_type, completed, due_at);

create or replace function public.set_lead_interest_status(
  p_lead_id uuid,
  p_status text,
  p_follow_up_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
  v_task public.lead_tasks%rowtype;
begin
  if p_status not in ('lost', 'later') then
    raise exception 'Ungültiger Interessenstatus.' using errcode = '22023';
  end if;
  if p_status = 'later' and (p_follow_up_date is null or p_follow_up_date < current_date) then
    raise exception 'Für späteres Interesse ist ein heutiges oder zukünftiges Wiedervorlagedatum erforderlich.' using errcode = '22023';
  end if;

  update public.leads
  set status = p_status,
      updated_at = now()
  where id = p_lead_id
    and converted_user_profile_id is null
    and status <> 'customer'
  returning * into v_lead;

  if not found then
    raise exception 'Interessent wurde nicht gefunden oder ist bereits Kunde.' using errcode = 'P0002';
  end if;

  if p_status = 'later' then
    select * into v_task
    from public.lead_tasks
    where lead_id = p_lead_id
      and task_type = 'lead_follow_up'
      and completed = false
    order by created_at desc
    limit 1
    for update;

    if v_task.id is null then
      insert into public.lead_tasks (lead_id, title, details, due_at, task_type)
      values (
        p_lead_id,
        'Wiedervorlage: Interessenten erneut kontaktieren',
        'Automatisch aus dem Status „Später Interesse“ angelegt.',
        p_follow_up_date,
        'lead_follow_up'
      )
      returning * into v_task;
    else
      update public.lead_tasks
      set due_at = p_follow_up_date,
          details = 'Automatisch aus dem Status „Später Interesse“ angelegt.',
          updated_at = now()
      where id = v_task.id
      returning * into v_task;
    end if;
  else
    update public.lead_tasks
    set completed = true,
        updated_at = now()
    where lead_id = p_lead_id
      and task_type = 'lead_follow_up'
      and completed = false;
  end if;

  return jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'task', case when v_task.id is null then null else to_jsonb(v_task) end
  );
end;
$$;

revoke all on function public.set_lead_interest_status(uuid, text, date) from public, anon, authenticated;
grant execute on function public.set_lead_interest_status(uuid, text, date) to service_role;

comment on column public.lead_tasks.task_type is
  'Technischer Ursprung der Aufgabe, z. B. manual oder lead_follow_up.';

comment on function public.set_lead_interest_status(uuid, text, date) is
  'Ordnet einen Interessenten atomar einer Interessenliste zu und verwaltet bei späterem Interesse die Wiedervorlage.';
