alter table public.service_tariffs add column if not exists program_version_id uuid references public.program_versions(id);
comment on column public.service_tariffs.program_version_id is 'Veröffentlichter Prozess für neue Kunden dieses Tarifs; NULL verwendet den aktuellen Standardprozess.';
create or replace function public.assign_program_version(p_participant uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare assigned public.participant_program_versions%rowtype; v public.program_versions%rowtype; tariff_version uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_participant::text,0));
  select * into assigned from public.participant_program_versions where user_profile_id=p_participant;
  if not found then
    select t.program_version_id into tariff_version
      from public.lead_contracts c join public.leads l on l.id=c.lead_id
      join public.service_tariffs t on t.id=c.tariff_id
      where l.converted_user_profile_id=p_participant and c.status='signed'
      order by c.signed_at desc nulls last,c.created_at desc limit 1;
    if tariff_version is not null then select * into v from public.program_versions where id=tariff_version;
    else select * into v from public.program_versions order by version desc limit 1; end if;
    insert into public.participant_program_versions(user_profile_id,version_id) values(p_participant,v.id) returning * into assigned;
  end if;
  if assigned.version_id is null then return null; end if;
  select * into v from public.program_versions where id=assigned.version_id;
  return jsonb_build_object('version',v.version,'definition',v.definition);
end; $$;
revoke all on function public.assign_program_version(uuid) from public,anon,authenticated;
grant execute on function public.assign_program_version(uuid) to service_role;
