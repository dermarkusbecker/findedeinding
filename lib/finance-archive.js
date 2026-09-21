import {financePdf} from './finance-pdf.js';
export async function archiveLeadInvoices(service,leadId){
 const headers={apikey:service.key,Authorization:`Bearer ${service.key}`,'Content-Type':'application/json'};
 const ready=await fetch(`${service.url}/rest/v1/rpc/finance_issue_ready`,{method:'POST',headers,body:'{}'});if(!ready.ok)throw new Error('Rechnungsfreigabe konnte nicht geprüft werden.');
 const response=await fetch(`${service.url}/rest/v1/finance_invoices?lead_id=eq.${encodeURIComponent(leadId)}&status=eq.issued&pdf_path=is.null&select=*`,{headers});if(!response.ok)throw new Error('Rechnungsarchiv konnte nicht geladen werden.');
 for(const invoice of await response.json()){
  const path=`invoices/${invoice.id}.pdf`,bytes=await financePdf({invoice});
  const stored=await fetch(`${service.url}/storage/v1/object/finance-documents/${path}`,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
  if(!stored.ok&&stored.status!==409)throw new Error('Rechnung erstellt, PDF-Archivierung steht noch aus.');
  const saved=await fetch(`${service.url}/rest/v1/finance_invoices?id=eq.${invoice.id}`,{method:'PATCH',headers,body:JSON.stringify({pdf_path:path})});if(!saved.ok)throw new Error('Rechnungsbeleg konnte nicht verknüpft werden.');
 }
}
