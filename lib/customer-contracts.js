import {archiveLeadInvoices} from './finance-archive.js';
import {sendSignedContractMail} from './contract-mail.js';
import {attachSignedContractPdf} from './contract-document.js';
import {decodeCustomerUpload} from './customer-storage.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
export async function handleCustomerContracts(service,context,request,response){
 if(!context.admin)throw fail('Verträge können nur im CRM angelegt werden.',403);
 const headers={apikey:service.key,Authorization:`Bearer ${service.key}`,'Content-Type':'application/json'};
 const query=async(path,options={})=>{const result=await fetch(`${service.url}/rest/v1/${path}`,{...options,headers:{...headers,...(options.headers||{})}});const data=await result.json();if(!result.ok)throw fail(data.message||'Vertrag konnte nicht gespeichert werden.',result.status>=500?503:400);return data;};
 if(request.method==='GET')return response.json({tariffs:await query('service_tariffs?is_active=eq.true&select=*&order=is_default.desc,sort_order.asc,name.asc')});
 if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
 const b=request.body||{},day=b.serviceStart,price=Number(b.expectedGross);
 if(b.status==='draft'){
  if(!uuid(b.tariffId)||!uuid(b.requestKey)||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||!Number.isFinite(price)||price<0)throw fail('Aktiven Tarif und gültigen Leistungsbeginn angeben.');
  const [existing]=await query(`lead_contracts?manual_request_id=eq.${b.requestKey}&select=*&limit=1`);
  if(existing){if(existing.status!=='draft'||existing.tariff_id!==b.tariffId||existing.program_start_date!==day)throw fail('Anfrage-ID gehört zu einem anderen Vertrag.',409);return response.status(200).json({contract_id:existing.id,lead_id:existing.lead_id,draft:true,replayed:true});}
  const [profile]=await query(`user_profiles?id=eq.${context.participantId}&role=eq.user&select=id,name,email,street,postal_code,city,country,source_lead_id&limit=1`);
  if(!profile)throw fail('Kundenprofil wurde nicht gefunden.',404);
  const linked=await query(`leads?or=(converted_user_profile_id.eq.${context.participantId}${profile.source_lead_id?`,id.eq.${profile.source_lead_id}`:''})&select=id,converted_user_profile_id&order=created_at&limit=20`);
  const lead=linked.find(item=>item.converted_user_profile_id===context.participantId)||linked.find(item=>item.id===profile.source_lead_id&&!item.converted_user_profile_id);
  if(!lead)throw fail('Verknüpfte Kundenakte fehlt.',409);
  const [tariff]=await query(`service_tariffs?id=eq.${b.tariffId}&is_active=eq.true&select=*&limit=1`);
  if(!tariff||Number(tariff.gross_price)!==price)throw fail('Tarifpreis wurde geändert. Bitte neu laden.',409);
  const contractData={source:'manual_customer_draft',customerName:profile.name,customerEmail:profile.email,street:profile.street,postalCity:[profile.postal_code,profile.city].filter(Boolean).join(' '),country:profile.country,tariffId:tariff.id,tariffName:tariff.name,product:tariff.product_label,duration:tariff.duration_label,paymentModel:tariff.payment_model,paymentDue:tariff.payment_due,additionalAgreements:tariff.additional_agreements,serviceStart:day};
  const [draft]=await query('lead_contracts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({lead_id:lead.id,tariff_id:tariff.id,title:tariff.product_label,amount:tariff.gross_price,status:'draft',program_start_date:day,manual_request_id:b.requestKey,contract_data:contractData})});
  return response.status(201).json({contract_id:draft.id,lead_id:lead.id,draft:true});
 }
 const document=decodeCustomerUpload(b.signedDocument||{},'documents');
 if(document.mimeType!=='application/pdf'||document.buffer.length>3*1024*1024||document.buffer.subarray(0,5).toString()!=='%PDF-')throw fail('Bitte ein unterschriebenes Vertrags-PDF bis 3 MB hochladen.');
 if(!uuid(b.tariffId)||!uuid(b.requestKey)||b.confirmed!==true||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||!Number.isFinite(price)||price<0)throw fail('Aktiven Tarif, gültigen Leistungsbeginn und bestätigten Vertragsabschluss angeben.');
 const result=await query('rpc/create_customer_contract',{method:'POST',body:JSON.stringify({p_customer:context.participantId,p_tariff:b.tariffId,p_start:day,p_request:b.requestKey,p_expected_gross:price,p_actor:context.profile?.id||context.name||'CRM-Administrator'})});
 await attachSignedContractPdf(service,result.lead_id,result.contract_id,b.signedDocument);
 let archivePending=false;
 try{await archiveLeadInvoices(service,result.lead_id);}catch{archivePending=true;}
 let mailStatus=null;
 try{mailStatus=await sendSignedContractMail(service,{leadId:result.lead_id,contractId:result.contract_id,actor:context.profile?.name||context.name||'CRM-Administrator'});}catch(error){mailStatus={error:error.message};}
 return response.status(201).json({...result,archivePending,mailStatus});
}
