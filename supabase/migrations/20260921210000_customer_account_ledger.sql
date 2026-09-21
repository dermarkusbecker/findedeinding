-- Additive customer ledger: issued invoices remain immutable. Adjustments carry their own audit trail.
alter table public.finance_invoices alter column contract_id drop not null;
alter table public.lead_payments add column if not exists payment_method text not null default 'other';
create sequence public.finance_adjustment_number_seq;
create table public.finance_account_events (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.finance_invoices(id) on delete restrict,
 lead_id uuid not null references public.leads(id) on delete restrict,
 kind text not null check(kind in ('credit','writeoff','due')),
 document_number text not null unique,
 booked_at date not null,
 amount numeric(12,2) not null check(amount>=0),
 net numeric(12,2) not null default 0,
 vat numeric(12,2) not null default 0,
 due_date date,
 reason text not null check(length(trim(reason)) between 3 and 1000),
 actor text not null,
 created_at timestamptz not null default clock_timestamp(),
 check((kind='due' and amount=0 and due_date is not null) or (kind<>'due' and amount>0 and due_date is null)),
 check((kind='credit' and net+vat=amount) or (kind<>'credit' and net=0 and vat=0))
);
create index finance_account_events_invoice on public.finance_account_events(invoice_id,booked_at);
create index finance_account_events_lead on public.finance_account_events(lead_id,created_at);
create table public.finance_account_requests (
 request_key uuid primary key, customer_id uuid not null references public.user_profiles(id) on delete restrict,
 kind text not null, payload jsonb not null, result jsonb not null, actor text not null, created_at timestamptz not null default now()
);
alter table public.finance_account_events enable row level security;
alter table public.finance_account_requests enable row level security;
revoke all on public.finance_account_events,public.finance_account_requests from anon,authenticated;
grant all on public.finance_account_events,public.finance_account_requests to service_role;
grant usage on sequence public.finance_adjustment_number_seq to service_role;
create function public.finance_keep_account_event() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Gebuchte Kontoeinträge sind unveränderlich'; end $$;
create trigger finance_account_event_immutable before update or delete on public.finance_account_events for each row execute function public.finance_keep_account_event();
create function public.finance_invoice_remaining(p_invoice uuid) returns numeric language sql stable security definer set search_path=public as $$
 select i.gross-coalesce((select sum(amount) from lead_payments where invoice_id=i.id and status='booked'),0)-coalesce((select sum(amount) from finance_account_events where invoice_id=i.id and kind in ('credit','writeoff')),0) from finance_invoices i where i.id=p_invoice;
$$;
create function public.finance_account_book(p_customer uuid,p_kind text,p_payload jsonb,p_request uuid,p_actor text) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 p user_profiles; l leads; s finance_settings; i finance_invoices; previous finance_account_requests;
 d date:=(now() at time zone 'Europe/Berlin')::date; booked date; due date; amount_value numeric;
 reason_value text; method_value text; remaining numeric; credited numeric; credited_net numeric; net_value numeric;
 result_value jsonb; new_id uuid; invoice_id_value uuid; total_value numeric; balance_value numeric;
 lead_ids uuid[];
begin
 if p_request is null or p_payload is null or p_actor is null or trim(p_actor)='' or p_kind not in ('claim','payment','credit','writeoff','due') then raise exception 'Ungültige Kontobuchung'; end if;
 -- Serialize all account actions and concurrent retries for this customer.
 select * into p from user_profiles where id=p_customer and role='user' for update;
 if p.id is null then raise exception 'Kunde nicht gefunden'; end if;
 select * into previous from finance_account_requests where request_key=p_request;
 if previous.request_key is not null then
  if previous.customer_id<>p_customer or previous.kind<>p_kind or previous.payload<>p_payload then raise exception 'Buchungsschlüssel gehört zu einer anderen Buchung'; end if;
  return previous.result||jsonb_build_object('replayed',true);
 end if;
 select array_agg(id) into lead_ids from leads where converted_user_profile_id=p.id or (id=p.source_lead_id and converted_user_profile_id is null);
 if lead_ids is null then raise exception 'Diesem Kunden ist noch keine Kundenakte zugeordnet'; end if;
 select * into l from leads where id=any(lead_ids) order by (id=p.source_lead_id) desc nulls last,created_at,id limit 1;
 reason_value:=trim(coalesce(p_payload->>'reason',''));
 if length(reason_value)<3 or length(reason_value)>1000 then raise exception 'Bitte einen Buchungstext mit 3 bis 1000 Zeichen angeben'; end if;
 booked:=coalesce(nullif(p_payload->>'date','')::date,d);
 if booked>d or booked<'2000-01-01'::date then raise exception 'Ungültiges Buchungsdatum'; end if;
 amount_value:=nullif(p_payload->>'amount','')::numeric;
 if p_kind in ('claim','payment','credit') and (amount_value is null or amount_value<=0 or amount_value<>round(amount_value,2) or amount_value>9999999999.99) then raise exception 'Bitte einen positiven Betrag mit höchstens zwei Nachkommastellen angeben'; end if;
 invoice_id_value:=nullif(p_payload->>'invoiceId','')::uuid;
 if invoice_id_value is not null then
  select * into i from finance_invoices where id=invoice_id_value and lead_id=any(lead_ids) and status='issued' for update;
  if i.id is null then raise exception 'Ausgestellte Rechnung dieses Kunden nicht gefunden'; end if;
 end if;
 if p_kind in ('credit','due') and i.id is null then raise exception 'Bitte eine Rechnung auswählen'; end if;
 if p_kind='claim' then
  select * into s from finance_settings where id='default';
  if s.id is null or trim(s.issuer_name)='' or trim(s.issuer_address)='' or trim(s.tax_id)='' then raise exception 'Rechnungsstellerdaten in den Einstellungen vervollständigen'; end if;
  if coalesce(trim(p.street),'')='' or coalesce(trim(p.postal_code),'')='' or coalesce(trim(p.city),'')='' then raise exception 'Rechnungsanschrift des Kunden vervollständigen'; end if;
  due:=coalesce(nullif(p_payload->>'dueDate','')::date,d);
  if due<d or due>d+3650 or nullif(p_payload->>'serviceDate','') is null then raise exception 'Fälligkeit und Leistungsdatum prüfen'; end if;
  net_value:=round(amount_value/(1+s.vat_rate/100),2);
  insert into finance_invoices(lead_id,status,invoice_number,invoice_date,due_date,service_date,description,customer_name,customer_address,issuer,vat_rate,gross,net,vat)
  values(l.id,'issued','FDD-RE-'||extract(year from d)::text||'-'||lpad(nextval('finance_invoice_number_seq')::text,6,'0'),d,due,(p_payload->>'serviceDate')::date,reason_value,p.name,concat_ws(E'\n',p.street,p.postal_code||' '||p.city,p.country),to_jsonb(s),s.vat_rate,amount_value,net_value,amount_value-net_value) returning id into new_id;
 elsif p_kind='payment' then
  method_value:=coalesce(p_payload->>'method','bank');
  if method_value not in ('bank','cash','card','other') then raise exception 'Ungültige Zahlungsart'; end if;
  if i.id is not null and amount_value>finance_invoice_remaining(i.id) then raise exception 'Zahlung übersteigt den offenen Rechnungsbetrag; überschüssige Zahlungen separat ohne Rechnungszuordnung erfassen'; end if;
  insert into lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key,payment_method)
  values(coalesce(i.lead_id,l.id),i.id,amount_value,'booked',reason_value,booked,p_request,method_value) returning id into new_id;
 elsif p_kind='credit' then
  -- Credits are issued today against the original tax snapshot, including paid invoices.
  select coalesce(sum(amount),0),coalesce(sum(net),0) into credited,credited_net from finance_account_events where invoice_id=i.id and kind='credit';
  if amount_value>i.gross-credited-coalesce((select sum(amount) from finance_account_events where invoice_id=i.id and kind='writeoff'),0) then raise exception 'Gutschrift übersteigt den noch korrigierbaren Rechnungsbetrag'; end if;
  net_value:=round((credited+amount_value)*i.net/nullif(i.gross,0),2)-credited_net;
  insert into finance_account_events(invoice_id,lead_id,kind,document_number,booked_at,amount,net,vat,reason,actor)
  values(i.id,i.lead_id,'credit','FDD-GS-'||extract(year from d)::text||'-'||lpad(nextval('finance_adjustment_number_seq')::text,6,'0'),d,amount_value,net_value,amount_value-net_value,reason_value,p_actor) returning id into new_id;
 elsif p_kind='due' then
  due:=(p_payload->>'dueDate')::date;
  if due is null or due<d or due>d+3650 or finance_invoice_remaining(i.id)<=0 then raise exception 'Fälligkeit muss ab heute liegen und die Rechnung noch offen sein'; end if;
  insert into finance_account_events(invoice_id,lead_id,kind,document_number,booked_at,amount,due_date,reason,actor)
  values(i.id,i.lead_id,'due','FDD-FA-'||lpad(nextval('finance_adjustment_number_seq')::text,6,'0'),d,0,due,reason_value,p_actor) returning id into new_id;
 elsif p_kind='writeoff' then
  if (p_payload->>'confirmed')::boolean is distinct from true then raise exception 'Ausbuchung bitte ausdrücklich bestätigen'; end if;
  -- Lock every invoice before computing the total; never silently consume customer credit.
  perform id from finance_invoices where lead_id=any(lead_ids) and status='issued' order by id for update;
  select coalesce(sum(greatest(0,finance_invoice_remaining(id))),0) into total_value from finance_invoices where lead_id=any(lead_ids) and status='issued';
  select coalesce(sum(gross),0) into balance_value from finance_invoices where lead_id=any(lead_ids) and status='issued';
  balance_value:=balance_value-coalesce((select sum(amount) from lead_payments where lead_id=any(lead_ids) and status='booked'),0)-coalesce((select sum(amount) from finance_account_events where lead_id=any(lead_ids)),0);
  if total_value<=0 then raise exception 'Keine offenen Forderungen zum Ausbuchen'; end if;
  if balance_value<>total_value then raise exception 'Zuerst nicht zugeordnete Zahlungen oder Kundenguthaben klären'; end if;
  if nullif(p_payload->>'expectedBalance','')::numeric is distinct from total_value then raise exception 'Kontostand hat sich geändert. Bitte neu laden und prüfen'; end if;
  for i in select * from finance_invoices where lead_id=any(lead_ids) and status='issued' order by id loop
   remaining:=finance_invoice_remaining(i.id);
   if remaining<=0 then continue; end if;
   insert into finance_account_events(invoice_id,lead_id,kind,document_number,booked_at,amount,reason,actor)
   values(i.id,i.lead_id,'writeoff','FDD-AB-'||extract(year from d)::text||'-'||lpad(nextval('finance_adjustment_number_seq')::text,6,'0'),d,remaining,reason_value,p_actor) returning id into new_id;
  end loop;
 end if;
 result_value:=jsonb_build_object('id',new_id,'kind',p_kind,'replayed',false);
 insert into finance_account_requests(request_key,customer_id,kind,payload,result,actor) values(p_request,p_customer,p_kind,p_payload,result_value,p_actor);
 return result_value;
end $$;
revoke all on function public.finance_account_book(uuid,text,jsonb,uuid,text),public.finance_invoice_remaining(uuid),public.finance_keep_account_event() from public,anon,authenticated;
grant execute on function public.finance_account_book(uuid,text,jsonb,uuid,text),public.finance_invoice_remaining(uuid) to service_role;

-- Existing finance screens and reference matching must use the same adjusted balances.
create or replace function public.finance_book_payment(invoice uuid, amount_value numeric, paid_on date, reference_value text, request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare i finance_invoices; remaining numeric; existing uuid;
begin
 select id into existing from lead_payments where booking_key=request_key;
 if existing is not null then
  if not exists(select 1 from lead_payments where id=existing and invoice_id=invoice and amount=amount_value and booked_at=paid_on and reference is not distinct from reference_value) then raise exception 'Buchungsschlüssel gehört zu einer anderen Zahlung'; end if;
  return existing; end if;
 select * into i from finance_invoices where id=invoice for update;
 select id into existing from lead_payments where booking_key=request_key;
 if existing is not null then
  if not exists(select 1 from lead_payments where id=existing and invoice_id=invoice and amount=amount_value and booked_at=paid_on and reference is not distinct from reference_value) then raise exception 'Buchungsschlüssel gehört zu einer anderen Zahlung'; end if;
  return existing; end if;
 if i.id is null or i.status<>'issued' then raise exception 'Rechnung ist nicht ausgestellt'; end if;
 if amount_value is null or amount_value<=0 or amount_value<>round(amount_value,2) or paid_on is null or paid_on>(now() at time zone 'Europe/Berlin')::date or request_key is null then raise exception 'Ungültige Zahlung'; end if;
 remaining:=finance_invoice_remaining(i.id);
 if amount_value>remaining then raise exception 'Zahlung übersteigt den offenen Rechnungsbetrag'; end if;
 insert into lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key) values(i.lead_id,i.id,amount_value,'booked',reference_value,paid_on,request_key) returning id into existing;
 return existing;
end $$;
create or replace function public.finance_assign_payment(payment uuid, invoice uuid) returns void language plpgsql security definer set search_path=public as $$
declare i finance_invoices; p lead_payments; paid numeric;
begin
 select * into i from finance_invoices where id=invoice for update;
 select * into p from lead_payments where id=payment for update;
 if i.id is null or p.id is null or i.status<>'issued' or p.status<>'booked' or p.lead_id<>i.lead_id then raise exception 'Zahlung und Rechnung gehören nicht zum selben Kunden'; end if;
 if p.invoice_id=i.id then return; end if;
 if p.invoice_id is not null then raise exception 'Zahlung wurde bereits zugeordnet'; end if;
 paid:=i.gross-finance_invoice_remaining(i.id);
 if paid+p.amount>i.gross then raise exception 'Zahlung übersteigt offenen Rechnungsbetrag'; end if;
 update lead_payments set invoice_id=i.id where id=p.id;
end $$;
revoke all on function public.finance_assign_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_assign_payment(uuid,uuid) to service_role;
-- A precise invoice-number reference can be recognized without guessing a customer allocation.
create or replace function public.finance_match_payment() returns trigger language plpgsql security definer set search_path=public as $$
declare i finance_invoices; paid numeric;
begin
 if new.invoice_id is null and new.status='booked' then
  select * into i from finance_invoices where lead_id=new.lead_id and status='issued' and invoice_number=trim(new.reference) for update;
  if i.id is not null then
   paid:=i.gross-finance_invoice_remaining(i.id);
   if paid+new.amount<=i.gross then new.invoice_id:=i.id; end if;
  end if;
 end if;
 return new;
end $$;
