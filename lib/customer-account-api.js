import {archivedAccountDocument} from './account-document-archive.js';
import {customerAccount} from './customer-account.js';
import {accountPdf} from './customer-account-pdf.js';
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
// Called only after finance authorization in handleFinance. All queries are scoped to this customer.
export async function handleCustomerAccount(request,response,{query,all,user,today,config,headers}){
 const action=request.query.action,id=request.query.customerId||request.body?.customerId;
 if(!uuid(id))throw fail('Gültige Kunden-ID fehlt.');
 const profile=(await query(`user_profiles?id=eq.${id}&role=eq.user&select=id,name,customer_number,street,postal_code,city,country,source_lead_id`))[0];
 if(!profile)throw fail('Kunde nicht gefunden.',404);
 if(action==='finance-account-book'){
  if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
  const {kind,payload,requestKey}=request.body||{};
  if(!['claim','payment','credit','writeoff','due'].includes(kind)||!uuid(requestKey)||!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('Ungültige Buchung.');
  const result=await query('rpc/finance_account_book',{method:'POST',body:JSON.stringify({p_customer:id,p_kind:kind,p_payload:payload,p_request:requestKey,p_actor:user.profile?.id||user.name||'CRM-Administrator'})});
  let archivePending=false;
  try{
   if(kind==='claim'){
    const invoice=(await query(`finance_invoices?id=eq.${result.id}`))[0];await archivedAccountDocument({config,headers,invoice});await query(`finance_invoices?id=eq.${invoice.id}`,{method:'PATCH',body:JSON.stringify({pdf_path:`invoices/${invoice.id}.pdf`})});
   }else if(kind==='credit'){
    const event=(await query(`finance_account_events?id=eq.${result.id}`))[0],invoice=(await query(`finance_invoices?id=eq.${event.invoice_id}`))[0];await archivedAccountDocument({config,headers,invoice,event});
   }
  }catch{archivePending=true;}
  return response.json({ok:true,result,archivePending});
 }
 if(request.method!=='GET')throw fail('Methode nicht erlaubt.',405);
 const leads=await query(`leads?or=(converted_user_profile_id.eq.${id}${profile.source_lead_id?`,and(id.eq.${profile.source_lead_id},converted_user_profile_id.is.null)`:''})&select=id`);
 const scope=`lead_id=in.(${leads.map(l=>l.id).join(',')})`;
 const [invoices,payments,events,settings]=await Promise.all([leads.length?all(`finance_invoices?${scope}&select=*&order=id`):[],leads.length?all(`lead_payments?${scope}&select=*&order=id`):[],leads.length?all(`finance_account_events?${scope}&select=*&order=id`):[],query('finance_settings?id=eq.default')]);
 const account={...customerAccount({invoices,payments,events,today}),profile,settings:settings[0]};
 if(action==='finance-account-pdf'){
  const bytes=await accountPdf(account);response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`attachment; filename="Kontoauszug-${(profile.customer_number||id).replace(/[^a-zA-Z0-9-]/g,'')}-${today}.pdf"`);return response.send(bytes);
 }
 if(action==='finance-account-document'){
  if(!uuid(request.query.id))throw fail('Ungültiger Beleg.');
  const event=events.find(e=>e.id===request.query.id);if(!event)throw fail('Beleg nicht gefunden.',404);
  const bytes=await archivedAccountDocument({config,headers,event,invoice:invoices.find(i=>i.id===event.invoice_id)});response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`inline; filename="${event.document_number}.pdf"`);return response.send(bytes);
 }
 const requests=await all(`finance_account_requests?customer_id=eq.${id}&select=actor,result&order=created_at,request_key`);
 for(const entry of account.entries){const recorded=requests.find(r=>r.result?.id===entry.id);if(!entry.actor&&recorded)entry.actor=recorded.actor;}
 const actorIds=[...new Set(account.entries.map(e=>e.actor).filter(uuid))];
 const names=actorIds.length?await query(`user_profiles?id=in.(${actorIds.join(',')})&select=id,name`):[];
 for(const entry of account.entries)entry.actorName=names.find(n=>n.id===entry.actor)?.name||(entry.actor&&!uuid(entry.actor)?entry.actor:null);
 return response.json({account});
}
