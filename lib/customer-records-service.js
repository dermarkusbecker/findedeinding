import { sessionFromRequest } from './auth.js';
import { decodeCustomerUpload, deleteCustomerObject, signedCustomerUrl, uploadCustomerObject } from './customer-storage.js';
import { requireCurrentAdmin, requireCurrentPermission, supabaseAuthConfig } from './user-auth.js';

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

async function rows(response, fallback, optional = false) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok && optional && (response.status === 404 || ['PGRST205', '42P01'].includes(data?.code))) return [];
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || fallback), { status: response.status });
  return data;
}

async function authorize(request, response, permission = 'customers') {
  const raw = sessionFromRequest(request);
  if (!raw) { response.status(401).json({ error: 'Nicht angemeldet.' }); return null; }
  if (raw.role === 'admin') {
    const admin = await requireCurrentAdmin(request, response, permission);
    if (!admin) return null;
    const participantId = request.query?.participantId || request.body?.participantId;
    if (!uuid(participantId)) { response.status(400).json({ error: 'Gültige Kunden-ID fehlt.' }); return null; }
    return { ...admin, participantId, admin: true };
  }
  const participant = await requireCurrentPermission('customer_portal')(request, response);
  return participant ? { ...participant, participantId: participant.participantId, admin: false } : null;
}

async function customerData(service, participantId) {
  const id = encodeURIComponent(participantId);
  const profileRows = await rows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${id}&role=eq.user&select=id,name,email,birth_date,street,postal_code,city,country,phone,mobile_phone,whatsapp_phone,whatsapp_same_as_mobile,preferred_communication_channel,postal_mail_active,profile_photo_path,portal_username,customer_number&limit=1`, { headers: headers(service.key) }), 'Kundenprofil konnte nicht geladen werden.');
  const profile = profileRows[0];
  if (!profile) throw Object.assign(new Error('Kunde wurde nicht gefunden.'), { status: 404 });
  const leadRows = await rows(await fetch(`${service.url}/rest/v1/leads?converted_user_profile_id=eq.${id}&select=*&limit=1`, { headers: headers(service.key) }), 'Verknüpfte Kundenakte konnte nicht geladen werden.');
  const lead = leadRows[0] || null;
  const leadFilter = lead ? `lead_id=eq.${encodeURIComponent(lead.id)}` : '';
  const requests = [
    fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${id}&select=id,week,document_type,display_title,original_file_name,mime_type,byte_size,source,visibility,processing_status,created_at&order=created_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/customer_appointments?user_profile_id=eq.${id}&select=*&order=starts_at.desc`, { headers: headers(service.key) }),
  ];
  if (lead) requests.push(
    fetch(`${service.url}/rest/v1/lead_contracts?${leadFilter}&select=*&order=created_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_payments?${leadFilter}&select=*&order=booked_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_communications?${leadFilter}&select=*&order=occurred_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_bank_accounts?${leadFilter}&select=*&limit=1`, { headers: headers(service.key) }),
  );
  const result = await Promise.all(requests);
  const documents = await rows(result[0], 'Dokumente konnten nicht geladen werden.', true);
  const appointments = await rows(result[1], 'Termine konnten nicht geladen werden.', true);
  const contracts = lead ? await rows(result[2], 'Verträge konnten nicht geladen werden.') : [];
  const payments = lead ? await rows(result[3], 'Zahlungen konnten nicht geladen werden.') : [];
  const communications = lead ? await rows(result[4], 'Nachrichten konnten nicht geladen werden.') : [];
  const bankAccounts = lead ? await rows(result[5], 'Kontodaten konnten nicht geladen werden.') : [];
  if (lead?.appointment_start && !appointments.some((item) => item.google_event_id && item.google_event_id === lead.calendar_event_id)) appointments.push({ id: `lead-${lead.id}`, title: 'Kundengespräch', starts_at: lead.appointment_start, ends_at: lead.appointment_end, timezone: lead.appointment_timezone, google_event_id: lead.calendar_event_id, google_event_url: lead.calendar_event_url, meet_url: lead.meet_url, status: new Date(lead.appointment_end || lead.appointment_start) < new Date() ? 'completed' : 'scheduled', source: 'google_calendar' });
  const contractTotal = contracts.filter((item) => item.status === 'signed').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paidTotal = payments.filter((item) => item.status === 'booked').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return { profile: { ...profile, photoUrl: await signedCustomerUrl(service, 'participant-avatars', profile.profile_photo_path) }, lead, contracts, payments, communications, documents, appointments: appointments.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), bankAccount: bankAccounts[0] || null, finance: { contractTotal, paidTotal, openBalance: Math.max(0, contractTotal - paidTotal) }, integrations: { whatsapp: { configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID), provider: 'Meta WhatsApp Cloud API' }, calendar: { configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), provider: 'Google Calendar' } } };
}

async function uploadDocument(service, context, body) {
  const upload = decodeCustomerUpload(body, 'documents');
  const stored = await uploadCustomerObject(service, 'documents', context.participantId, upload);
  const documentType = ['contract', 'video_contract', 'shared', 'other'].includes(body?.documentType) ? body.documentType : 'shared';
  try {
    const created = await rows(await fetch(`${service.url}/rest/v1/participant_documents`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: context.participantId, week: Number.isInteger(Number(body?.week)) ? Math.min(8, Math.max(0, Number(body.week))) : 0, document_type: documentType, display_title: clean(body?.title, 180) || upload.fileName, original_file_name: upload.fileName, mime_type: upload.mimeType, byte_size: upload.buffer.length, storage_bucket: stored.bucket, storage_path: stored.storagePath, sha256: upload.sha256, processing_status: 'uploaded', source: context.admin ? 'staff' : 'customer', visibility: body?.visibility === 'staff' ? 'staff' : 'customer', uploaded_by_profile_id: context.profileId || context.participantId }) }), 'Dokument konnte nicht gespeichert werden.');
    return created[0];
  } catch (error) {
    await deleteCustomerObject(service, stored.bucket, stored.storagePath);
    throw error;
  }
}

async function uploadAvatar(service, context, body) {
  const upload = decodeCustomerUpload(body, 'avatars');
  const stored = await uploadCustomerObject(service, 'avatars', context.participantId, upload);
  const current = await rows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(context.participantId)}&select=profile_photo_path&limit=1`, { headers: headers(service.key) }), 'Profilbild konnte nicht geladen werden.');
  const updated = await rows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(context.participantId)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ profile_photo_path: stored.storagePath }) }), 'Profilbild konnte nicht gespeichert werden.');
  if (current[0]?.profile_photo_path && current[0].profile_photo_path !== stored.storagePath) await deleteCustomerObject(service, 'participant-avatars', current[0].profile_photo_path);
  return { profile: updated[0], photoUrl: await signedCustomerUrl(service, 'participant-avatars', stored.storagePath) };
}

async function documentDownload(service, context, documentId) {
  if (!uuid(documentId)) throw Object.assign(new Error('Gültige Dokumenten-ID fehlt.'), { status: 400 });
  const documents = await rows(await fetch(`${service.url}/rest/v1/participant_documents?id=eq.${encodeURIComponent(documentId)}&user_profile_id=eq.${encodeURIComponent(context.participantId)}&select=storage_bucket,storage_path,visibility&limit=1`, { headers: headers(service.key) }), 'Dokument konnte nicht geladen werden.');
  const document = documents[0];
  if (!document || (!context.admin && document.visibility !== 'customer')) throw Object.assign(new Error('Dokument wurde nicht gefunden.'), { status: 404 });
  const url = await signedCustomerUrl(service, document.storage_bucket, document.storage_path);
  if (!url) throw new Error('Der sichere Download-Link konnte nicht erzeugt werden.');
  return url;
}

async function sendWhatsApp(service, context, body) {
  if (!context.admin) throw Object.assign(new Error('Nachrichten können nur durch Mitarbeiter versendet werden.'), { status: 403 });
  const data = await customerData(service, context.participantId);
  if (!data.lead) throw Object.assign(new Error('Die verknüpfte Kundenakte fehlt.'), { status: 409 });
  const message = clean(body?.message, 4000);
  const phone = clean(data.profile.whatsapp_phone || (data.profile.whatsapp_same_as_mobile ? data.profile.mobile_phone || data.profile.phone : ''), 40).replace(/[^0-9]/g, '');
  if (!message || !phone) throw Object.assign(new Error('WhatsApp-Nummer und Nachricht sind erforderlich.'), { status: 400 });
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw Object.assign(new Error('WhatsApp Business ist vorbereitet, aber noch nicht mit den Meta-Zugangsdaten verbunden.'), { status: 409 });
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0';
  const sent = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body: message } }) });
  const details = await sent.json().catch(() => ({}));
  if (!sent.ok) throw Object.assign(new Error(details.error?.message || 'WhatsApp-Nachricht konnte nicht versendet werden.'), { status: sent.status });
  const providerMessageId = details.messages?.[0]?.id || null;
  const created = await rows(await fetch(`${service.url}/rest/v1/lead_communications`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ lead_id: data.lead.id, direction: 'outbound', channel: 'whatsapp', subject: 'WhatsApp Business', preview: message.slice(0, 500), body: message, delivery_status: 'sent', provider_message_id: providerMessageId, updated_at: new Date().toISOString() }) }), 'WhatsApp-Nachricht konnte nicht protokolliert werden.');
  return { record: created[0], providerMessageId };
}

export async function handleCustomerRecords(request, response) {
  const action = request.query?.action || request.body?.action || 'overview';
  const required = action === 'whatsapp-send' ? ['communications', 'customers'] : action.startsWith('document') || action === 'avatar-upload' ? ['customers', 'program'] : ['customers', 'finance', 'communications'];
  const context = await authorize(request, response, required);
  if (!context) return;
  const auth = supabaseAuthConfig();
  if (!auth) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  const service = { ...auth, key: auth.serviceKey };
  try {
    if (request.method === 'GET' && action === 'overview') {
      const data = await customerData(service, context.participantId);
      if (!context.admin) {
        data.documents = data.documents.filter((document) => document.visibility === 'customer');
        data.lead = null;
        data.communications = [];
        data.bankAccount = null;
        data.payments = [];
      }
      return response.status(200).json(data);
    }
    if (request.method === 'GET' && action === 'document-download') return response.redirect(302, await documentDownload(service, context, request.query?.documentId));
    if (request.method === 'POST' && action === 'document-upload') return response.status(201).json({ document: await uploadDocument(service, context, request.body || {}) });
    if (request.method === 'POST' && action === 'avatar-upload') return response.status(200).json(await uploadAvatar(service, context, request.body || {}));
    if (request.method === 'POST' && action === 'whatsapp-send') return response.status(201).json(await sendWhatsApp(service, context, request.body || {}));
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Kundenakte konnte nicht verarbeitet werden.' });
  }
}
