import {handleCustomerAccount} from './customer-account-api.js';
import {archivedAccountDocument} from './account-document-archive.js';
import {requireCurrentAdmin,requireCurrentPermission,authHeaders,supabaseAuthConfig} from './user-auth.js';
import {invoiceBalances,financeReport} from './finance.js';
import {financePdf} from './finance-pdf.js';
const validId=v=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(v));
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function handleFinance(request,response){
 const action=request.query?.action||'',portal=action==='finance-my-invoices'||action==='finance-my-pdf'||action==='finance-my-credit-pdf';
 const user=portal?await requireCurrentPermission('customer_portal')(request,response):await requireCurrentAdmin(request,response,action==='finance-settings'?'settings':'finance');if(!user)return;
 const config=supabaseAuthConfig(),headers=authHeaders(config.serviceKey),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
 response.setHeader('Cache-Control','private, no-store');
 const query=async(path,options={})=>{const result=await fetch(`${config.url}/rest/v1/${path}`,{...options,headers:{...headers,Prefer:'return=representation',...options.headers}}),data=await result.json().catch(()=>null);if(!result.ok)throw fail(data?.message||'Finanzdaten konnten nicht geladen werden.',result.status);return data;};
 const all=async(path)=>{let result=[];for(let offset=0;;offset+=500){const page=await query(`${path}&limit=500&offset=${offset}`);result.push(...page);if(page.length<500)return result;}};
 try{
  if(action.startsWith('finance-account'))return await handleCustomerAccount(request,response,{query,all,user,today,config,headers});
  if(action==='finance-settings'){
   if(request.method==='GET')return response.json({settings:(await query('finance_settings?id=eq.default'))[0]});
   if(request.method!=='PATCH')throw fail('Methode nicht erlaubt.',405);
   const b=request.body||{},rate=Number(b.vat_rate),days=Number(b.payment_days);
   if(!Number.isFinite(rate)||rate<0||rate>100||!Number.isInteger(days)||days<0||days>365)throw fail('Bitte einen gültigen Steuersatz und ein gültiges Zahlungsziel eingeben.');
   const payload={vat_rate:Math.round(rate*100)/100,payment_days:days,updated_at:new Date().toISOString()};
   for(const field of ['issuer_name','issuer_address','tax_id','iban'])payload[field]=String(b[field]||'').trim().slice(0,500);
   if(!payload.issuer_name||!payload.issuer_address)throw fail('Name und Anschrift des Rechnungsstellers fehlen.');
   return response.json({settings:(await query('finance_settings?id=eq.default',{method:'PATCH',body:JSON.stringify(payload)}))[0]});
  }
  if(action==='finance-assign-payment'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   if(!validId(request.body?.paymentId)||!validId(request.body?.invoiceId))throw fail('Ungültige Zuordnung.');
   await query('rpc/finance_assign_payment',{method:'POST',body:JSON.stringify({payment:request.body.paymentId,invoice:request.body.invoiceId})});return response.json({ok:true});
  }
  if(action==='finance-payment'){
   if(request.method!=='POST')throw fail('Methode nicht erlaubt.',405);
   const b=request.body||{},amount=Number(b.amount);
   if(!validId(b.invoiceId)||!validId(b.requestKey)||!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>0.00001||!/^\d{4}-\d{2}-\d{2}$/.test(b.date||''))throw fail('Ungültige Zahlungsangaben.');
   await query('rpc/finance_book_payment',{method:'POST',body:JSON.stringify({invoice:b.invoiceId,amount_value:amount,paid_on:b.date,reference_value:String(b.reference||'').slice(0,200),request_key:b.requestKey})});return response.json({ok:true});
  }
  if(request.method!=='GET')throw fail('Methode nicht erlaubt.',405);
  let filter='';
  if(portal){if(user.role==='admin')throw fail('Bitte Rechnungen über die Kundenakte aufrufen.',403);const leads=await query(`leads?converted_user_profile_id=eq.${user.profile.id}&select=id`);if(!leads.length){if(action.endsWith('pdf'))throw fail('Rechnung nicht gefunden.',404);return response.json({invoices:[]});}filter=`&lead_id=in.(${leads.map(l=>l.id).join(',')})&status=eq.issued`;}
  else if(request.query.customerId){if(!validId(request.query.customerId))throw fail('Ungültiger Kunde.');const leads=await query(`leads?converted_user_profile_id=eq.${request.query.customerId}&select=id`);if(!leads.length)return response.json({invoices:[],payments:[]});filter=`&lead_id=in.(${leads.map(l=>l.id).join(',')})`;}
  if(action==='finance-my-credit-pdf'||action==='finance-adjustment-pdf'){
   if(!validId(request.query.id))throw fail('Ungültiger Beleg.');
   const event=(await query(`finance_account_events?id=eq.${request.query.id}${portal?'&kind=eq.credit':''}${filter.replace('&status=eq.issued','')}`))[0];if(!event)throw fail('Beleg nicht gefunden.',404);
   const invoice=(await query(`finance_invoices?id=eq.${event.invoice_id}${filter}`))[0];if(!invoice)throw fail('Beleg nicht gefunden.',404);
   const bytes=await archivedAccountDocument({config,headers,event,invoice});response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`inline; filename="${event.document_number}.pdf"`);return response.send(bytes);
  }
  if(action.endsWith('pdf')&&!validId(request.query.id))throw fail('Ungültige Rechnung.');
  const invoices=await all(`finance_invoices?select=*,contract:lead_contracts(contract_number)&order=created_at.desc,id${filter}${action.endsWith('pdf')?`&id=eq.${request.query.id}`:''}`);
  if(action.endsWith('pdf')){
   const invoice=invoices[0];if(!invoice||invoice.status!=='issued')throw fail('Keine ausgestellte Rechnung gefunden.',404);
   const path=`invoices/${invoice.id}.pdf`,url=`${config.url}/storage/v1/object/finance-documents/${path}`;
   let bytes;const stored=await fetch(url,{headers});
   if(stored.ok)bytes=Buffer.from(await stored.arrayBuffer());else if(stored.status===404||stored.status===400){bytes=await financePdf({invoice});const saved=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});if(!saved.ok&&saved.status!==409)throw fail('Rechnungs-PDF konnte nicht archiviert werden.',503);await query(`finance_invoices?id=eq.${invoice.id}`,{method:'PATCH',body:JSON.stringify({pdf_path:path})});}else throw fail('Archiv konnte nicht gelesen werden.',503);
   response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`${request.query.download==='1'?'attachment':'inline'}; filename="${invoice.invoice_number}.pdf"`);return response.send(bytes);
  }
  const payments=portal?(invoices.length?await all(`lead_payments?select=id,invoice_id,amount,status,booked_at&order=id&invoice_id=in.(${invoices.map(i=>i.id).join(',')})`):[]):await all('lead_payments?select=*&order=id');
  const events=invoices.length?await all(`finance_account_events?select=*&order=id${filter.replace('&status=eq.issued','')}`):[];
  const balances=invoiceBalances(invoices,payments,today,events);
  if(portal)return response.json({credits:events.filter(e=>e.kind==='credit').map(({id,document_number,invoice_id,booked_at,amount,reason})=>({id,document_number,invoice_id,booked_at,amount,reason})),invoices:balances.map(({id,invoice_number,invoice_date,due_date,gross,net,vat,paid,open,payment_status,description})=>({id,invoice_number,invoice_date,due_date,gross,net,vat,paid,open,payment_status,description}))});
  if(action==='finance-report'){
   const report=financeReport(invoices,payments,{year:request.query.year,month:request.query.month||0,today,events});
   if(request.query.format!=='pdf')return response.json({report});
   const bytes=await financePdf({report,details:request.query.details==='1'});response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`attachment; filename="Finanzuebersicht-${report.from}-${report.to}.pdf"`);return response.send(bytes);
  }
  return response.json({events,invoices:balances,payments:request.query.customerId?payments.filter(p=>invoices.some(i=>i.lead_id===p.lead_id)):payments,today,settings:(await query('finance_settings?id=eq.default'))[0]});
 }catch(error){return response.status(error.status||500).json({error:error.message});}
}
