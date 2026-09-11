create table public.program_builder_draft (
  id integer primary key check (id=1), revision integer not null default 0,
  definition jsonb not null, updated_at timestamptz not null default now()
);
create table public.program_versions (
  id uuid primary key default gen_random_uuid(), version integer generated always as identity unique,
  definition jsonb not null, published_by uuid references public.user_profiles(id), published_at timestamptz not null default now()
);
create table public.participant_program_versions (
  user_profile_id uuid primary key references public.user_profiles(id) on delete cascade,
  version_id uuid references public.program_versions(id), assigned_at timestamptz not null default now()
);
alter table public.program_builder_draft enable row level security;
alter table public.program_versions enable row level security;
alter table public.participant_program_versions enable row level security;
-- Existing customers keep their original workflow and answers.
insert into public.participant_program_versions(user_profile_id) select id from public.user_profiles where role='user' on conflict do nothing;
create function public.save_program_builder(p_definition jsonb,p_revision integer,p_publish boolean,p_admin uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.program_builder_draft%rowtype; v public.program_versions%rowtype;
begin
  perform pg_advisory_xact_lock(78231012);
  select * into d from public.program_builder_draft where id=1 for update;
  if coalesce(d.revision,0) <> p_revision then raise exception 'Der Entwurf wurde zwischenzeitlich geändert. Bitte neu laden.'; end if;
  insert into public.program_builder_draft(id,revision,definition) values(1,p_revision+1,p_definition)
    on conflict(id) do update set revision=excluded.revision,definition=excluded.definition,updated_at=now() returning * into d;
  if p_publish then insert into public.program_versions(definition,published_by) values(p_definition,p_admin) returning * into v; end if;
  return jsonb_build_object('revision',d.revision,'version',v.version);
end; $$;
create function public.assign_program_version(p_participant uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare assigned public.participant_program_versions%rowtype; v public.program_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_participant::text,0));
  select * into assigned from public.participant_program_versions where user_profile_id=p_participant;
  if not found then
    select * into v from public.program_versions order by version desc limit 1;
    insert into public.participant_program_versions(user_profile_id,version_id) values(p_participant,v.id) returning * into assigned;
  end if;
  if assigned.version_id is null then return null; end if;
  select * into v from public.program_versions where id=assigned.version_id;
  return jsonb_build_object('version',v.version,'definition',v.definition);
end; $$;
revoke all on function public.save_program_builder(jsonb,integer,boolean,uuid) from public,anon,authenticated;
revoke all on function public.assign_program_version(uuid) from public,anon,authenticated;
grant execute on function public.save_program_builder(jsonb,integer,boolean,uuid) to service_role;
grant execute on function public.assign_program_version(uuid) to service_role;
