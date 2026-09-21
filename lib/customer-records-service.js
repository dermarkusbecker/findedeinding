import {customerAccount} from './customer-account.js';
import {handleCustomerContracts} from './customer-contracts.js';
import {invoiceBalances,cents} from './finance.js';
import {whatsappPackageStatus,requireWhatsAppPackage} from './whatsapp-package.js';
import { handleCustomerNotes } from './customer-notes.js';
import { saveCommunication, downloadCommunicationAttachment } from './customer-communication-log.js';
import { sessionFromRequest } from './auth.js';
import { decodeCustomerUpload, deleteCustomerObject, signedCustomerUrl, uploadCustomerObject } from './customer-storage.js';
import { requireCurrentAdmin, requireCurrentPermission, supabaseAuthConfig } from './user-auth.js';
import { getParticipantProgramAccess } from './program-access-service.js';
import { isOnboardingComplete } from './program-access.js';

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

export async function customerData(service, participantId) {
  const id = encodeURIComponent(participantId);
  const profileRows = await rows(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${id}&role=eq.user&select=id,name,email,birth_date,street,postal_code,city,country,phone,mobile_phone,whatsapp_phone,whatsapp_same_as_mobile,preferred_communication_channel,postal_mail_active,profile_photo_path,portal_username,customer_number,source_lead_id&limit=1`, { headers: headers(service.key) }), 'Kundenprofil konnte nicht geladen werden.');
  const profile = profileRows[0];
  if (!profile) throw Object.assign(new Error('Kunde wurde nicht gefunden.'), { status: 404 });
  const relatedLeads=await rows(await fetch(`${service.url}/rest/v1/leads?or=(converted_user_profile_id.eq.${id}${profile.source_lead_id?`,and(id.eq.${encodeURIComponent(profile.source_lead_id)},converted_user_profile_id.is.null)`:''})&select=*&order=created_at`,{headers:headers(service.key)}),'Verknüpfte Kundenakten konnten nicht geladen werden.');
  const lead=relatedLeads.find(item=>item.id===profile.source_lead_id)||relatedLeads[0]||null;
  const leadFilter=`lead_id=in.(${relatedLeads.map(item=>item.id).join(',')})`;
  const all=async(table,order)=>{const result=[];if(!relatedLeads.length)return result;for(let offset=0;;offset+=500){const page=await rows(await fetch(`${service.url}/rest/v1/${table}?${leadFilter}&select=*&order=${order}&limit=500&offset=${offset}`,{headers:headers(service.key)}),'Kundenverträge und Finanzdaten konnten nicht geladen werden.');result.push(...page);if(page.length<500)return result;}};
  const [documents,appointments,contracts,payments,invoices,bankAccounts,accountEvents]=await Promise.all([
    fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${id}&select=id,week,document_type,display_title,original_file_name,mime_type,byte_size,source,visibility,processing_status,created_at&order=created_at.desc`,{headers:headers(service.key)}).then(r=>rows(r,'Dokumente konnten nicht geladen werden.',true)),
    fetch(`${service.url}/rest/v1/customer_appointments?user_profile_id=eq.${id}&select=*&order=starts_at.desc`,{headers:headers(service.key)}).then(r=>rows(r,'Termine konnten nicht geladen werden.',true)),
    all('lead_contracts','created_at.desc,id'),all('lead_payments','booked_at.desc,id'),all('finance_invoices','created_at.desc,id'),
    lead?fetch(`${service.url}/rest/v1/lead_bank_accounts?lead_id=eq.${lead.id}&select=*&limit=1`,{headers:headers(service.key)}).then(r=>rows(r,'Kontodaten konnten nicht geladen werden.')):[],
    all('finance_account_events','created_at.desc,id'),
  ]);
  const communicationLeads=relatedLeads;
  const communicationFilter=`or=(user_profile_id.eq.${id}${communicationLeads.length?`,lead_id.in.(${communicationLeads.map(item=>item.id).join(',')})`:''})`;
  const communications=[];
  for(let offset=0;;offset+=500){
    const page=await rows(await fetch(`${service.url}/rest/v1/lead_communications?${communicationFilter}&select=*&order=occurred_at.desc,id&limit=500&offset=${offset}`,{headers:headers(service.key)}),'Kommunikation konnte nicht geladen werden.');
    communications.push(...page);if(page.length<500)break;
  }

  if (lead?.appointment_start && !appointments.some((item) => item.google_event_id && item.google_event_id === lead.calendar_event_id)) appointments.push({ id: `lead-${lead.id}`, title: lead.appointment_title || 'Kundengespräch', starts_at: lead.appointment_start, ends_at: lead.appointment_end, timezone: lead.appointment_timezone, google_event_id: lead.calendar_event_id, google_event_url: lead.calendar_event_url, meet_url: lead.meet_url, status: new Date(lead.appointment_end || lead.appointment_start) < new Date() ? 'completed' : 'scheduled', source: 'google_calendar' });
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
  const balances=invoiceBalances(invoices,payments,today,accountEvents),sum=(items,key)=>items.reduce((total,item)=>total+cents(item[key]),0)/100;
  const contractTotal=sum(contracts.filter(item=>item.status==='signed'),'amount');
  const paidTotal=sum(payments.filter(item=>item.status==='booked'&&item.booked_at<=today),'amount');
  const account=customerAccount({invoices,payments,events:accountEvents,today});
  const openBalance=account.summary.balance;
  const linkedContracts=contracts.map(contract=>{const invoice=balances.find(i=>i.contract_id===contract.id);return{...contract,invoice:invoice?{id:invoice.id,number:invoice.invoice_number,status:invoice.status,open:invoice.open}:null};});
  return { profile: { ...profile, photoUrl: await signedCustomerUrl(service, 'participant-avatars', profile.profile_photo_path) }, lead, contracts:linkedContracts, payments, communications, documents, appointments: appointments.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), bankAccount: bankAccounts[0] || null, finance: { contractTotal, paidTotal, openBalance, accountSummary:account.summary, pendingInvoices:invoices.filter(i=>i.status==='needs_details').length }, integrations: { whatsapp: whatsappPackageStatus(), calendar: { configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), provider: 'Google Calendar' } } };
}

async function uploadDocument(service, context, body) {
  const week = Number.isInteger(Number(body?.week)) ? Math.min(8, Math.max(0, Number(body.week))) : 0;
  const documentType = ['start_commitment', 'contract', 'video_contract', 'shared', 'other'].includes(body?.documentType) ? body.documentType : 'shared';
  if (week === 0 && !context.admin) {
    if (documentType !== 'start_commitment') throw Object.assign(new Error('Im Onboarding kann nur dein Start-Commitment hochgeladen werden.'), { status: 400 });
    const program = await getParticipantProgramAccess(context.participantId);
    if (isOnboardingComplete(program.progress)) throw Object.assign(new Error('Das Onboarding ist abgeschlossen. Das Start-Commitment kann nicht mehr verändert werden.'), { status: 409 });
  }
  if (week >= 1) {
    const program = await getParticipantProgramAccess(context.participantId);
    if (!isOnboardingComplete(program.progress)) throw Object.assign(new Error('Das Onboarding ist noch nicht abgeschlossen.'), { status: 409 });
    if (!program.access.canAccessWeek(week)) throw Object.assign(new Error(`Woche ${week} ist zeitlich noch gesperrt.`), { status: 409 });
    if (!context.admin && program.access.completedWeeks.includes(week)) throw Object.assign(new Error(`Woche ${week} ist abgeschlossen. Dokumente können dort nicht mehr verändert werden.`), { status: 409 });
  }
  const upload = decodeCustomerUpload(body, 'documents');
  const stored = await uploadCustomerObject(service, 'documents', context.participantId, upload);
  try {
    const created = await rows(await fetch(`${service.url}/rest/v1/participant_documents`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: context.participantId, week, document_type: documentType, display_title: clean(body?.title, 180) || upload.fileName, original_file_name: upload.fileName, mime_type: upload.mimeType, byte_size: upload.buffer.length, storage_bucket: stored.bucket, storage_path: stored.storagePath, sha256: upload.sha256, processing_status: 'uploaded', source: context.admin ? 'staff' : 'customer', visibility: body?.visibility === 'staff' ? 'staff' : 'customer', uploaded_by_profile_id: context.profileId || context.participantId }) }), 'Dokument konnte nicht gespeichert werden.');
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
  const documents = await rows(await fetch(`${service.url}/rest/v1/participant_documents?id=eq.${encodeURIComponent(documentId)}&user_profile_id=eq.${encodeURIComponent(context.participantId)}&select=storage_bucket,storage_path,visibility,original_file_name,mime_type&limit=1`, { headers: headers(service.key) }), 'Dokument konnte nicht geladen werden.');
  const document = documents[0];
  if (!document || (!context.admin && document.visibility !== 'customer')) throw Object.assign(new Error('Dokument wurde nicht gefunden.'), { status: 404 });
  const url = await signedCustomerUrl(service, document.storage_bucket, document.storage_path);
  if (!url) throw new Error('Der sichere Download-Link konnte nicht erzeugt werden.');
  return { url, document };
}

async function sendDocumentAttachment(service, context, documentId, response) {
  const download = await documentDownload(service, context, documentId);
  const fileResponse = await fetch(download.url);
  if (!fileResponse.ok) throw Object.assign(new Error('Das gespeicherte Dokument konnte nicht heruntergeladen werden.'), { status: fileResponse.status });
  const fileName = clean(download.document.original_file_name, 180) || 'Finde-Dein-Ding-Dokument.pdf';
  const asciiName = fileName.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
  response.setHeader('Content-Type', download.document.mime_type || fileResponse.headers.get('content-type') || 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  response.setHeader('Cache-Control', 'private, no-store');
  return response.status(200).send(Buffer.from(await fileResponse.arrayBuffer()));
}

async function sendWhatsApp(service, context, body) {
  requireWhatsAppPackage();
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
  const required = action === 'customer-contracts' ? ['customers'] : action === 'customer-notes' ? ['customers','program'] : (action === 'whatsapp-send' || action.startsWith('communication-')) ? ['communications', 'customers'] : action.startsWith('document') || action === 'avatar-upload' ? ['customers', 'program'] : ['customers', 'finance', 'communications', 'sales_calls'];
  const context = await authorize(request, response, required);
  if (!context) return;
  const auth = supabaseAuthConfig();
  if (!auth) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  const service = { ...auth, key: auth.serviceKey };
  try {
    if(action==='customer-contracts')return await handleCustomerContracts(service,context,request,response);
    if(action==='customer-notes')return await handleCustomerNotes(service,context,request,response);
    if(action.startsWith('communication-')){if(!context.admin)return response.status(403).json({error:'Nur im CRM verfügbar.'});if(action==='communication-save'&&request.method==='POST')return response.status(200).json(await saveCommunication(service,context,request.body||{}));if(action==='communication-attachment'&&request.method==='GET')return response.redirect(302,await downloadCommunicationAttachment(service,context,request.query));return response.status(405).json({error:'Methode nicht erlaubt.'});}
    if (request.method === 'GET' && action === 'overview') {
      const data = await customerData(service, context.participantId);
      if (context.admin && !context.staffPermissions.some((permission) => ['customers', 'program'].includes(permission))) {
        data.documents = [];
        data.bankAccount = null;
        if (!context.staffPermissions.includes('finance')) {
          data.payments = [];
          data.contracts = [];
          data.finance = { contractTotal: 0, paidTotal: 0, openBalance: 0 };
        }
      }
      if (!context.admin) {
        const program = await getParticipantProgramAccess(context.participantId);
        const programStarted = isOnboardingComplete(program.progress);
        data.documents = data.documents.filter((document) => document.visibility === 'customer' && (Number(document.week) === 0 || (programStarted && program.access.canAccessWeek(document.week))));
        data.lead = null;
        data.communications = [];
        data.bankAccount = null;
        data.payments = [];
      }
      return response.status(200).json(data);
    }
    if (request.method === 'GET' && action === 'document-download') {
      if (request.query?.download === '1') return sendDocumentAttachment(service, context, request.query?.documentId, response);
      const download = await documentDownload(service, context, request.query?.documentId);
      return response.redirect(302, download.url);
    }
    if (request.method === 'POST' && action === 'document-upload') return response.status(201).json({ document: await uploadDocument(service, context, request.body || {}) });
    if (request.method === 'POST' && action === 'avatar-upload') return response.status(200).json(await uploadAvatar(service, context, request.body || {}));
    if (request.method === 'POST' && action === 'whatsapp-send') return response.status(201).json(await sendWhatsApp(service, context, request.body || {}));
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Kundenakte konnte nicht verarbeitet werden.' });
  }
}
