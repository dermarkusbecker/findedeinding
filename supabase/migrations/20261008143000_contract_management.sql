-- Contract changes are recorded separately from immutable invoices and account entries.
alter table public.lead_contracts
 add column if not exists terminated_effective_on date,
 add column if not exists accelerated_at timestamptz,
 add column if not exists archived_at timestamptz,
 add column if not exists lifecycle_reason text;

create table if not exists public.contract_management_events (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid references public.lead_contracts(id) on delete set null,
 lead_id uuid not null,
 action text not null check (action in ('draft_updated','draft_deleted','signed','cancelled','terminated','accelerated','archived')),
 effective_on date,
 reason text,
 actor text not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists contract_management_events_contract_idx on public.contract_management_events(contract_id,created_at desc);
create unique index if not exists contract_management_events_request_idx on public.contract_management_events ((details->>'requestKey'));
alter table public.contract_management_events enable row level security;
revoke all on public.contract_management_events from anon,authenticated;
grant all on public.contract_management_events to service_role;
create function public.contract_keep_event() returns trigger language plpgsql set search_path=public as $$
begin
 -- A deleted draft clears only its FK. The event content and original ID in details remain intact.
 if tg_op='UPDATE' then
  if old.contract_id is not null and new.contract_id is null
     and to_jsonb(new)-'contract_id'=to_jsonb(old)-'contract_id' then return new; end if;
 end if;
 raise exception 'Vertragsereignisse sind unveränderlich';
end $$;
create trigger contract_management_events_immutable before update or delete on public.contract_management_events for each row execute function public.contract_keep_event();
revoke all on function public.contract_keep_event() from public,anon,authenticated;

create or replace function public.manage_lead_contract(p_contract uuid,p_action text,p_payload jsonb,p_request uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c lead_contracts; t service_tariffs; i finance_invoices; s finance_settings; prior contract_management_events;
 d date := (now() at time zone 'Europe/Berlin')::date; effective date; reason_value text;
 credited numeric; credited_net numeric; amount_value numeric; net_value numeric;
 result_value jsonb;
begin
 if p_contract is null or p_request is null or nullif(trim(p_actor),'') is null or p_action not in ('edit','delete','sign','cancel','terminate','accelerate') then raise exception 'Ungültige Vertragsaktion'; end if;
 select * into c from lead_contracts where id=p_contract for update;
 if c.id is null then raise exception 'Vertrag nicht gefunden'; end if;
 select * into prior from contract_management_events where details->>'requestKey'=p_request::text;
 if prior.id is not null then
   if prior.details->>'contractId'<>c.id::text or prior.details->>'requestedAction'<>p_action then raise exception 'Anfrageschlüssel gehört zu einer anderen Vertragsaktion'; end if;
   return jsonb_build_object('contract_id',c.id,'action',prior.action,'replayed',true);
 end if;
 reason_value:=trim(coalesce(p_payload->>'reason',''));
 if p_action in ('cancel','terminate','accelerate','delete') and length(reason_value)<3 then raise exception 'Bitte einen Grund mit mindestens drei Zeichen angeben'; end if;
 if length(reason_value)>900 then raise exception 'Der Grund darf höchstens 900 Zeichen haben'; end if;
 effective:=nullif(p_payload->>'effectiveOn','')::date;
 if p_action='edit' then
  if c.status not in ('draft','sent') or c.archived_at is not null then raise exception 'Nur Vertragsentwürfe können bearbeitet werden'; end if;
  select * into t from service_tariffs where id=(p_payload->>'tariffId')::uuid and is_active for share;
  if t.id is null then raise exception 'Aktiven Tarif auswählen'; end if;
  if effective is null then raise exception 'Leistungsbeginn fehlt'; end if;
  update lead_contracts set tariff_id=t.id,title=t.product_label,amount=t.gross_price,program_start_date=effective,
   contract_data=coalesce(c.contract_data,'{}'::jsonb)||jsonb_build_object('tariffId',t.id,'tariffName',t.name,'product',t.product_label,'duration',t.duration_label,'paymentModel',t.payment_model,'paymentDue',t.payment_due,'additionalAgreements',t.additional_agreements,'serviceStart',effective),updated_at=now()
   where id=c.id;
  p_action:='draft_updated';
 elsif p_action='delete' then
  if c.archived_at is not null then raise exception 'Vertrag ist bereits archiviert'; end if;
  if c.status in ('draft','sent') and not exists(select 1 from finance_invoices where contract_id=c.id) then
   delete from lead_contracts where id=c.id;
   p_action:='draft_deleted';
  else
   update lead_contracts set archived_at=now(),updated_at=now() where id=c.id;
   p_action:='archived';
  end if;
 elsif p_action='sign' then
  if c.status not in ('draft','sent') or c.archived_at is not null then raise exception 'Nur ein offener Entwurf kann unterzeichnet werden'; end if;
  if c.document_storage_path is null or c.document_confirmed_at is null then raise exception 'Unterschriebenes Vertrags-PDF fehlt'; end if;
  if nullif(trim(c.contract_data->>'street'),'') is null or nullif(trim(c.contract_data->>'postalCity'),'') is null or c.program_start_date is null then raise exception 'Bitte zuerst vollständige Rechnungsanschrift und Leistungsbeginn im Entwurf ergänzen'; end if;
  select * into s from finance_settings where id='default';
  if s.id is null or nullif(trim(s.issuer_name),'') is null or nullif(trim(s.issuer_address),'') is null or nullif(trim(s.tax_id),'') is null then raise exception 'Rechnungsstellerdaten fehlen'; end if;
  update lead_contracts set status='signed',signed_at=now(),updated_at=now() where id=c.id;
  p_action:='signed';
 elsif p_action='cancel' then
  if c.status<>'signed' or c.archived_at is not null then raise exception 'Nur ein aktiver Vertrag kann storniert werden'; end if;
  for i in select * from finance_invoices where contract_id=c.id and status='issued' order by id for update loop
   select coalesce(sum(amount),0),coalesce(sum(net),0) into credited,credited_net from finance_account_events where invoice_id=i.id and kind='credit';
   amount_value:=i.gross-credited-coalesce((select sum(amount) from finance_account_events where invoice_id=i.id and kind='writeoff'),0);
   if amount_value>0 then
    net_value:=round((credited+amount_value)*i.net/nullif(i.gross,0),2)-credited_net;
    insert into finance_account_events(invoice_id,lead_id,kind,document_number,booked_at,amount,net,vat,reason,actor)
    values(i.id,i.lead_id,'credit','FDD-GS-'||extract(year from d)::text||'-'||lpad(nextval('finance_adjustment_number_seq')::text,6,'0'),d,amount_value,net_value,amount_value-net_value,'Vertragsstornierung: '||reason_value,p_actor);
   end if;
  end loop;
  update finance_invoices set status='cancelled' where contract_id=c.id and status='needs_details';
  update lead_contracts set status='cancelled',lifecycle_reason=reason_value,updated_at=now() where id=c.id;
  effective:=c.signed_at::date;
 elsif p_action='terminate' then
  if c.status<>'signed' or c.archived_at is not null or c.terminated_effective_on is not null then raise exception 'Vertrag kann nicht gekündigt werden'; end if;
  if effective is null or effective<d then raise exception 'Kündigungsdatum muss heute oder später sein'; end if;
  update lead_contracts set terminated_effective_on=effective,lifecycle_reason=reason_value,updated_at=now() where id=c.id;
 elsif p_action='accelerate' then
  if c.status<>'signed' or c.archived_at is not null or c.accelerated_at is not null then raise exception 'Restfälligstellung ist nicht möglich'; end if;
  if p_payload->>'basisConfirmed'<>'true' then raise exception 'Vertragliche oder gesetzliche Grundlage ausdrücklich bestätigen'; end if;
  for i in select * from finance_invoices where contract_id=c.id and status='issued' order by id for update loop
   if public.finance_invoice_remaining(i.id)>0 then
    insert into finance_account_events(invoice_id,lead_id,kind,document_number,booked_at,amount,due_date,reason,actor)
    values(i.id,i.lead_id,'due','FDD-FA-'||lpad(nextval('finance_adjustment_number_seq')::text,6,'0'),d,0,d,'Restfälligstellung: '||reason_value,p_actor);
   end if;
  end loop;
  update lead_contracts set accelerated_at=now(),lifecycle_reason=reason_value,updated_at=now() where id=c.id;
  effective:=d;
 end if;
 insert into contract_management_events(contract_id,lead_id,action,effective_on,reason,actor,details)
 values(case when p_action='draft_deleted' then null else c.id end,c.lead_id,p_action,effective,reason_value,p_actor,jsonb_build_object('requestKey',p_request,'requestedAction',case p_action when 'draft_updated' then 'edit' when 'draft_deleted' then 'delete' when 'archived' then 'delete' when 'signed' then 'sign' when 'cancelled' then 'cancel' when 'terminated' then 'terminate' when 'accelerated' then 'accelerate' end,'contractId',c.id,'contractNumber',c.contract_number,'tariffId',c.tariff_id));
 result_value:=jsonb_build_object('contract_id',c.id,'action',p_action,'replayed',false);
 return result_value;
end $$;
revoke all on function public.manage_lead_contract(uuid,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.manage_lead_contract(uuid,text,jsonb,uuid,text) to service_role;

-- An accelerated invoice leaves the original installment timetable only for that invoice.
-- Other invoices sharing a payment plan keep their agreed installment dates.
create or replace view public.finance_due_items as
 select 'invoice:'||i.id||':'||coalesce(e.due_date,i.due_date)::text as target_key,p.id customer_id,i.lead_id,i.invoice_number as reference,
 coalesce(e.due_date,i.due_date) due_date,greatest(0,public.finance_invoice_remaining(i.id))::numeric(12,2) as open
 from public.finance_invoices i
 join public.user_profiles p on p.role='user' and exists(select 1 from public.leads l where l.id=i.lead_id and (l.converted_user_profile_id=p.id or (l.id=p.source_lead_id and l.converted_user_profile_id is null)))
 left join public.lead_contracts c on c.id=i.contract_id
 left join lateral(select due_date from public.finance_account_events where invoice_id=i.id and kind='due' order by created_at desc,id desc limit 1)e on true
 where i.status='issued' and (c.accelerated_at is not null or not exists(select 1 from public.finance_installment_allocations a join public.finance_installments r on r.id=a.installment_id join public.finance_payment_plans pl on pl.id=r.plan_id where a.invoice_id=i.id and pl.status in ('active','paused')))
 union all
 select 'rate:'||r.id,pl.customer_id,min(i.lead_id::text)::uuid,string_agg(distinct i.invoice_number,', ')||' · Rate '||r.position,r.due_date,
 coalesce(sum(greatest(0,least(a.amount,public.finance_invoice_remaining(i.id)-a.later_amount))),0)::numeric(12,2)
 from public.finance_installments r join public.finance_payment_plans pl on pl.id=r.plan_id
 join public.finance_installment_allocations a on a.installment_id=r.id join public.finance_invoices i on i.id=a.invoice_id
 left join public.lead_contracts c on c.id=i.contract_id
 where pl.status='active' and c.accelerated_at is null
 group by r.id,pl.customer_id,r.position,r.due_date
 having coalesce(sum(greatest(0,least(a.amount,public.finance_invoice_remaining(i.id)-a.later_amount))),0)>0;

insert into public.communication_templates(template_key,name,description,category,channel,subject,body,status) values
 ('contract_signed_document','Automatisch: Vertragsdokument','Sofort nach Unterzeichnung, mit dem Vertrags-PDF und den vereinbarten Tarifkonditionen.','contract','email','Dein Vertrag {{vertragsnummer}} und deine Tarifkonditionen',E'Hallo {{vorname}},\n\nvielen Dank für dein Vertrauen. Anbei erhältst du dein Vertragsdokument {{vertragsnummer}} für {{tarif}}.\n\nVereinbart sind {{laufzeit}} Laufzeit, ein Gesamtpreis von {{preis}} und das Zahlungsmodell {{zahlungsmodell}}. {{faellig}}\n\nWeitere individuelle Abreden: {{zusatzabreden}}\n\nBitte bewahre das Dokument auf. Bei Fragen antworte gern direkt auf diese E-Mail.','active'),
 ('contract_signed_invoice','Automatisch: Rechnung','Sofort nach der Vertrags-E-Mail, mit der ausgestellten Rechnung als PDF.','contract','email','Deine Rechnung {{rechnungsnummer}} zu {{vertragsnummer}}',E'Hallo {{vorname}},\n\nanbei erhältst du die Rechnung {{rechnungsnummer}} zu deinem Vertrag {{vertragsnummer}}. Der Rechnungsbetrag beträgt {{preis}}. {{faellig}}\n\nDeinen Kontostand und die Zahlungsmöglichkeiten findest du auch in deinem Kundenportal. Bei Fragen antworte gern direkt auf diese E-Mail.','active')
on conflict(template_key) do nothing;
