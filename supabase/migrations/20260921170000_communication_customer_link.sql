alter table public.lead_communications add column if not exists automation_source text;
alter table public.lead_communications add column if not exists event_key text unique;
create or replace function public.link_communication_customer() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.user_profile_id is null and new.lead_id is not null then
  select converted_user_profile_id into new.user_profile_id from leads where id=new.lead_id;
  if new.user_profile_id is null then select id into new.user_profile_id from user_profiles where source_lead_id=new.lead_id limit 1; end if;
 end if; return new;
end $$;
create trigger communication_customer_link before insert or update of lead_id on public.lead_communications for each row execute function public.link_communication_customer();
create or replace function public.link_converted_customer_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.converted_user_profile_id is not null then update lead_communications set user_profile_id=new.converted_user_profile_id where lead_id=new.id and user_profile_id is null; end if; return new;
end $$;
create trigger converted_customer_history after update of converted_user_profile_id on public.leads for each row execute function public.link_converted_customer_history();
update public.lead_communications c set user_profile_id=l.converted_user_profile_id from public.leads l where c.lead_id=l.id and c.user_profile_id is null and l.converted_user_profile_id is not null;
update public.lead_communications c set user_profile_id=u.id from public.user_profiles u where c.lead_id=u.source_lead_id and c.user_profile_id is null;
revoke all on function public.link_communication_customer() from public,anon,authenticated;
revoke all on function public.link_converted_customer_history() from public,anon,authenticated;
-- Existing entries do not prove that the branded draft itself was delivered.
update public.lead_communications set delivery_status='draft' where subject='Dein Klarheitsgespräch ist bestätigt' and delivery_status='sent';
