import {accountPdf} from './customer-account-pdf.js';
import {archivedInvoiceDocument,missingStorageObject} from './invoice-archive.js';
export async function archivedAccountDocument({config,headers,invoice,event}){
 if(!event||event.kind==='credit')return archivedInvoiceDocument({config,headers,invoice,correction:event});
 const path=`adjustments/${event.id}.pdf`,url=`${config.url}/storage/v1/object/finance-documents/${path}`;
 const stored=await fetch(url,{headers});if(stored.ok)return Buffer.from(await stored.arrayBuffer());
 if(!await missingStorageObject(stored))throw new Error('Belegarchiv konnte nicht gelesen werden.');
 const bytes=await accountPdf({profile:{name:invoice.customer_name},today:event.booked_at},{event,invoice});
 const saved=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
 if(saved.status===409){const existing=await fetch(url,{headers});if(!existing.ok)throw new Error('Archivierter Beleg konnte nicht geladen werden.');return Buffer.from(await existing.arrayBuffer());}
 if(!saved.ok)throw new Error('Beleg konnte nicht archiviert werden.');return bytes;
}
