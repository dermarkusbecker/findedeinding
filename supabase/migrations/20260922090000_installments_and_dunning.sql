-- Payment schedules allocate existing debt; they never create new revenue or receivables.
create table public.finance_payment_plans (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.user_profiles(id),
 agreed_on date not null, status text not null check(status in ('active','paused','cancelled','replaced')),
 total numeric(12,2) not null check(total>0), notes text not null default '', actor text not null,
 created_at timestamptz not null default clock_timestamp(), ended_at timestamptz, replaces_id uuid references public.finance_payment_plans(id)
);
create unique index finance_one_active_plan on public.finance_payment_plans(customer_id) where status in ('active','paused');
create table public.finance_installments (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.finance_payment_plans(id),
 position integer not null check(position between 1 and 120), amount numeric(12,2) not null check(amount>0), due_date date not null,
 unique(plan_id,position)
);
create table public.finance_installment_allocations (
 installment_id uuid not null references public.finance_installments(id), invoice_id uuid not null references public.finance_invoices(id),
 amount numeric(12,2) not null check(amount>0), later_amount numeric(12,2) not null check(later_amount>=0),
 primary key(installment_id,invoice_id)
);
create table public.finance_plan_requests (
 request_key uuid primary key,customer_id uuid not null references public.user_profiles(id),action text not null,payload jsonb not null,result jsonb not null,actor text not null,created_at timestamptz not null default now()
);
-- FIFO: reductions of invoice debt settle the oldest allocated installments first.
create view public.finance_installment_balances as
 select r.*,coalesce(sum(greatest(0,least(a.amount,public.finance_invoice_remaining(a.invoice_id)-a.later_amount))),0)::numeric(12,2) as open
 from public.finance_installments r join public.finance_installment_allocations a on a.installment_id=r.id group by r.id;
create function public.finance_plan_save(p_customer uuid,p_action text,p_payload jsonb,p_request uuid,p_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 p user_profiles; prior finance_plan_requests; old_plan finance_payment_plans; plan_id uuid; rate_id uuid; lead_ids uuid[];
 d date:=(now() at time zone 'Europe/Berlin')::date; agreement date; due date; previous_due date; amount_value numeric; total_value numeric; sum_value numeric:=0;
 selected_invoice uuid; invoice_ids uuid[]; available numeric[]; invoice_left numeric; slice_value numeric; rate_left numeric; j integer:=1; n integer:=0;
 item jsonb; inv record; result_value jsonb; balance_value numeric; all_open numeric; paid_date date; saw_open boolean:=false;
begin
 if p_request is null or p_actor is null or p_action not in ('create','replace','cancel') then raise exception 'Ungültige Ratenplan-Anfrage'; end if;
 select * into p from user_profiles where id=p_customer and role='user' for update;
 if p.id is null then raise exception 'Kunde nicht gefunden'; end if;
 select * into prior from finance_plan_requests where request_key=p_request;
 if prior.request_key is not null then
  if prior.customer_id<>p_customer or prior.action<>p_action or prior.payload<>p_payload then raise exception 'Anfrageschlüssel gehört zu einem anderen Vorgang'; end if;
  return prior.result||'{"replayed":true}'::jsonb;
 end if;
 select * into old_plan from finance_payment_plans where customer_id=p.id and status in ('active','paused') for update;
 if p_action in ('replace','cancel') then
  if old_plan.id is null or old_plan.id is distinct from (p_payload->>'planId')::uuid then raise exception 'Ratenplan wurde zwischenzeitlich geändert. Bitte neu laden'; end if;
  update finance_payment_plans set status=case when p_action='cancel' then 'cancelled' else 'replaced' end,ended_at=clock_timestamp() where id=old_plan.id;
 elsif old_plan.id is not null then raise exception 'Es besteht bereits ein Ratenplan. Bitte den offenen Restbetrag neu planen';
 end if;
 if p_action<>'cancel' then
  select array_agg(id) into lead_ids from leads where converted_user_profile_id=p.id or (id=p.source_lead_id and converted_user_profile_id is null);
  perform id from finance_invoices where lead_id=any(lead_ids) and status='issued' order by id for update;
  select coalesce(sum(greatest(0,finance_invoice_remaining(id))),0),coalesce(sum(finance_invoice_remaining(id)),0) into all_open,balance_value from finance_invoices where lead_id=any(lead_ids) and status='issued';
  balance_value:=balance_value-coalesce((select sum(amount) from lead_payments where lead_id=any(lead_ids) and status='booked' and invoice_id is null),0);
  if balance_value<>all_open then raise exception 'Bitte zuerst nicht zugeordnete Zahlungen oder Kundenguthaben im Konto klären'; end if;
  selected_invoice:=nullif(p_payload->>'invoiceId','')::uuid;
  select array_agg(id order by invoice_date,created_at,id),array_agg(finance_invoice_remaining(id) order by invoice_date,created_at,id),sum(finance_invoice_remaining(id)) into invoice_ids,available,total_value
   from finance_invoices where lead_id=any(lead_ids) and status='issued' and finance_invoice_remaining(id)>0 and (selected_invoice is null or id=selected_invoice);
  if total_value is null or total_value<=0 then raise exception 'Keine offenen Rechnungen dieses Kunden vorhanden'; end if;
  if total_value is distinct from (p_payload->>'total')::numeric then raise exception 'Der offene Saldo hat sich geändert. Bitte neu laden und prüfen'; end if;
  agreement:=(p_payload->>'agreedOn')::date;
  if agreement is null or agreement>d or agreement<'2000-01-01' then raise exception 'Datum der Vereinbarung prüfen'; end if;
  if coalesce(p_payload->>'status','') not in ('active','paused') or length(coalesce(p_payload->>'notes',''))>2000 then raise exception 'Status oder Angaben prüfen'; end if;
  if jsonb_typeof(p_payload->'rates') is distinct from 'array' or jsonb_array_length(p_payload->'rates') not between 1 and 120 then raise exception 'Bitte 1 bis 120 Raten angeben'; end if;
  insert into finance_payment_plans(customer_id,agreed_on,status,total,notes,actor,replaces_id) values(p.id,agreement,p_payload->>'status',total_value,coalesce(p_payload->>'notes',''),p_actor,old_plan.id) returning id into plan_id;
  invoice_left:=available[1];
  for item in select value from jsonb_array_elements(p_payload->'rates') loop
   n:=n+1;amount_value:=(item->>'amount')::numeric;due:=(item->>'dueDate')::date;
   if amount_value is null or amount_value<=0 or amount_value<>round(amount_value,2) or due is null or due<'2000-01-01' or due>d+3650 or due<previous_due then raise exception 'Ratenbeträge und aufsteigende Fälligkeiten prüfen'; end if;
   if coalesce(item->>'status','open') not in ('open','paid') then raise exception 'Ungültiger Zahlungsstatus'; end if;
   if item->>'status'='paid' and saw_open then raise exception 'Zahlungen werden zuerst auf die ältesten Raten gebucht. Bitte bezahlte Raten lückenlos von oben markieren'; end if;
   if coalesce(item->>'status','open')='open' then saw_open:=true; end if;
   paid_date:=nullif(item->>'paidOn','')::date;
   if item->>'status'='paid' and (paid_date is null or paid_date>d or paid_date<'2000-01-01') then raise exception 'Tatsächliches Zahlungsdatum prüfen'; end if;
   sum_value:=sum_value+amount_value;previous_due:=due;
   if sum_value>total_value then raise exception 'Summe der Raten muss dem offenen Betrag entsprechen'; end if;
   insert into finance_installments(plan_id,position,amount,due_date) values(plan_id,n,amount_value,due) returning id into rate_id;
   rate_left:=amount_value;
   while rate_left>0 loop
    slice_value:=least(rate_left,invoice_left);
    insert into finance_installment_allocations(installment_id,invoice_id,amount,later_amount) values(rate_id,invoice_ids[j],slice_value,invoice_left-slice_value);
    -- A paid selection is an actual posted payment, not a cosmetic installment flag.
    if item->>'status'='paid' then
     insert into lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key,payment_method)
      select lead_id,id,slice_value,'booked','Ratenplan · Rate '||n,paid_date,gen_random_uuid(),'bank' from finance_invoices where id=invoice_ids[j];
    end if;
    rate_left:=rate_left-slice_value;invoice_left:=invoice_left-slice_value;
    if invoice_left=0 then j:=j+1;invoice_left:=available[j]; end if;
   end loop;
  end loop;
  if sum_value<>total_value then raise exception 'Summe der Raten muss dem offenen Betrag entsprechen'; end if;
 end if;
 result_value:=jsonb_build_object('id',coalesce(plan_id,old_plan.id),'replayed',false);
 insert into finance_plan_requests values(p_request,p.id,p_action,p_payload,result_value,p_actor,clock_timestamp());
 return result_value;
end $$;

create table public.finance_dunning_settings (
 id text primary key check(id='default'),enabled boolean not null default true,
 stages jsonb not null default '[{"days":14,"subject":"Zahlungserinnerung · {{beleg}}","body":"Hallo {{name}},\n\nfür {{beleg}} ist seit dem {{faellig}} noch ein Betrag von {{betrag}} offen. Vielleicht ist die Zahlung im Alltag untergegangen. Bitte überweise den offenen Betrag mit dem Verwendungszweck {{beleg}}.\n\n{{bank}}\n\nFalls du bereits überwiesen hast oder Fragen zur Rechnung hast, antworte bitte auf diese Nachricht. Wir prüfen das gerne gemeinsam."},{"days":14,"subject":"Zweite Zahlungserinnerung · {{beleg}}","body":"Hallo {{name}},\n\nwir haben dich bereits an die offene Zahlung für {{beleg}} erinnert. Aktuell sind noch {{betrag}} offen; die Fälligkeit war am {{faellig}}.\n\nBitte begleiche den offenen Betrag oder melde dich bei uns, wenn du eine Rückfrage hast oder eine Zahlungsvereinbarung besprechen möchtest.\n\n{{bank}}\n\nVerwendungszweck: {{beleg}}. Vielen Dank für deine Rückmeldung."},{"days":14,"subject":"Dritte Zahlungserinnerung · {{beleg}}","body":"Hallo {{name}},\n\ntrotz unserer bisherigen Erinnerungen ist für {{beleg}} weiterhin ein Betrag von {{betrag}} offen. Die Zahlung war am {{faellig}} fällig.\n\nBitte begleiche den Betrag jetzt oder nimm zeitnah Kontakt mit uns auf, damit wir die offene Zahlung gemeinsam klären können.\n\n{{bank}}\n\nVerwendungszweck: {{beleg}}. Wenn die Zahlung inzwischen erfolgt ist, sende uns bitte eine kurze Rückmeldung."}]',
 updated_at timestamptz not null default now(),last_run_at timestamptz,last_result jsonb
);
insert into public.finance_dunning_settings(id) values('default');
create table public.finance_dunning_notices (
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.user_profiles(id),target_key text not null,stage integer not null check(stage between 1 and 3),
 amount numeric(12,2) not null, status text not null check(status in ('reserved','sending','sent','failed','unknown','skipped')),
 communication_id uuid references public.lead_communications(id),recipient text not null,subject text not null,body text not null,
 created_at timestamptz not null default clock_timestamp(),sent_at timestamptz,error text,reviewed_by text,reviewed_at timestamptz,review_action text
);
create unique index finance_dunning_unique_stage on public.finance_dunning_notices(target_key,stage) where status<>'skipped';
-- Pause suspends dunning, while retaining the agreed schedule and excluding the original invoice.
create view public.finance_due_items as
 select 'invoice:'||i.id||':'||coalesce(e.due_date,i.due_date)::text as target_key,p.id customer_id,i.lead_id,i.invoice_number as reference,
 coalesce(e.due_date,i.due_date) due_date,greatest(0,public.finance_invoice_remaining(i.id))::numeric(12,2) as open
 from public.finance_invoices i join public.user_profiles p on p.role='user' and exists(select 1 from public.leads l where l.id=i.lead_id and (l.converted_user_profile_id=p.id or (l.id=p.source_lead_id and l.converted_user_profile_id is null)))
 left join lateral(select due_date from public.finance_account_events where invoice_id=i.id and kind='due' order by created_at desc,id desc limit 1)e on true
 where i.status='issued' and not exists(select 1 from public.finance_installment_allocations a join public.finance_installments r on r.id=a.installment_id join public.finance_payment_plans pl on pl.id=r.plan_id where a.invoice_id=i.id and pl.status in ('active','paused'))
 union all
 select 'rate:'||r.id,pl.customer_id,min(i.lead_id::text)::uuid,string_agg(distinct i.invoice_number,', ')||' · Rate '||r.position,r.due_date,r.open
 from public.finance_installment_balances r join public.finance_payment_plans pl on pl.id=r.plan_id
 join public.finance_installment_allocations a on a.installment_id=r.id join public.finance_invoices i on i.id=a.invoice_id
 where pl.status='active' group by r.id,pl.customer_id,r.position,r.due_date,r.open;
-- Each claim rechecks eligibility under the same customer/invoice locks as ledger actions.
create function public.finance_dunning_claim(p_key text,p_stage integer,p_subject text,p_body text,p_recipient text,p_amount numeric) returns jsonb language plpgsql security definer set search_path=public as $$
declare item record; p user_profiles;s finance_dunning_settings; previous finance_dunning_notices; notice_id uuid; communication uuid;d date:=(now() at time zone 'Europe/Berlin')::date; base date; next_stage integer;lead_ids uuid[];balance_value numeric;open_value numeric;
begin
 select * into item from finance_due_items where target_key=p_key;
 if not found then return null; end if;
 select * into p from user_profiles where id=item.customer_id for update;
 select array_agg(id) into lead_ids from leads where converted_user_profile_id=p.id or (id=p.source_lead_id and converted_user_profile_id is null);
 perform id from finance_invoices where lead_id=any(lead_ids) and status='issued' order by id for update;
 select * into item from finance_due_items where target_key=p_key;
 if not found or item.open<=0 or item.open is distinct from p_amount then return null; end if;
 select * into s from finance_dunning_settings where id='default';
 if not s.enabled or lower(trim(p.email))<>lower(trim(p_recipient)) or coalesce(trim(p.email),'')='' then return null; end if;
 select coalesce(sum(finance_invoice_remaining(id)),0),coalesce(sum(greatest(0,finance_invoice_remaining(id))),0) into balance_value,open_value from finance_invoices where lead_id=any(lead_ids) and status='issued';
 if balance_value<>open_value or exists(select 1 from lead_payments where lead_id=any(lead_ids) and status='booked' and invoice_id is null) then return null; end if;
 -- Never advance beyond an unresolved/uncertain SMTP attempt, and never repeat a sent stage.
 if exists(select 1 from finance_dunning_notices where target_key=p_key and status in ('reserved','sending','failed','unknown')) then return null; end if;
 select * into previous from finance_dunning_notices where target_key=p_key and status='sent' order by stage desc limit 1;
 next_stage:=coalesce(previous.stage,0)+1;base:=coalesce((previous.sent_at at time zone 'Europe/Berlin')::date,item.due_date);
 if p_stage<>next_stage or next_stage>3 or d<base+(s.stages->(next_stage-1)->>'days')::integer then return null; end if;
 if length(p_subject)>200 or length(p_body)>20000 then raise exception 'Mahnung zu lang'; end if;
 insert into lead_communications(lead_id,user_profile_id,channel,direction,subject,body,preview,delivery_status,automation_source,event_key)
 values(item.lead_id,p.id,'email','outbound',p_subject,p_body,'Mahnstufe '||p_stage||' · Versand vorbereitet','pending','finance_dunning',gen_random_uuid()::text) returning id into communication;
 insert into finance_dunning_notices(customer_id,target_key,stage,amount,status,communication_id,recipient,subject,body)
 values(p.id,p_key,p_stage,item.open,'reserved',communication,p_recipient,p_subject,p_body) returning id into notice_id;
 return jsonb_build_object('id',notice_id,'communicationId',communication,'amount',item.open);
end $$;
-- Reserve -> sending is a single-use gate. Expired/uncertain attempts require explicit review.
create function public.finance_dunning_start(p_notice uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare n finance_dunning_notices; item record; p user_profiles;
begin
 select * into n from finance_dunning_notices where id=p_notice;
 if n.id is null then return false; end if;
 select * into p from user_profiles where id=n.customer_id for update;
 perform i.id from finance_invoices i join leads l on l.id=i.lead_id where l.converted_user_profile_id=p.id or (l.id=p.source_lead_id and l.converted_user_profile_id is null) order by i.id for update of i;
 select * into n from finance_dunning_notices where id=p_notice and status='reserved' for update;
 if not found then return false; end if;
 select * into item from finance_due_items where target_key=n.target_key;
 if not found or item.open<>n.amount or not (select enabled from finance_dunning_settings where id='default') or p.email<>n.recipient
 or exists(select 1 from lead_payments pay join leads l on l.id=pay.lead_id where pay.status='booked' and pay.invoice_id is null and (l.converted_user_profile_id=p.id or (l.id=p.source_lead_id and l.converted_user_profile_id is null)))
 or exists(select 1 from finance_invoices i join leads l on l.id=i.lead_id where i.status='issued' and finance_invoice_remaining(i.id)<0 and (l.converted_user_profile_id=p.id or (l.id=p.source_lead_id and l.converted_user_profile_id is null))) then
  update finance_dunning_notices set status='skipped',error='Forderung oder Konfiguration hat sich vor dem Versand geändert' where id=n.id;
  update lead_communications set delivery_status='cancelled',preview='Mahnung nicht versendet: Forderung oder Konfiguration geändert.' where id=n.communication_id;return false;
 end if;
 update finance_dunning_notices set status='sending' where id=n.id;return true;
end $$;
create function public.finance_dunning_finish(p_notice uuid,p_status text,p_error text default null) returns void language plpgsql security definer set search_path=public as $$
declare n finance_dunning_notices;
begin
 if p_status not in ('sent','failed','unknown') then raise exception 'Ungültiger Versandstatus'; end if;
 update finance_dunning_notices set status=p_status,sent_at=case when p_status='sent' then clock_timestamp() end,error=left(p_error,500) where id=p_notice and status='sending' returning * into n;
 if n.id is null then return; end if;
 update lead_communications set delivery_status=case when p_status='sent' then 'accepted' else p_status end,preview=case when p_status='sent' then 'Mahnstufe '||n.stage||' · Vom Mailserver angenommen. Zustellung nicht bestätigt.' else 'Mahnstufe '||n.stage||' · Versand prüfen: '||coalesce(p_error,'Status unklar') end,updated_at=now() where id=n.communication_id;
end $$;

do $$ declare t text;begin foreach t in array array['finance_payment_plans','finance_installments','finance_installment_allocations','finance_plan_requests','finance_dunning_settings','finance_dunning_notices'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
revoke all on public.finance_installment_balances,public.finance_due_items from public,anon,authenticated;
grant select on public.finance_installment_balances,public.finance_due_items to service_role;
revoke all on function public.finance_plan_save(uuid,text,jsonb,uuid,text),public.finance_dunning_claim(text,integer,text,text,text,numeric),public.finance_dunning_start(uuid),public.finance_dunning_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finance_plan_save(uuid,text,jsonb,uuid,text),public.finance_dunning_claim(text,integer,text,text,text,numeric),public.finance_dunning_start(uuid),public.finance_dunning_finish(uuid,text,text) to service_role;

-- Review preserves the attempted message. Only an explicit staff decision can unblock uncertain delivery.
create function public.finance_dunning_review(p_notice uuid,p_action text,p_actor text) returns void language plpgsql security definer set search_path=public as $$
declare n finance_dunning_notices;
begin
 if p_action not in ('retry','confirm_sent') or coalesce(trim(p_actor),'')='' then raise exception 'Ungültige Versandprüfung'; end if;
 select * into n from finance_dunning_notices where id=p_notice for update;
 if n.id is null or n.status not in ('failed','unknown','sending','reserved') or (n.status in ('sending','reserved') and n.created_at>now()-interval '15 minutes') then raise exception 'Dieser Versand kann aktuell nicht erneut freigegeben werden'; end if;
 update finance_dunning_notices set status=case when p_action='retry' then 'skipped' else 'sent' end,sent_at=case when p_action='confirm_sent' then now() else sent_at end,reviewed_by=p_actor,reviewed_at=now(),review_action=p_action where id=n.id;
 update lead_communications set delivery_status=case when p_action='confirm_sent' then 'accepted' else 'failed' end,preview=case when p_action='confirm_sent' then 'Versand nach manueller Prüfung bestätigt.' else 'Nach manueller Prüfung für den nächsten Mahnlauf erneut freigegeben.' end,updated_at=now() where id=n.communication_id;
end $$;
revoke all on function public.finance_dunning_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.finance_dunning_review(uuid,text,text) to service_role;
create function public.finance_guard_planned_due() returns trigger language plpgsql set search_path=public as $$
begin
 if new.kind='due' and exists(select 1 from finance_installment_allocations a join finance_installments r on r.id=a.installment_id join finance_payment_plans p on p.id=r.plan_id where a.invoice_id=new.invoice_id and p.status in ('active','paused')) then raise exception 'Für diese Rechnung besteht ein Ratenplan. Fälligkeiten über den Ratenplan ändern'; end if;
 return new;
end $$;
create trigger finance_planned_due before insert on public.finance_account_events for each row execute function public.finance_guard_planned_due();
