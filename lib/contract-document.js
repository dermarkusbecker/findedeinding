import { decodeCustomerUpload, deleteCustomerObject, uploadCustomerObject } from './customer-storage.js';

const headers = service => ({ apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' });

export async function attachSignedContractPdf(service, leadId, contractId, input) {
  const upload = decodeCustomerUpload(input || {}, 'documents');
  if (upload.mimeType !== 'application/pdf' || upload.buffer.length > 3 * 1024 * 1024 || upload.buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw Object.assign(new Error('Bitte ein unterschriebenes Vertrags-PDF bis 3 MB auswählen.'), { status: 400 });
  }
  const path = `lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&select=id,document_bucket,document_storage_path`;
  const currentResponse = await fetch(`${service.url}/rest/v1/${path}`, { headers: headers(service) });
  if (!currentResponse.ok) throw new Error('Vertragsdokument konnte nicht geprüft werden.');
  const current = (await currentResponse.json())[0];
  if (!current) throw new Error('Vertrag wurde nicht gefunden.');
  if (current.document_storage_path) return { bucket: current.document_bucket, storagePath: current.document_storage_path, alreadyStored: true };
  const stored = await uploadCustomerObject(service, 'documents', leadId, upload);
  try {
    const response = await fetch(`${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&document_storage_path=is.null`, { method: 'PATCH', headers: { ...headers(service), Prefer: 'return=representation' }, body: JSON.stringify({ document_bucket: stored.bucket, document_storage_path: stored.storagePath, document_mime_type: 'application/pdf', document_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) throw new Error('Vertrags-PDF konnte nicht mit der Akte verbunden werden.');
    return stored;
  } catch (error) {
    await deleteCustomerObject(service, stored.bucket, stored.storagePath).catch(() => null);
    throw error;
  }
}
