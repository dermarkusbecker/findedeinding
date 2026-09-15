create table public.program_builder_snapshots (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 definition jsonb not null,
 revision integer not null,
 created_at timestamptz not null default now(),
 created_by uuid references public.user_profiles(id) on delete set null
);
alter table public.program_builder_snapshots enable row level security;
insert into public.program_builder_snapshots(name,definition,revision)
select 'Bisheriger Entwurf · '||to_char(now() at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'),definition,revision from public.program_builder_draft where id=1;
create or replace function public.save_named_program_draft(p_definition jsonb,p_revision integer,p_publish boolean,p_admin uuid,p_name text default '') returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.save_program_builder(p_definition,p_revision,p_publish,p_admin);
 insert into public.program_builder_snapshots(name,definition,revision,created_by)
 values(coalesce(nullif(left(trim(p_name),160),''),'Entwurf · '||to_char(now() at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI:SS')),p_definition,(result->>'revision')::integer,p_admin);
 return result;
end;$$;
revoke all on function public.save_named_program_draft(jsonb,integer,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.save_named_program_draft(jsonb,integer,boolean,uuid,text) to service_role;
