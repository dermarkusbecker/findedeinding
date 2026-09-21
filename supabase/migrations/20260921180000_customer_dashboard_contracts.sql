-- Manual contract capture is atomic with the existing invoice triggers.
-- The request id prevents duplicate contracts/invoices after a timeout or retry.
alter table public.lead_contracts add column if not exists manual_request_id uuid unique;
create or replace function public.create_customer_contract(p_customer uuid,p_tariff uuid,p_start date,p_request uuid,p_expected_gross numeric,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p user_profiles; t service_tariffs; l leads; c lead_contracts; i finance_invoices; s finance_settings;
begin
 if p_request is null or p_start is null then raise exception 'Anfrage-ID und Leistungsbeginn fehlen'; end if;
 select * into p from user_profiles where id=p_customer and role='user' for update;
 if p.id is null then raise exception 'Kunde nicht gefunden'; end if;
 select * into c from lead_contracts where manual_request_id=p_request;
 if c.id is not null then
  if not exists(select 1 from leads where id=c.lead_id and converted_user_profile_id=p_customer) or c.tariff_id<>p_tariff or c.program_start_date<>p_start then raise exception 'Anfrage-ID gehört zu einem anderen Vertragsabschluss'; end if;
  select * into i from finance_invoices where contract_id=c.id;
  return jsonb_build_object('contract_id',c.id,'lead_id',c.lead_id,'invoice_id',i.id,'invoice_number',i.invoice_number,'replayed',true);
 end if;
 select * into t from service_tariffs where id=p_tariff and is_active for share;
 if t.id is null then raise exception 'Bitte einen aktiven Tarif aus den Einstellungen auswählen'; end if;
 if p_expected_gross is null or t.gross_price<>p_expected_gross then raise exception 'Der Tarifpreis wurde geändert. Bitte den Dialog erneut öffnen und den aktuellen Preis prüfen'; end if;
 if coalesce(trim(p.name),'')='' or coalesce(trim(p.street),'')='' or coalesce(trim(p.postal_code),'')='' or coalesce(trim(p.city),'')='' then raise exception 'Bitte zuerst Name und vollständige Rechnungsanschrift in den Kundendaten ergänzen'; end if;
 select * into s from finance_settings where id='default';
 if s.id is null or trim(s.issuer_name)='' or trim(s.issuer_address)='' or trim(s.tax_id)='' then raise exception 'Bitte zuerst die Rechnungsstellerdaten unter Einstellungen vervollständigen'; end if;
 select * into l from leads where converted_user_profile_id=p_customer or (id=p.source_lead_id and converted_user_profile_id is null) order by created_at limit 1 for update;
 if l.id is null then
  raise exception 'Keine verknüpfte Kundenakte gefunden. Bitte zuerst den bestehenden Interessenten dem Kunden zuordnen';
 elsif l.converted_user_profile_id is null then
  update leads set converted_user_profile_id=p_customer,status='customer',converted_at=now() where id=l.id;
 end if;
 if p.source_lead_id is null then update user_profiles set source_lead_id=l.id where id=p_customer; end if;
 insert into lead_contracts(lead_id,tariff_id,title,amount,status,signed_at,program_start_date,manual_request_id,contract_data)
 values(l.id,t.id,t.product_label,t.gross_price,'signed',now(),p_start,p_request,
  jsonb_build_object('source','manual_customer_contract','recordedBy',p_actor,'recordedAt',now(),'completionConfirmed',true,'customerName',p.name,'street',p.street,'postalCity',p.postal_code||' '||p.city,'country',p.country,'tariffId',t.id,'tariffName',t.name,'product',t.product_label,'duration',t.duration_label,'paymentModel',t.payment_model,'paymentDue',t.payment_due,'additionalAgreements',t.additional_agreements,'serviceStart',p_start)) returning * into c;
 select * into i from finance_invoices where contract_id=c.id;
 if i.id is null or i.status<>'issued' then raise exception 'Rechnung konnte nicht ausgestellt werden. Es wurde kein Vertrag angelegt'; end if;
 return jsonb_build_object('contract_id',c.id,'lead_id',l.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'replayed',false);
end $$;
revoke all on function public.create_customer_contract(uuid,uuid,date,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.create_customer_contract(uuid,uuid,date,uuid,numeric,text) to service_role;
