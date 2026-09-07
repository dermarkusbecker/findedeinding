import crypto from 'node:crypto';
import { supabaseAuthConfig } from './user-auth.js';
import { buildVideoContractPdf, normalizeVideoContract } from './video-contract.js';
import { deleteCustomerObject, signedCustomerUrl, uploadCustomerObject } from './customer-storage.js';

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
const tokenHash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

async function readJson(result, message) {
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data.message || data.error || message), { status: result.status });
  return data;
}

async function contractForToken(service, token) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(String(token || ''))) throw Object.assign(new Error('Der Signaturlink ist ungültig.'), { status: 400 });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?signing_token_hash=eq.${tokenHash(token)}&select=*&limit=1`, { headers: headers(service.key) }), 'Der Vertrag konnte nicht geladen werden.');
  const contract = rows[0];
  if (!contract) throw Object.assign(new Error('Der Signaturlink wurde nicht gefunden.'), { status: 404 });
  if (contract.signing_expires_at && new Date(contract.signing_expires_at).getTime() < Date.now()) throw Object.assign(new Error('Der Signaturlink ist abgelaufen. Bitte fordere einen neuen Link an.'), { status: 410 });
  const leads = await readJson(await fetch(`${service.url}/rest/v1/leads?id=eq.${encodeURIComponent(contract.lead_id)}&select=id,name,email,converted_user_profile_id&limit=1`, { headers: headers(service.key) }), 'Die Vertragszuordnung konnte nicht geladen werden.');
  if (!leads[0]) throw Object.assign(new Error('Die Vertragszuordnung fehlt.'), { status: 404 });
  return { contract, lead: leads[0] };
}

async function attachToParticipant(service, lead, contract, pdf, sha256) {
  if (!lead.converted_user_profile_id) return;
  const existing = await readJson(await fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${encodeURIComponent(lead.converted_user_profile_id)}&document_type=eq.video_contract&select=id,storage_bucket,storage_path&limit=1`, { headers: headers(service.key) }), 'Dokumentenablage konnte nicht geprüft werden.');
  const payload = {
    user_profile_id: lead.converted_user_profile_id, week: 0, document_type: 'video_contract',
    display_title: 'Finde-dein-Ding Videovertrag', original_file_name: `${contract.contract_number || 'FDD-Videovertrag'}.pdf`,
    mime_type: 'application/pdf', byte_size: pdf.length, storage_bucket: contract.document_bucket,
    storage_path: contract.document_storage_path, sha256, source: 'system', visibility: 'customer',
    processing_status: 'ready', participant_confirmed_at: contract.customer_signed_at, updated_at: new Date().toISOString(),
  };
  if (existing[0]) await readJson(await fetch(`${service.url}/rest/v1/participant_documents?id=eq.${encodeURIComponent(existing[0].id)}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify(payload) }), 'Vertrag konnte nicht bei Dokumente aktualisiert werden.');
  else await readJson(await fetch(`${service.url}/rest/v1/participant_documents`, { method: 'POST', headers: headers(service.key), body: JSON.stringify(payload) }), 'Vertrag konnte nicht bei Dokumente abgelegt werden.');
}

export async function handlePublicContractSign(request, response) {
  const auth = supabaseAuthConfig();
  if (!auth?.serviceKey) return response.status(503).json({ error: 'Der sichere Vertragsdienst ist noch nicht konfiguriert.' });
  const service = { ...auth, key: auth.serviceKey };
  try {
    const { contract, lead } = await contractForToken(service, request.query?.token || request.body?.token);
    if (request.method === 'GET') {
      const pdfUrl = await signedCustomerUrl(service, contract.document_bucket, contract.document_storage_path, 900);
      return response.status(200).json({
        contract: { title: contract.title, contractNumber: contract.contract_number, customerName: contract.contract_data?.customerName || lead.name, customerEmail: lead.email, contractDate: contract.contract_data?.contractDate, place: contract.contract_data?.place, customerSignedAt: contract.customer_signed_at },
        pdfUrl,
      });
    }
    if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    if (contract.customer_signed_at) return response.status(409).json({ error: 'Dieser Vertrag wurde bereits digital bestätigt.' });
    const signatureName = String(request.body?.signatureName || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    if (!signatureName || request.body?.contractAccepted !== true || request.body?.immediateStartAccepted !== true || request.body?.digitalContentAccepted !== true) return response.status(400).json({ error: 'Bitte Name und alle drei ausdrücklichen Bestätigungen vollständig angeben.' });
    const normalized = normalizeVideoContract(contract.contract_data || {}, lead);
    if (normalized.missing.length) return response.status(409).json({ error: 'Der Vertrag ist unvollständig und muss zuerst durch Finde dein Ding korrigiert werden.' });
    normalized.contract.customerName = signatureName;
    const pdf = await buildVideoContractPdf(normalized.contract, { videoConfirmed: true, customerSigned: true, providerConfirmed: true });
    const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const upload = await uploadCustomerObject(service, 'documents', lead.id, { buffer: pdf, fileName: `${contract.contract_number || 'FDD-Videovertrag'}-digital-bestaetigt.pdf`, mimeType: 'application/pdf', sha256 });
    const now = new Date().toISOString();
    const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contract.id)}&customer_signed_at=is.null`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ customer_signed_at: now, customer_signature_name: signatureName, signature_method: 'video_and_customer_click_confirmation', document_bucket: upload.bucket, document_storage_path: upload.storagePath, document_mime_type: 'application/pdf', contract_data: normalized.contract, updated_at: now }) }), 'Die digitale Bestätigung konnte nicht gespeichert werden.');
    if (!rows[0]) throw Object.assign(new Error('Der Vertrag wurde bereits bestätigt oder zwischenzeitlich geändert.'), { status: 409 });
    if (contract.document_bucket && contract.document_storage_path !== upload.storagePath) await deleteCustomerObject(service, contract.document_bucket, contract.document_storage_path);
    await attachToParticipant(service, lead, rows[0], pdf, sha256);
    await fetch(`${service.url}/rest/v1/lead_communications`, { method: 'POST', headers: headers(service.key), body: JSON.stringify({ lead_id: lead.id, direction: 'system', channel: 'email', subject: 'Videovertrag zusätzlich digital bestätigt', preview: `${signatureName} hat den Vertrag per ausdrücklichem Klick bestätigt.`, delivery_status: 'system' }) }).catch(() => null);
    const pdfUrl = await signedCustomerUrl(service, rows[0].document_bucket, rows[0].document_storage_path, 900);
    return response.status(200).json({ ok: true, customerSignedAt: now, pdfUrl });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Der Vertrag konnte nicht verarbeitet werden.' });
  }
}
