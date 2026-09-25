-- Native registration verifies the mailbox before a CRM profile is created.
create table public.mobile_registrations (
 id uuid primary key, purpose text not null default 'register' check(purpose in ('register','reset')), email text not null, name text not null, phone text not null default '', intake jsonb not null,
 code_hash text not null, ip_hash text not null, attempts integer not null default 0, expires_at timestamptz not null default now()+interval '15 minutes',
 state text not null default 'pending' check(state in ('pending','processing','complete')), claimed_at timestamptz, auth_user_id uuid, profile_id uuid,
 created_at timestamptz not null default now()
);
create index mobile_registration_limits on public.mobile_registrations(email,created_at);
create table public.mobile_sessions (
 id uuid primary key, profile_id uuid not null references public.user_profiles(id) on delete cascade,
 refresh_hash text not null unique, expires_at timestamptz not null default now()+interval '30 days', revoked_at timestamptz,created_at timestamptz not null default now()
);
create table public.mobile_retained_records (
 lead_id uuid primary key references public.leads(id) on delete restrict, retention_until date not null, purpose text not null default 'Gesetzliche Aufbewahrung und Vertragsabwicklung',created_at timestamptz not null default now()
);
create table public.mobile_privacy_acceptances (
 profile_id uuid primary key references public.user_profiles(id) on delete cascade, version text not null, confirmed_at timestamptz not null default now()
);
do $$ declare t text;begin foreach t in array array['mobile_registrations','mobile_sessions','mobile_retained_records','mobile_privacy_acceptances'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create function public.mobile_registration_start(p_id uuid,p_email text,p_name text,p_phone text,p_intake jsonb,p_code text,p_ip text,p_purpose text default 'register') returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('mobile-ip:'||p_ip,0));
 perform pg_advisory_xact_lock(hashtextextended('mobile-email:'||p_email,0));
 delete from mobile_registrations where created_at<now()-interval '1 day' and state<>'processing';
 if (select count(*) from mobile_registrations where email=p_email and created_at>now()-interval '1 hour')>=3 or (select count(*) from mobile_registrations where ip_hash=p_ip and created_at>now()-interval '1 hour')>=10 then return false;end if;
 insert into mobile_registrations(id,email,name,phone,intake,code_hash,ip_hash,purpose) values(p_id,p_email,p_name,p_phone,p_intake,p_code,p_ip,p_purpose);return true;
end $$;
create function public.mobile_registration_claim(p_id uuid,p_code text,p_purpose text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r mobile_registrations;begin
 select * into r from mobile_registrations where id=p_id for update;
 if r.id is null or r.purpose<>p_purpose or r.state='complete' or r.expires_at<now() or r.attempts>=5 then return jsonb_build_object('error','Code abgelaufen oder zu oft versucht. Bitte erneut anfordern.');end if;
 update mobile_registrations set attempts=attempts+1 where id=p_id;
 if r.code_hash<>p_code then return jsonb_build_object('error','Der Bestätigungscode stimmt nicht.');end if;
 if r.state='processing' and r.claimed_at>now()-interval '2 minutes' then return jsonb_build_object('error','Die Registrierung wird bereits verarbeitet.');end if;
 update mobile_registrations set state='processing',claimed_at=now() where id=p_id;
 return to_jsonb(r)-'code_hash'-'ip_hash';
end $$;
create function public.mobile_registration_finish(p_id uuid,p_auth uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare r mobile_registrations; uid uuid; lid uuid;begin
 select * into r from mobile_registrations where id=p_id and state='processing' and purpose='register' and auth_user_id=p_auth for update;
 if r.id is null then raise exception 'Registrierung nicht freigegeben';end if;
 if exists(select 1 from user_profiles where lower(email)=r.email) then raise exception 'Ein Konto besteht bereits. Bitte anmelden';end if;
 insert into leads(name,email,phone,source,status,consent_at,intake_answers) values(r.name,r.email,nullif(r.phone,''),'ios_app','new',now(),r.intake) returning id into lid;
 insert into user_profiles(auth_user_id,name,email,phone,role,status,permissions,source_lead_id,must_change_password) values(p_auth,r.name,r.email,nullif(r.phone,''),'user','active',array['customer_portal','documents'],lid,false) returning id into uid;
 update leads set converted_user_profile_id=uid where id=lid;
 insert into mobile_privacy_acceptances(profile_id,version) values(uid,'2026-09-25');
 update mobile_registrations set state='complete',auth_user_id=p_auth,profile_id=uid,intake='{}',phone='' where id=p_id;
 return uid;
end $$;
create function public.mobile_rotate_session(p_old text,p_new text) returns jsonb language plpgsql security definer set search_path=public as $$
declare s mobile_sessions;begin
 select * into s from mobile_sessions where refresh_hash=p_old and revoked_at is null and expires_at>now() for update;
 if s.id is null or not exists(select 1 from user_profiles where id=s.profile_id and status='active' and role='user') then return null;end if;
 update mobile_sessions set refresh_hash=p_new,expires_at=now()+interval '30 days' where id=s.id;
 return jsonb_build_object('id',s.id,'profileId',s.profile_id);
end $$;
-- Retain accounting audit rows while detaching a deleted portal identity.
do $$ declare t text;begin foreach t in array array['finance_payment_plans','finance_plan_requests','finance_account_requests','finance_dunning_notices'] loop execute format('alter table public.%I alter column customer_id drop not null',t);end loop;end $$;
-- Delete the personal coaching account, retaining only records needed for financial/contract obligations.
create function public.mobile_delete_account(p_customer uuid,p_request uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare p user_profiles; linked uuid[]; objects jsonb; job customer_deletion_jobs;begin
 if p_confirmed is distinct from true then raise exception 'Bitte die endgültige Kontolöschung bestätigen';end if;
 perform pg_advisory_xact_lock(hashtextextended('delete-customer:'||p_customer::text,0));
 select * into job from customer_deletion_jobs where customer_id=p_customer;if found then return jsonb_build_object('id',job.id,'status',job.status);end if;
 select * into p from user_profiles where id=p_customer and role='user' for update;if p.id is null then raise exception 'Kundenkonto nicht gefunden';end if;
 select coalesce(array_agg(id),'{}') into linked from leads where converted_user_profile_id=p.id or (id=p.source_lead_id and converted_user_profile_id is null);
 if exists(select 1 from user_profiles where id<>p.id and source_lead_id=any(linked)) then raise exception 'Geteilte Kundenakte muss vor der Löschung geklärt werden';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') into objects from storage.objects where bucket_id in ('participant-avatars','participant-documents','communication-attachments') and split_part(name,'/',1)=any(array[p.id::text]||array(select unnest(linked)::text))
 and not exists(select 1 from lead_contracts c where c.lead_id=any(linked) and c.document_storage_path=storage.objects.name);
 insert into customer_deletion_jobs(id,customer_id,auth_user_id,display_name,lead_ids,files,requested_by) values(p_request,p.id,p.auth_user_id,p.name,linked,objects,p.id);
 -- Financial snapshots remain in the restricted register; no customer portal survives deletion.
 insert into mobile_retained_records(lead_id,retention_until) select id,make_date(extract(year from current_date)::int+9,1,1)-1 from leads where id=any(linked) and (exists(select 1 from finance_invoices f where f.lead_id=leads.id) or exists(select 1 from lead_contracts c where c.lead_id=leads.id) or exists(select 1 from lead_payments b where b.lead_id=leads.id)) on conflict do nothing;
 if exists(select 1 from finance_dunning_notices where customer_id=p.id and status='sending' and created_at>now()-interval '15 minutes') then raise exception 'Eine Zustellung wird gerade abgeschlossen. Bitte in wenigen Minuten erneut versuchen';end if;
 update finance_dunning_notices set customer_id=null where customer_id=p.id;
 update finance_payment_plans set customer_id=null,status=case when status='active' then 'paused' else status end where customer_id=p.id;
 update finance_plan_requests set customer_id=null where customer_id=p.id;
 update finance_account_requests set customer_id=null where customer_id=p.id;
 delete from lead_tasks where lead_id=any(linked);delete from lead_bank_accounts where lead_id=any(linked);
 delete from lead_communications where lead_id=any(linked);
 delete from curriculum_lessons where user_profile_id=p.id;delete from curriculum_assignment_archive where user_profile_id=p.id;
 update program_versions set published_by=null where published_by=p.id;
 delete from mobile_registrations where email=lower(p.email);
 update leads set name='Gelöschtes Kundenkonto',status='lost',email='deleted-'||id::text||'@deleted.invalid',phone=null,mobile_phone=null,whatsapp_phone=null,challenge=null,intake_answers=null,first_name=null,last_name=null,internal_notes=null,qualification_answers='{}',converted_user_profile_id=null,calendar_event_url=null,calendar_event_id=null,meet_url=null where id=any(linked);
 delete from user_profiles where id=p.id;
 delete from leads where id=any(linked) and not exists(select 1 from mobile_retained_records r where r.lead_id=leads.id);
 return jsonb_build_object('id',p_request,'status','pending','retention','Gesetzlich aufzubewahrende Rechnungs- und Vertragsbelege bleiben geschützt erhalten.');
end $$;
revoke all on function public.mobile_registration_start(uuid,text,text,text,jsonb,text,text,text),public.mobile_registration_claim(uuid,text,text),public.mobile_registration_finish(uuid,uuid),public.mobile_rotate_session(text,text),public.mobile_delete_account(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.mobile_registration_start(uuid,text,text,text,jsonb,text,text,text),public.mobile_registration_claim(uuid,text,text),public.mobile_registration_finish(uuid,uuid),public.mobile_rotate_session(text,text),public.mobile_delete_account(uuid,uuid,boolean) to service_role;
