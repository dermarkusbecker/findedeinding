create table public.finance_settings (
 id text primary key default 'default' check(id='default'), vat_rate numeric(5,2) not null default 19 check(vat_rate between 0 and 100),
 issuer_name text not null default 'Markus Becker', issuer_address text not null default E'Amorbacher Str. 39\n74177 Bad Friedrichshall\nDeutschland', tax_id text not null default 'DE311109135', iban text not null default '', payment_days integer not null default 0 check(payment_days between 0 and 365), updated_at timestamptz not null default now()
);
insert into public.finance_settings(id) values('default');
create sequence public.finance_invoice_number_seq;
create table public.finance_invoices (
 id uuid primary key default gen_random_uuid(), contract_id uuid not null unique references public.lead_contracts(id) on delete restrict,
 lead_id uuid not null references public.leads(id) on delete restrict, invoice_number text unique,
 status text not null default 'needs_details' check(status in ('needs_details','issued','cancelled')),
 invoice_date date, due_date date, service_date date, description text not null,
 customer_name text not null, customer_address text not null default '', issuer jsonb not null,
 vat_rate numeric(5,2) not null, gross numeric(12,2) not null check(gross>=0), net numeric(12,2) not null, vat numeric(12,2) not null,
 pdf_path text, created_at timestamptz not null default now(), check(net+vat=gross)
);
alter table public.lead_payments add column if not exists invoice_id uuid references public.finance_invoices(id) on delete restrict;
alter table public.lead_payments add column if not exists booking_key uuid unique;
create index finance_invoices_lead_idx on public.finance_invoices(lead_id);
create index finance_invoices_date_idx on public.finance_invoices(invoice_date);
alter table public.finance_settings enable row level security;
alter table public.finance_invoices enable row level security;

create or replace function public.finance_capture_contract() returns trigger language plpgsql security definer set search_path=public as $$
declare s finance_settings; l leads; n numeric; addr text;
begin
 if new.status <> 'signed' then return new; end if;
 select * into s from finance_settings where id='default'; select * into l from leads where id=new.lead_id;
 addr:=concat_ws(E'\n',nullif(new.contract_data->>'street',''),nullif(new.contract_data->>'postalCity',''));
 n:=round(new.amount/(1+s.vat_rate/100),2);
 insert into finance_invoices(contract_id,lead_id,service_date,description,customer_name,customer_address,issuer,vat_rate,gross,net,vat)
 values(new.id,new.lead_id,new.program_start_date,new.title,coalesce(nullif(new.contract_data->>'customerName',''),l.name),addr,to_jsonb(s),s.vat_rate,new.amount,n,new.amount-n) on conflict(contract_id) do nothing;
 return new;
end $$;
create trigger finance_contract_capture after insert or update of status on public.lead_contracts for each row execute function public.finance_capture_contract();

create or replace function public.finance_issue_ready() returns integer language plpgsql security definer set search_path=public as $$
declare i finance_invoices; s finance_settings; p user_profiles; issued integer:=0; d date:=(now() at time zone 'Europe/Berlin')::date;
begin
 select * into s from finance_settings where id='default';
 if trim(s.tax_id)='' or trim(s.issuer_name)='' or trim(s.issuer_address)='' then return 0; end if;
 for i in select * from finance_invoices where status='needs_details' for update loop
  if i.customer_address='' then
   select u.* into p from user_profiles u join leads l on l.converted_user_profile_id=u.id where l.id=i.lead_id;
   if coalesce(p.street,'')<>'' and coalesce(p.postal_code,'')<>'' and coalesce(p.city,'')<>'' then i.customer_address:=concat_ws(E'\n',p.street,p.postal_code||' '||p.city,p.country); end if;
  end if;
  if i.customer_address='' or i.service_date is null then continue; end if;
  update finance_invoices set customer_address=i.customer_address, issuer=to_jsonb(s), invoice_date=d,due_date=d+s.payment_days,
    invoice_number='FDD-RE-'||extract(year from d)::text||'-'||lpad(nextval('finance_invoice_number_seq')::text,6,'0'),status='issued' where id=i.id;
  issued:=issued+1;
 end loop;
 return issued;
end $$;
-- Capture existing signed contracts without changing their status or assigning historical invoice dates.
insert into public.finance_invoices(contract_id,lead_id,service_date,description,customer_name,customer_address,issuer,vat_rate,gross,net,vat)
select c.id,c.lead_id,c.program_start_date,c.title,coalesce(nullif(c.contract_data->>'customerName',''),l.name),concat_ws(E'\n',nullif(c.contract_data->>'street',''),nullif(c.contract_data->>'postalCity','')),to_jsonb(s),s.vat_rate,c.amount,round(c.amount/(1+s.vat_rate/100),2),c.amount-round(c.amount/(1+s.vat_rate/100),2)
from public.lead_contracts c join public.leads l on l.id=c.lead_id cross join public.finance_settings s where c.status='signed' on conflict(contract_id) do nothing;

create or replace function public.finance_book_payment(invoice uuid, amount_value numeric, paid_on date, reference_value text, request_key uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare i finance_invoices; remaining numeric; existing uuid;
begin
 select id into existing from lead_payments where booking_key=request_key;
 if existing is not null then return existing; end if;
 select * into i from finance_invoices where id=invoice for update;
 select id into existing from lead_payments where booking_key=request_key;
 if existing is not null then return existing; end if;
 if i.id is null or i.status<>'issued' then raise exception 'Rechnung ist nicht ausgestellt'; end if;
 if amount_value<=0 or paid_on is null or paid_on>(now() at time zone 'Europe/Berlin')::date or request_key is null then raise exception 'Ungültige Zahlung'; end if;
 select i.gross-coalesce(sum(amount),0) into remaining from lead_payments where invoice_id=i.id and status='booked';
 if amount_value>remaining then raise exception 'Zahlung übersteigt den offenen Rechnungsbetrag'; end if;
 insert into lead_payments(lead_id,invoice_id,amount,status,reference,booked_at,booking_key) values(i.lead_id,i.id,amount_value,'booked',reference_value,paid_on,request_key) returning id into existing;
 return existing;
end $$;
revoke all on function public.finance_capture_contract() from public,anon,authenticated;
revoke all on function public.finance_issue_ready() from public,anon,authenticated;
revoke all on function public.finance_book_payment(uuid,numeric,date,text,uuid) from public,anon,authenticated;
grant execute on function public.finance_issue_ready() to service_role;
grant execute on function public.finance_book_payment(uuid,numeric,date,text,uuid) to service_role;

create or replace function public.finance_try_issue() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.finance_issue_ready(); return new; end $$;
create trigger finance_new_invoice after insert on public.finance_invoices for each statement execute function public.finance_try_issue();
create trigger finance_settings_updated after update on public.finance_settings for each statement execute function public.finance_try_issue();
revoke all on function public.finance_try_issue() from public,anon,authenticated;
-- Finalized accounting snapshots cannot be rewritten by later contract or settings changes.
create or replace function public.finance_protect_invoice() returns trigger language plpgsql as $$
begin
 if old.status='issued' and (to_jsonb(new)-'pdf_path') is distinct from (to_jsonb(old)-'pdf_path') then raise exception 'Ausgestellte Rechnungen sind unveränderlich'; end if;
 return new;
end $$;
create trigger finance_immutable before update on public.finance_invoices for each row execute function public.finance_protect_invoice();
insert into storage.buckets(id,name,public,allowed_mime_types) values('finance-documents','finance-documents',false,array['application/pdf']) on conflict(id) do nothing;
create trigger finance_customer_address_updated after update of street,postal_code,city on public.user_profiles for each statement execute function public.finance_try_issue();

create or replace function public.finance_assign_payment(payment uuid, invoice uuid) returns void language plpgsql security definer set search_path=public as $$
declare i finance_invoices; p lead_payments; paid numeric;
begin
 select * into i from finance_invoices where id=invoice for update;
 select * into p from lead_payments where id=payment for update;
 if i.id is null or p.id is null or i.status<>'issued' or p.status<>'booked' or p.lead_id<>i.lead_id then raise exception 'Zahlung und Rechnung gehören nicht zum selben Kunden'; end if;
 if p.invoice_id=i.id then return; end if;
 if p.invoice_id is not null then raise exception 'Zahlung wurde bereits zugeordnet'; end if;
 select coalesce(sum(amount),0) into paid from lead_payments where invoice_id=i.id and status='booked';
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
   select coalesce(sum(amount),0) into paid from lead_payments where invoice_id=i.id and status='booked';
   if paid+new.amount<=i.gross then new.invoice_id:=i.id; end if;
  end if;
 end if;
 return new;
end $$;
create trigger finance_payment_reference before insert on public.lead_payments for each row execute function public.finance_match_payment();
revoke all on function public.finance_match_payment() from public,anon,authenticated;

select public.finance_issue_ready();
