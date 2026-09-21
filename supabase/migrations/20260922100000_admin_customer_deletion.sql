-- No customer is deleted by this migration. Explicit, confirmed admin requests only.
create table public.customer_deletion_jobs (
 id uuid primary key, customer_id uuid not null unique, auth_user_id uuid, display_name text,
 lead_ids uuid[] not null default '{}', files jsonb not null default '[]',
 status text not null default 'pending' check(status in ('pending','complete')),
 requested_by uuid not null, created_at timestamptz not null default clock_timestamp(),completed_at timestamptz
);
alter table public.customer_deletion_jobs enable row level security;
revoke all on public.customer_deletion_jobs from public,anon,authenticated;
grant all on public.customer_deletion_jobs to service_role;
-- Preserve immutability for ordinary ledger operations. Only the scoped deletion job can purge its own events.
create or replace function public.finance_keep_account_event() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' and exists(select 1 from customer_deletion_jobs j where j.id::text=current_setting('app.customer_deletion_job',true) and j.status='pending' and old.lead_id=any(j.lead_ids)) then return old; end if;
 raise exception 'Gebuchte Kontoeinträge sind unveränderlich';
end $$;
create function public.delete_customer_confirmed(p_customer uuid,p_request uuid,p_actor uuid,p_confirmed boolean,p_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare p user_profiles; j customer_deletion_jobs; linked uuid[]; invoices uuid[]; plans uuid[]; objects jsonb;
begin
 if p_confirmed is distinct from true or p_request is null then raise exception 'Die endgültige Löschung muss ausdrücklich bestätigt werden'; end if;
 if not exists(select 1 from user_profiles where id=p_actor and role='admin' and status='active' and staff_role in ('owner','administrator')) then raise exception 'Nur Systeminhaber und Administration dürfen Kunden löschen'; end if;
 if p_actor=p_customer then raise exception 'Das eigene Konto kann hier nicht gelöscht werden'; end if;
 perform pg_advisory_xact_lock(hashtextextended('delete-customer:'||p_customer::text,0));
 select * into j from customer_deletion_jobs where customer_id=p_customer;
 if found then return jsonb_build_object('id',j.id,'status',j.status); end if;
 select * into p from user_profiles where id=p_customer for update;
 if p.id is null or p.role<>'user' then raise exception 'Kunde nicht gefunden. Mitarbeiterkonten können hier nicht gelöscht werden'; end if;
 if p.name is distinct from p_name then raise exception 'Die Kundenangaben haben sich geändert. Bitte erneut öffnen und bestätigen'; end if;
 select coalesce(array_agg(id),'{}') into linked from leads where converted_user_profile_id=p.id or (id=p.source_lead_id and converted_user_profile_id is null);
 perform id from leads where id=any(linked) order by id for update;
 if exists(select 1 from user_profiles where id<>p.id and source_lead_id=any(linked))
 or exists(select 1 from lead_communications where lead_id=any(linked) and user_profile_id is not null and user_profile_id<>p.id)
 or exists(select 1 from customer_appointments where lead_id=any(linked) and user_profile_id<>p.id) then raise exception 'Eine verknüpfte Akte wird von einem anderen Kunden verwendet. Zuordnung zuerst klären'; end if;
 if exists(select 1 from finance_dunning_notices where customer_id=p.id and status='sending' and created_at>now()-interval '15 minutes') then raise exception 'Für diesen Kunden läuft gerade ein Mailversand. Bitte in wenigen Minuten erneut versuchen'; end if;
 perform id from finance_invoices where lead_id=any(linked) order by id for update;
 select coalesce(array_agg(id),'{}') into invoices from finance_invoices where lead_id=any(linked);
 select coalesce(array_agg(id),'{}') into plans from finance_payment_plans where customer_id=p.id;
 -- Exact object names only; never delete a whole bucket or an unrelated customer's prefix.
 select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)),'[]') into objects from storage.objects o
 where (o.bucket_id in ('participant-documents','participant-avatars','communication-attachments','contract-recordings') and split_part(o.name,'/',1)=any(array[p.id::text]||array(select unnest(linked)::text)))
 or (o.bucket_id='finance-documents' and (o.name in (select 'invoices/'||unnest(invoices)||'.pdf') or o.name in(select 'adjustments/'||id||'.pdf' from finance_account_events where invoice_id=any(invoices))));
 insert into customer_deletion_jobs(id,customer_id,auth_user_id,display_name,lead_ids,files,requested_by) values(p_request,p.id,p.auth_user_id,p.name,linked,objects,p_actor);
 perform set_config('app.customer_deletion_job',p_request::text,true);
 delete from finance_dunning_notices where customer_id=p.id;
 delete from finance_installment_allocations where installment_id in(select id from finance_installments where plan_id=any(plans));
 delete from finance_installments where plan_id=any(plans);
 delete from finance_payment_plans where customer_id=p.id;
 delete from finance_plan_requests where customer_id=p.id;
 delete from finance_account_requests where customer_id=p.id;
 delete from lead_payments where lead_id=any(linked);
 delete from finance_account_events where lead_id=any(linked);
 delete from finance_invoices where id=any(invoices);
 delete from curriculum_lessons where user_profile_id=p.id;
 delete from curriculum_assignment_archive where user_profile_id=p.id;
 -- Shared process versions remain; only remove their optional author reference.
 update program_versions set published_by=null where published_by=p.id;
 delete from leads where id=any(linked);
 -- FK cascades remove program, Clara, notes, appointments, documents and communication rows.
 delete from user_profiles where id=p.id;
 perform set_config('app.customer_deletion_job','',true);
 return jsonb_build_object('id',p_request,'status','pending');
end $$;
revoke all on function public.delete_customer_confirmed(uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.delete_customer_confirmed(uuid,uuid,uuid,boolean,text) to service_role;
