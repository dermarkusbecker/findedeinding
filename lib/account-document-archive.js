import {accountPdf} from './customer-account-pdf.js';
import {financePdf} from './finance-pdf.js';
export async function archivedAccountDocument({config,headers,invoice,event}){
 const path=event?`adjustments/${event.id}.pdf`:`invoices/${invoice.id}.pdf`,url=`${config.url}/storage/v1/object/finance-documents/${path}`;
 const stored=await fetch(url,{headers});if(stored.ok)return Buffer.from(await stored.arrayBuffer());
 if(stored.status!==404&&stored.status!==400)throw new Error('Belegarchiv konnte nicht gelesen werden.');
 const bytes=event?await accountPdf({profile:{name:invoice.customer_name},today:event.booked_at},{event,invoice}):await financePdf({invoice});
 const saved=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
 if(saved.status===409){const existing=await fetch(url,{headers});if(!existing.ok)throw new Error('Archivierter Beleg konnte nicht geladen werden.');return Buffer.from(await existing.arrayBuffer());}
 if(!saved.ok)throw new Error('Beleg konnte nicht archiviert werden.');return bytes;
}
