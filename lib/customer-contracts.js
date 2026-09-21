import {archiveLeadInvoices} from './finance-archive.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
export async function handleCustomerContracts(service,context,request,response){
 if(!context.admin)throw fail('Verträge können nur im CRM angelegt werden.',403);
 const headers={apikey:service.key,Authorization:`Bearer ${service.key}`,'Content-Type':'application/json'};
 const query=async(path,options={})=>{const result=await fetch(`${service.url}/rest/v1/${path}`,{...options,headers});const data=await result.json();if(!result.ok)throw fail(data.message||'Vertrag konnte nicht gespeichert werden.',result.status>=500?503:400);return data;};
 if(request.method==='GET')return response.json({tariffs:await query('service_tariffs?is_active=eq.true&select=*&order=is_default.desc,sort_order.asc,name.asc')});
 if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
 const b=request.body||{},day=b.serviceStart,price=Number(b.expectedGross);
 if(!uuid(b.tariffId)||!uuid(b.requestKey)||b.confirmed!==true||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||!Number.isFinite(price)||price<0)throw fail('Aktiven Tarif, gültigen Leistungsbeginn und bestätigten Vertragsabschluss angeben.');
 const result=await query('rpc/create_customer_contract',{method:'POST',body:JSON.stringify({p_customer:context.participantId,p_tariff:b.tariffId,p_start:day,p_request:b.requestKey,p_expected_gross:price,p_actor:context.profile?.id||context.name||'CRM-Administrator'})});
 let archivePending=false;
 try{await archiveLeadInvoices(service,result.lead_id);}catch{archivePending=true;}
 return response.status(201).json({...result,archivePending});
}
