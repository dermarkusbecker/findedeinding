alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new','contacted','scheduled','consultation','offer','later','customer','lost','disqualified'));

create table if not exists public.follow_up_settings (
  id text primary key default 'default' check (id = 'default'),
  reminder_channel text not null default 'email' check (reminder_channel in ('email','notification')),
  recipient_email text not null default 'markus@dermarkusbecker.de',
  updated_at timestamptz not null default now()
);
insert into public.follow_up_settings (id) values ('default') on conflict (id) do nothing;
alter table public.follow_up_settings enable row level security;

create table if not exists public.follow_up_notifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  task_id uuid not null references public.lead_tasks(id) on delete cascade,
  due_at date not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(task_id,due_at)
);
alter table public.follow_up_notifications enable row level security;
create index if not exists follow_up_notifications_open_idx on public.follow_up_notifications(read_at,created_at desc);

create or replace function public.set_lead_interest_status(
  p_lead_id uuid, p_status text, p_follow_up_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lead public.leads%rowtype; v_task public.lead_tasks%rowtype;
begin
  if p_status not in ('lost','later','disqualified') then
    raise exception 'Ungültiger Interessenstatus.' using errcode='22023';
  end if;
  if p_status='later' and (p_follow_up_date is null or p_follow_up_date<current_date) then
    raise exception 'Für Follow-up ist ein heutiges oder zukünftiges Datum erforderlich.' using errcode='22023';
  end if;
  update public.leads set status=p_status,updated_at=now()
    where id=p_lead_id and converted_user_profile_id is null and status<>'customer'
    returning * into v_lead;
  if not found then raise exception 'Interessent nicht gefunden oder bereits Kunde.' using errcode='P0002'; end if;
  if p_status='later' then
    select * into v_task from public.lead_tasks
      where lead_id=p_lead_id and task_type='lead_follow_up' and completed=false
      order by created_at desc limit 1 for update;
    if v_task.id is null then
      insert into public.lead_tasks(lead_id,title,details,due_at,task_type)
        values(p_lead_id,'Follow-up: Interessenten kontaktieren','Automatisch aus dem Follow-up-Status angelegt.',p_follow_up_date,'lead_follow_up')
        returning * into v_task;
    else
      update public.lead_tasks set due_at=p_follow_up_date,title='Follow-up: Interessenten kontaktieren',details='Automatisch aus dem Follow-up-Status angelegt.',updated_at=now()
        where id=v_task.id returning * into v_task;
    end if;
  else
    update public.lead_tasks set completed=true,updated_at=now()
      where lead_id=p_lead_id and task_type='lead_follow_up' and completed=false;
  end if;
  return jsonb_build_object('lead',to_jsonb(v_lead),'task',case when v_task.id is null then null else to_jsonb(v_task) end);
end $$;
revoke all on function public.set_lead_interest_status(uuid,text,date) from public,anon,authenticated;
grant execute on function public.set_lead_interest_status(uuid,text,date) to service_role;
