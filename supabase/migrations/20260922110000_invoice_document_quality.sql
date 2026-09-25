-- New issuer fields are captured with each invoice. Existing issued snapshots remain unchanged.
alter table public.finance_settings
 add column account_holder text not null default '',
 add column bank_name text not null default '',
 add column bic text not null default '',
 add column email text not null default '',
 add column phone text not null default '',
 add column website text not null default '',
 add column tax_note text not null default '';
alter table public.finance_invoices add column document_details jsonb not null default '{}';

create or replace function public.finance_document_problems(i public.finance_invoices) returns text[] language plpgsql immutable set search_path=public as $$
declare missing text[]:='{}';
begin
 if trim(coalesce(i.issuer->>'issuer_name',''))='' then missing:=array_append(missing,'Rechnungssteller'); end if;
 if trim(coalesce(i.issuer->>'issuer_address',''))='' then missing:=array_append(missing,'Anschrift des Rechnungsstellers'); end if;
 if trim(coalesce(i.issuer->>'tax_id',''))='' then missing:=array_append(missing,'Steuernummer oder USt-ID'); end if;
 if trim(coalesce(i.customer_name,''))='' then missing:=array_append(missing,'Rechnungsempfänger'); end if;
 if trim(coalesce(i.customer_address,''))='' then missing:=array_append(missing,'Rechnungsanschrift'); end if;
 if trim(coalesce(i.description,''))='' then missing:=array_append(missing,'Leistungsbeschreibung'); end if;
 if i.service_date is null then missing:=array_append(missing,'Leistungsdatum'); end if;
 if i.vat_rate is null or i.vat_rate<0 or i.vat_rate>100 or i.net<0 or i.vat<0 or i.gross<0 or i.net+i.vat<>i.gross or i.net<>round(i.gross/(1+i.vat_rate/100),2) then missing:=array_append(missing,'Netto-, Steuer- und Bruttobeträge'); end if;
 if i.vat_rate=0 and trim(coalesce(i.issuer->>'tax_note',''))='' then missing:=array_append(missing,'Hinweis zum Umsatzsteuersatz 0 %'); end if;
 return missing;
end $$;

create or replace function public.finance_document_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
declare c jsonb; customer jsonb; missing text[];
begin
 if tg_op='UPDATE' and old.status='issued' then return new; end if;
 if new.document_details='{}'::jsonb then
  select to_jsonb(lc) into c from lead_contracts lc where id=new.contract_id;
  select to_jsonb(u) into customer from user_profiles u join leads l on l.converted_user_profile_id=u.id where l.id=new.lead_id;
  new.document_details:=jsonb_strip_nulls(jsonb_build_object('contract_number',c->>'contract_number','duration',c->'contract_data'->>'duration','product',c->'contract_data'->>'product','customer_number',customer->>'customer_number'));
 end if;
 if new.status='issued' then
  missing:=finance_document_problems(new);
  if coalesce(trim(new.invoice_number),'')='' or new.invoice_date is null or new.due_date is null or new.due_date<new.invoice_date then missing:=array_append(missing,'Rechnungsnummer, Rechnungsdatum oder Fälligkeit'); end if;
  if cardinality(missing)>0 then raise exception 'Rechnung unvollständig oder widersprüchlich: %',array_to_string(missing,', '); end if;
 end if;
 return new;
end $$;
create trigger finance_document_validate before insert or update on public.finance_invoices for each row execute function public.finance_document_snapshot();

create or replace function public.finance_issue_ready() returns integer language plpgsql security definer set search_path=public as $$
declare i finance_invoices; s finance_settings; p user_profiles; issued integer:=0; d date:=(now() at time zone 'Europe/Berlin')::date;
begin
 select * into s from finance_settings where id='default';
 if s.id is null then return 0; end if;
 for i in select * from finance_invoices where status='needs_details' order by created_at,id for update loop
  if trim(i.customer_address)='' then
   select u.* into p from user_profiles u join leads l on l.converted_user_profile_id=u.id where l.id=i.lead_id;
   if coalesce(trim(p.street),'')<>'' and coalesce(trim(p.postal_code),'')<>'' and coalesce(trim(p.city),'')<>'' then i.customer_address:=concat_ws(E'\n',p.street,p.postal_code||' '||p.city,p.country); end if;
  end if;
  i.issuer:=to_jsonb(s);
  if cardinality(finance_document_problems(i))>0 then continue; end if;
  -- Rate and totals were captured with the contract; never recompute them from new settings.
  i.issuer:=jsonb_set(i.issuer,'{vat_rate}',to_jsonb(i.vat_rate));
  update finance_invoices set customer_address=i.customer_address,issuer=i.issuer,invoice_date=d,due_date=d+s.payment_days,
   invoice_number='FDD-RE-'||extract(year from d)::text||'-'||lpad(nextval('finance_invoice_number_seq')::text,6,'0'),status='issued' where id=i.id;
  issued:=issued+1;
 end loop;
 return issued;
end $$;

-- A partial address supplied by a contract must not masquerade as a complete address.
create or replace function public.finance_capture_contract() returns trigger language plpgsql security definer set search_path=public as $$
declare s finance_settings; l leads; n numeric; addr text;
begin
 if new.status <> 'signed' then return new; end if;
 select * into s from finance_settings where id='default';select * into l from leads where id=new.lead_id;
 if nullif(trim(new.contract_data->>'street'),'') is not null and nullif(trim(new.contract_data->>'postalCity'),'') is not null then
  addr:=concat_ws(E'\n',new.contract_data->>'street',new.contract_data->>'postalCity',nullif(new.contract_data->>'country',''));
 else addr:=''; end if;
 n:=round(new.amount/(1+s.vat_rate/100),2);
 insert into finance_invoices(contract_id,lead_id,service_date,description,customer_name,customer_address,issuer,vat_rate,gross,net,vat)
 values(new.id,new.lead_id,new.program_start_date,new.title,coalesce(nullif(trim(new.contract_data->>'customerName'),''),l.name),addr,to_jsonb(s),s.vat_rate,new.amount,n,new.amount-n) on conflict(contract_id) do nothing;
 return new;
end $$;
revoke all on function public.finance_document_problems(public.finance_invoices),public.finance_document_snapshot() from public,anon,authenticated;
grant execute on function public.finance_document_problems(public.finance_invoices) to service_role;

-- Include the new immutable presentation files in the already confirmed customer cleanup.
do $$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('public.delete_customer_confirmed(uuid,uuid,uuid,boolean,text)'::regprocedure) into definition;
 original:=$old$o.name in (select 'invoices/'||unnest(invoices)||'.pdf')$old$;
 replacement:=$new$o.name in (select 'invoices/'||id||suffix from unnest(invoices) id cross join (values ('.pdf'),('.design-v2.pdf')) v(suffix))$new$;
 if position(original in definition)=0 then raise exception 'Invoice cleanup definition changed; review migration'; end if;
 definition:=replace(definition,original,replacement);
 original:=$old$o.name in(select 'adjustments/'||id||'.pdf' from finance_account_events where invoice_id=any(invoices))$old$;
 replacement:=$new$o.name in(select 'adjustments/'||e.id||v.suffix from finance_account_events e cross join (values ('.pdf'),('.design-v2.pdf')) v(suffix) where invoice_id=any(invoices))$new$;
 if position(original in definition)=0 then raise exception 'Adjustment cleanup definition changed; review migration'; end if;
 execute replace(definition,original,replacement);
end $$;
