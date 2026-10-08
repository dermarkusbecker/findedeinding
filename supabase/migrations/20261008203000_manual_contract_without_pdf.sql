insert into public.communication_templates(template_key,name,description,category,channel,subject,body,status)
values ('contract_signed_summary','Automatisch: Vertragsbestätigung ohne PDF-Anhang','Manuell bestätigter Abschluss; das unterschriebene PDF liegt beim Anbieter vor, wurde aber nicht hochgeladen.','contract','email','Deine Vertragsbestätigung {{vertragsnummer}} und Tarifkonditionen',E'Hallo {{vorname}},\n\nvielen Dank für dein Vertrauen. Wir bestätigen den Abschluss deines Vertrags {{vertragsnummer}} für {{tarif}}. Das unterschriebene Vertragsdokument liegt uns vor. In dieser E-Mail ist kein Vertrags-PDF angehängt.\n\nVereinbart sind {{laufzeit}} Laufzeit, ein Gesamtpreis von {{preis}} und das Zahlungsmodell {{zahlungsmodell}}. {{faellig}}\n\nWeitere individuelle Abreden: {{zusatzabreden}}\n\nDeine Rechnung erhältst du in einer separaten E-Mail als PDF. Wenn du eine Kopie des unterschriebenen Vertrags benötigst, antworte bitte auf diese Nachricht.','active')
on conflict(template_key) do nothing;

create or replace function public.create_lead_manual_contract(p_lead uuid,p_tariff uuid,p_start date,p_request uuid,p_expected_gross numeric,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l leads; t service_tariffs; c lead_contracts; i finance_invoices; s finance_settings; address_street text;
begin
 if p_request is null or p_start is null or p_lead is null then raise exception 'Anfrage-ID, Interessent und Programmstart fehlen'; end if;
 select * into l from leads where id=p_lead for update;
 if l.id is null then raise exception 'Interessent nicht gefunden'; end if;
 select * into c from lead_contracts where manual_request_id=p_request;
 if c.id is not null then
  if c.lead_id<>p_lead or c.tariff_id<>p_tariff or c.program_start_date<>p_start then raise exception 'Anfrage-ID gehört zu einem anderen Vertrag'; end if;
  select * into i from finance_invoices where contract_id=c.id;
  return jsonb_build_object('contract_id',c.id,'lead_id',l.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'replayed',true);
 end if;
 select * into t from service_tariffs where id=p_tariff and is_active for share;
 if t.id is null or t.gross_price<>p_expected_gross then raise exception 'Tarif oder Betrag wurde geändert. Bitte die Maske neu öffnen'; end if;
 address_street:=concat_ws(' ',nullif(trim(l.street_name),''),nullif(trim(l.house_number),''));
 if nullif(trim(l.name),'') is null or nullif(trim(address_street),'') is null or nullif(trim(l.postal_code),'') is null or nullif(trim(l.city),'') is null then raise exception 'Bitte zuerst die vollständige Rechnungsanschrift beim Interessenten ergänzen'; end if;
 select * into s from finance_settings where id='default';
 if s.id is null or nullif(trim(s.issuer_name),'') is null or nullif(trim(s.issuer_address),'') is null or nullif(trim(s.tax_id),'') is null then raise exception 'Bitte zuerst die Rechnungsstellerdaten vervollständigen'; end if;
 insert into lead_contracts(lead_id,tariff_id,title,amount,status,signed_at,document_confirmed_at,program_start_date,manual_request_id,contract_data)
 values(l.id,t.id,t.product_label,t.gross_price,'signed',now(),now(),p_start,p_request,
 jsonb_build_object('source','manual_lead_contract','recordedBy',p_actor,'recordedAt',now(),'manualSignedPdfConfirmed',true,'customerName',l.name,'customerEmail',l.email,'street',address_street,'postalCity',l.postal_code||' '||l.city,'tariffId',t.id,'tariffName',t.name,'product',t.product_label,'duration',t.duration_label,'paymentModel',t.payment_model,'paymentDue',t.payment_due,'additionalAgreements',t.additional_agreements,'serviceStart',p_start)) returning * into c;
 select * into i from finance_invoices where contract_id=c.id;
 if i.id is null or i.status<>'issued' then raise exception 'Rechnung konnte nicht ausgestellt werden. Es wurde kein Vertrag angelegt'; end if;
 return jsonb_build_object('contract_id',c.id,'lead_id',l.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'replayed',false);
end $$;
revoke all on function public.create_lead_manual_contract(uuid,uuid,date,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.create_lead_manual_contract(uuid,uuid,date,uuid,numeric,text) to service_role;
