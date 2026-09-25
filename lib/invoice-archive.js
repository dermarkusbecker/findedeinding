import {financePdf} from './finance-pdf.js';
export async function missingStorageObject(response) {
 if(response.status===404)return true;
 if(response.status!==400)return false;
 const body=await response.clone().json().catch(()=>null);
 return String(body?.statusCode)==='404'||body?.code==='NoSuchKey';
}
// Original evidence and the redesigned representation are separate, immutable objects.
export async function archivedInvoiceDocument({config,headers,invoice,correction,original=false,fetcher=fetch}) {
 const base=`${config.url}/storage/v1/object/finance-documents/`,stem=correction?`adjustments/${correction.id}`:`invoices/${invoice.id}`,originalPath=`${stem}.pdf`,designPath=`${stem}.design-v2.pdf`;
 const get=async path=>{
  const r=await fetcher(base+path,{headers});if(r.ok)return Buffer.from(await r.arrayBuffer());
  if(!await missingStorageObject(r))throw new Error('Rechnungsarchiv konnte nicht gelesen werden.');return null;
 };
 const put=async(path,bytes)=>{
  const r=await fetcher(base+path,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
  if(r.status===409){const existing=await get(path);if(!existing)throw new Error('Archivierter Beleg fehlt.');return existing;}
  if(!r.ok)throw new Error('Rechnungs-PDF konnte nicht archiviert werden.');return bytes;
 };
 if(original){const existing=await get(originalPath);if(existing)return existing;return put(originalPath,await financePdf({invoice,correction}));}
 const designed=await get(designPath);if(designed)return designed;
 const bytes=await financePdf({invoice,correction});
 // A historical original is never replaced by a design update.
 if(!await get(originalPath))await put(originalPath,bytes);
 return put(designPath,bytes);
}
