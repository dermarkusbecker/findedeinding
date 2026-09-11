import { dashboardClarity } from '../lib/dashboard-clarity.js';
import { checkIntegrationHealth, applyIntegrationHealth } from '../lib/integration-health.js';
import {beginRecording,prepareRecordingUpload,completeRecordingUpload} from '../lib/contract-recording-service.js';
import crypto from 'node:crypto';
import { DEFAULT_BOOKING_SETTINGS, generateAvailableSlots, isWithinBookingAvailability, normalizeBookingSettings } from '../lib/booking-availability.js';
import { authorizationUrl, assertCalendarAvailable, calendarBusyIntervals, decryptCredential, deleteCalendarEvent, emailFromIdToken, encryptCredential, exchangeAuthorizationCode, googleConfig, refreshAccessToken, saveCalendarEvent, verifyOAuthState } from '../lib/google-calendar.js';
import { assertGoogleMeetSpace, downloadGoogleDriveFile, findGoogleMeetRecording, googleDriveFileMetadata } from '../lib/google-meet.js';
import { provisionProgramUser, requireCurrentAdmin, supabaseAuthConfig } from '../lib/user-auth.js';
import { claraConfig } from '../lib/clara/config.js';
import { buildSystemRegistry } from '../lib/system-registry.js';
import { calculateProgramAccess } from '../lib/program-access.js';
import { reconcileAccessFromEntries } from '../lib/program-position.js';
import { syncLeadToCustomerProfile } from '../lib/contact-lifecycle.js';
import { buildVideoContractPdf, normalizeVideoContract, VIDEO_CONFIRMATION_KEYS } from '../lib/video-contract.js';
import { customerObjectExists, deleteCustomerObject, importCustomerObject, signedCustomerUrl, uploadCustomerObject } from '../lib/customer-storage.js';
import { handlePublicContractSign } from '../lib/contract-sign-service.js';

const VALID_STATUSES = ['new', 'contacted', 'scheduled', 'consultation', 'offer', 'later', 'customer', 'lost'];
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailValid = (value) => /^\S+@\S+\.\S+$/.test(value || '');
const uuidValid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
function currencyNumber(value) {
  let normalized = String(value || '').replace(/[^0-9,.-]/g, '');
  if (normalized.includes(',') && normalized.includes('.')) normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.') ? normalized.replace(/\./g, '').replace(',', '.') : normalized.replace(/,/g, '');
  else if (normalized.includes(',')) normalized = normalized.replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function serviceConfig() {
  const auth = supabaseAuthConfig();
  return auth ? { ...auth, key: auth.serviceKey } : null;
}

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

async function readJson(result, fallback = 'Anfrage konnte nicht verarbeitet werden.') {
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data.message || data.msg || data.error || fallback), { status: result.status });
  return data;
}

async function leadById(service, id) {
  if (!uuidValid(id)) throw Object.assign(new Error('Gültige Lead-ID fehlt.'), { status: 400 });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: headers(service.key) }), 'Lead konnte nicht geladen werden.');
  if (!rows[0]) throw Object.assign(new Error('Lead wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

async function leadContractById(service, leadId, contractId) {
  if (!uuidValid(contractId)) throw Object.assign(new Error('Gültige Vertrags-ID fehlt.'), { status: 400 });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`, { headers: headers(service.key) }), 'Vertrag konnte nicht geladen werden.');
  if (!rows[0]) throw Object.assign(new Error('Der Vertrag wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

async function patchLeadContract(service, leadId, contractId, payload, draftOnly = false) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?id=eq.${encodeURIComponent(contractId)}&lead_id=eq.${encodeURIComponent(leadId)}${draftOnly ? '&status=eq.draft' : ''}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) }), 'Vertrag konnte nicht aktualisiert werden.');
  if (!rows[0]) throw Object.assign(new Error('Der Vertrag wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

function pdfUpload(buffer, fileName) {
  return { buffer, fileName, mimeType: 'application/pdf', sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

async function patchLead(service, id, changes) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }) }), 'Lead konnte nicht gespeichert werden.');
  if (!rows[0]) throw Object.assign(new Error('Lead wurde nicht gefunden.'), { status: 404 });
  const lead = rows[0];
  if (lead.converted_user_profile_id) await syncLeadToCustomerProfile(service, lead);
  return lead;
}

async function insertLeadRecord(service, table, payload) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/${table}`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(payload) }), 'CRM-Eintrag konnte nicht gespeichert werden.');
  return rows[0] || null;
}

async function reserveContractNumber(service, contractDate = new Date().toISOString().slice(0, 10)) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(contractDate || '') ? contractDate : new Date().toISOString().slice(0, 10);
  const result = await readJson(await fetch(`${service.url}/rest/v1/rpc/next_contract_number`, {
    method: 'POST',
    headers: headers(service.key),
    body: JSON.stringify({ p_contract_date: date }),
  }), 'Die Vertragsnummer konnte nicht automatisch vergeben werden.');
  const contractNumber = clean(typeof result === 'string' ? result : result?.next_contract_number, 80);
  if (!/^FDD-\d{4}-\d{4,}$/.test(contractNumber)) throw Object.assign(new Error('Die automatisch erzeugte Vertragsnummer ist ungültig.'), { status: 500 });
  return contractNumber;
}

async function activateContractedLead(service, lead, programStartDate) {
  if (lead.converted_user_profile_id) return { profileId: lead.converted_user_profile_id, alreadyActive: true };
  const profile = await provisionProgramUser(service, { name: lead.name, email: lead.email, phone: lead.mobile_phone || lead.phone, startDate: programStartDate, sourceLeadId: lead.id, permissions: ['customer_portal', 'clara_program', 'documents'] });
  await patchLead(service, lead.id, { status: 'customer', converted_user_profile_id: profile.id, converted_at: new Date().toISOString() });
  await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, direction: 'outbound', subject: 'Teilnehmer-Login automatisch erstellt', preview: `Login ${profile.portal_username || 'wird vergeben'} wurde angelegt. Ein sicherer Einmal-Link zur Passwortvergabe wurde per System-E-Mail versendet.` }).catch(() => null);
  return { profileId: profile.id, name: profile.name, email: profile.email, loginName: profile.portal_username, customerNumber: profile.customer_number, oneTimePassword: profile.oneTimePassword, alreadyActive: false };
}

async function completedContract(service, leadId) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?lead_id=eq.${encodeURIComponent(leadId)}&status=eq.signed&document_confirmed_at=not.is.null&video_contract_confirmed_at=not.is.null&select=*&order=signed_at.desc&limit=1`, { headers: headers(service.key) }), 'Vertragsstatus konnte nicht geprüft werden.');
  return rows[0] || null;
}

async function communicationInbox(service) {
  const [communicationRows, leadRows] = await Promise.all([
    readJson(await fetch(`${service.url}/rest/v1/lead_communications?select=*&order=occurred_at.desc&limit=500`, { headers: headers(service.key) }), 'Kommunikationen konnten nicht geladen werden.'),
    readJson(await fetch(`${service.url}/rest/v1/leads?select=id,name,email,status,converted_user_profile_id&order=created_at.desc&limit=500`, { headers: headers(service.key) }), 'Kontakte konnten nicht geladen werden.'),
  ]);
  const contacts = new Map(leadRows.map((lead) => [lead.id, { id: lead.id, name: lead.name, email: lead.email, type: lead.converted_user_profile_id ? 'customer' : 'lead', status: lead.status }]));
  const communications = communicationRows.map((item) => ({ ...item, contact: contacts.get(item.lead_id) || { id: item.lead_id, name: 'Unbekannter Kontakt', email: '', type: 'lead', status: 'unknown' } }));
  return {
    communications,
    contacts: [...contacts.values()],
    summary: {
      total: communications.length,
      inbox: communications.filter((item) => item.direction === 'inbound').length,
      unread: communications.filter((item) => item.direction === 'inbound' && !item.read_at).length,
      sent: communications.filter((item) => item.direction === 'outbound' && item.delivery_status !== 'draft').length,
      drafts: communications.filter((item) => item.delivery_status === 'draft').length,
      customers: new Set(communications.filter((item) => item.contact.type === 'customer').map((item) => item.lead_id)).size,
      leads: new Set(communications.filter((item) => item.contact.type === 'lead').map((item) => item.lead_id)).size,
    },
    mailTransport: { active: false, provider: null, label: 'Domain-Mail-Schnittstelle geplant' },
  };
}

const COMMUNICATION_TEMPLATE_CATEGORIES = ['general', 'lead', 'appointment', 'contract', 'participant', 'program'];
const COMMUNICATION_CAMPAIGN_AUDIENCES = ['all', 'leads', 'customers', 'selected'];
const COMMUNICATION_AUTOMATION_TRIGGERS = ['lead_created', 'appointment_scheduled', 'sales_conversation_completed', 'contract_signed', 'participant_activated', 'week_unlocked', 'inactivity'];

async function communicationCenterContacts(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/leads?select=id,name,email,status,converted_user_profile_id&order=name.asc&limit=1000`, { headers: headers(service.key) }), 'Kommunikationskontakte konnten nicht geladen werden.');
  return rows.map((lead) => ({ id: lead.id, name: lead.name, email: lead.email, type: lead.converted_user_profile_id ? 'customer' : 'lead', status: lead.status }));
}

async function patchCommunicationRecord(service, table, id, payload) {
  if (!uuidValid(id)) throw Object.assign(new Error('Gültige Datensatz-ID fehlt.'), { status: 400 });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }) }), 'Kommunikationseinstellung konnte nicht gespeichert werden.');
  if (!rows[0]) throw Object.assign(new Error('Datensatz wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

async function communicationCenter(service) {
  const [templates, campaigns, automations, contacts, signatures, brandingRows] = await Promise.all([
    readJson(await fetch(`${service.url}/rest/v1/communication_templates?status=neq.archived&select=*&order=updated_at.desc`, { headers: headers(service.key) })),
    readJson(await fetch(`${service.url}/rest/v1/communication_campaigns?select=*&order=created_at.desc&limit=200`, { headers: headers(service.key) })),
    readJson(await fetch(`${service.url}/rest/v1/communication_automations?select=*&order=created_at.desc&limit=200`, { headers: headers(service.key) })),
    communicationCenterContacts(service),
    readJson(await fetch(`${service.url}/rest/v1/communication_signatures?select=*&order=is_default.desc,name.asc`, { headers: headers(service.key) })),
    readJson(await fetch(`${service.url}/rest/v1/system_branding?id=eq.default&select=*&limit=1`, { headers: headers(service.key) })),
  ]);
  return {
    templates, campaigns, automations, contacts, signatures, branding: brandingRows[0] || { id: 'default', brand_name: 'Finde dein Ding', logo_url: '/assets/fdd-logo.svg' },
    audience: { all: contacts.length, leads: contacts.filter((item) => item.type === 'lead').length, customers: contacts.filter((item) => item.type === 'customer').length },
    summary: { templates: templates.length, activeTemplates: templates.filter((item) => item.status === 'active').length, campaigns: campaigns.length, scheduledCampaigns: campaigns.filter((item) => item.status === 'scheduled').length, automations: automations.length, activeAutomations: automations.filter((item) => item.enabled).length },
    mailTransport: { active: false, provider: null, label: 'Domain-Mail-Schnittstelle geplant' },
  };
}

async function saveCommunicationSignature(service, body) {
  const signerName = clean(body?.signerName, 140), name = clean(body?.name, 140);
  if (!name || !signerName) throw Object.assign(new Error('Bezeichnung und Name des Absenders sind erforderlich.'), { status: 400 });
  const payload = { name, closing_text: clean(body?.closingText, 240) || 'Herzliche Grüße', signer_name: signerName, role_title: clean(body?.roleTitle, 180) || null, company_name: clean(body?.companyName, 180) || null, email: clean(body?.email, 254) || null, phone: clean(body?.phone, 60) || null, website: clean(body?.website, 240) || null, use_system_logo: body?.useSystemLogo === true || body?.useSystemLogo === 'on', active: body?.active === true || body?.active === 'on', is_default: body?.isDefault === true || body?.isDefault === 'on' };
  if (payload.is_default) await readJson(await fetch(`${service.url}/rest/v1/communication_signatures?is_default=eq.true`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) }));
  return uuidValid(body?.id) ? patchCommunicationRecord(service, 'communication_signatures', body.id, payload) : insertLeadRecord(service, 'communication_signatures', payload);
}

async function saveSystemBranding(service, body) {
  const payload = { id: 'default', brand_name: clean(body?.brandName, 160) || 'Finde dein Ding', logo_url: clean(body?.logoUrl, 1000) || '/assets/fdd-logo.svg', updated_at: new Date().toISOString() };
  const rows = await readJson(await fetch(`${service.url}/rest/v1/system_branding?on_conflict=id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(payload) }));
  return rows[0] || payload;
}

function signatureText(signature) {
  if (!signature) return '';
  return [signature.closing_text, '', signature.signer_name, signature.role_title, signature.company_name, signature.email, signature.phone, signature.website].filter((value, index, values) => value || (index === 1 && values[0])).join('\n');
}

async function saveCommunicationTemplate(service, body) {
  const name = clean(body?.name, 140), subject = clean(body?.subject, 220), content = clean(body?.body, 20000);
  if (!name || !subject || !content) throw Object.assign(new Error('Name, Betreff und Vorlageninhalt sind erforderlich.'), { status: 400 });
  const payload = { name, description: clean(body?.description, 400) || null, category: COMMUNICATION_TEMPLATE_CATEGORIES.includes(body?.category) ? body.category : 'general', channel: body?.channel === 'whatsapp' ? 'whatsapp' : 'email', subject, body: content, status: body?.status === 'active' ? 'active' : 'draft' };
  return uuidValid(body?.id) ? patchCommunicationRecord(service, 'communication_templates', body.id, payload) : insertLeadRecord(service, 'communication_templates', payload);
}

function selectedCommunicationAudience(contacts, audienceType, selectedIds) {
  if (audienceType === 'leads') return contacts.filter((item) => item.type === 'lead');
  if (audienceType === 'customers') return contacts.filter((item) => item.type === 'customer');
  if (audienceType === 'selected') { const selected = new Set(selectedIds); return contacts.filter((item) => selected.has(item.id)); }
  return contacts;
}

async function saveCommunicationCampaign(service, body) {
  const name = clean(body?.name, 140), subject = clean(body?.subject, 220), content = clean(body?.body, 20000);
  const audienceType = COMMUNICATION_CAMPAIGN_AUDIENCES.includes(body?.audienceType) ? body.audienceType : 'leads';
  const selectedLeadIds = Array.isArray(body?.selectedLeadIds) ? body.selectedLeadIds.filter(uuidValid).slice(0, 1000) : [];
  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!name || !subject || !content) throw Object.assign(new Error('Name, Betreff und Nachricht sind erforderlich.'), { status: 400 });
  if (body?.status === 'scheduled' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw Object.assign(new Error('Für eine geplante Seriennachricht ist ein gültiger Versandzeitpunkt erforderlich.'), { status: 400 });
  if (audienceType === 'selected' && !selectedLeadIds.length) throw Object.assign(new Error('Bitte mindestens einen Kontakt auswählen.'), { status: 400 });
  const recipients = selectedCommunicationAudience(await communicationCenterContacts(service), audienceType, selectedLeadIds);
  const payload = { name, template_id: uuidValid(body?.templateId) ? body.templateId : null, audience_type: audienceType, audience_filter: audienceType === 'selected' ? { leadIds: selectedLeadIds } : {}, recipient_count: recipients.length, subject, body: content, scheduled_at: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null, status: body?.status === 'scheduled' ? 'scheduled' : 'draft' };
  return uuidValid(body?.id) ? patchCommunicationRecord(service, 'communication_campaigns', body.id, payload) : insertLeadRecord(service, 'communication_campaigns', payload);
}

async function saveCommunicationAutomation(service, body) {
  const name = clean(body?.name, 140), triggerType = COMMUNICATION_AUTOMATION_TRIGGERS.includes(body?.triggerType) ? body.triggerType : '', templateId = clean(body?.templateId, 80);
  const delayValue = Math.max(0, Math.min(365, Number.parseInt(body?.delayValue, 10) || 0));
  if (!name || !triggerType || !uuidValid(templateId)) throw Object.assign(new Error('Name, Auslöser und Vorlage sind erforderlich.'), { status: 400 });
  const triggerConfig = triggerType === 'week_unlocked' ? { week: Math.max(1, Math.min(8, Number.parseInt(body?.week, 10) || 1)) } : triggerType === 'inactivity' ? { inactiveDays: Math.max(1, Math.min(90, Number.parseInt(body?.inactiveDays, 10) || 3)) } : {};
  const payload = { name, trigger_type: triggerType, trigger_config: triggerConfig, delay_value: delayValue, delay_unit: ['minutes', 'hours', 'days'].includes(body?.delayUnit) ? body.delayUnit : 'hours', send_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(body?.sendTime || '') ? `${body.sendTime}:00` : null, template_id: templateId, audience_type: ['event_contact', 'leads', 'customers'].includes(body?.audienceType) ? body.audienceType : 'event_contact', enabled: body?.enabled === true || body?.enabled === 'true' || body?.enabled === 'on' };
  return uuidValid(body?.id) ? patchCommunicationRecord(service, 'communication_automations', body.id, payload) : insertLeadRecord(service, 'communication_automations', payload);
}

function average(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

async function commandDashboard(service, admin) {
  const requests = [
    fetch(`${service.url}/rest/v1/user_profiles?role=eq.user&select=id,name,email,status,permissions,created_at&limit=1000`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/participant_progress?select=user_profile_id,current_week,process_status,program_start_date,program_status,privacy_consent_at,start_commitment_at,last_activity_at,updated_at&limit=1000`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/week_gates?required=eq.true&select=id,user_profile_id,week,label,completed_at&limit=5000`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/process_entries?data_block=like.week_*_state&select=user_profile_id,week,data_block,structured_data,created_at&order=created_at.desc&limit=10000`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/customer_questions?status=eq.open&select=id,user_profile_id,week,question,created_at&order=created_at.asc&limit=200`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_tasks?completed=eq.false&select=id,lead_id,title,details,due_at,created_at&order=due_at.asc.nullslast&limit=200`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/leads?select=id,name,email,phone,mobile_phone,status,source,utm_source,appointment_start,appointment_end,appointment_timezone,calendar_event_url,meet_url,converted_user_profile_id,created_at&limit=1000`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_communications?direction=eq.inbound&read_at=is.null&select=id,lead_id,subject,occurred_at&order=occurred_at.asc&limit=200`, { headers: headers(service.key) }),
  ];
  const results = await Promise.all(requests);
  const [profiles, progressRows, gateRows, stateEntries, questions, tasks, leads, unreadMessages] = await Promise.all(results.map((result) => readJson(result, 'Dashboard-Daten konnten nicht geladen werden.')));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const customerIds = new Set(leads.filter(lead=>lead.status==='customer'&&lead.converted_user_profile_id).map(lead=>lead.converted_user_profile_id));
  const activeProgress = progressRows.filter((progress) => (customerIds.has(progress.user_profile_id)||profileMap.get(progress.user_profile_id)?.permissions?.includes('demo_full_access')) && progress.program_status === 'active' && profileMap.get(progress.user_profile_id)?.status === 'active');
  const progressMap = new Map(activeProgress.map((progress) => [progress.user_profile_id, progress]));
  const accessMap = new Map(activeProgress.map((progress) => {
    const participantId = progress.user_profile_id;
    const profile = profileMap.get(participantId);
    const scheduled = calculateProgramAccess({ profileStatus: profile?.status, progress, gates: gateRows.filter((gate) => gate.user_profile_id === participantId), fullProgramAccess: profile?.permissions?.includes('demo_full_access') });
    return [participantId, reconcileAccessFromEntries({ access: scheduled, progress, entries: stateEntries.filter((entry) => entry.user_profile_id === participantId) })];
  }));
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const newCustomers = activeProgress.filter((progress) => new Date(profileMap.get(progress.user_profile_id)?.created_at || 0) >= monthStart).length;
  const activeLeads = leads.filter((lead) => !lead.converted_user_profile_id && !['customer', 'lost', 'later'].includes(lead.status)).length;
  const distribution = Array.from({ length: 9 }, (_, week) => activeProgress.filter((progress) => Number(accessMap.get(progress.user_profile_id)?.processWeek || 0) === week).length);

  const relevantOpenGates = gateRows.filter((gate) => !gate.completed_at).filter((gate) => { const access = accessMap.get(gate.user_profile_id); return access && Number(gate.week) === Number(access.processWeek) && access.weekStates.some((state) => Number(state.week) === Number(gate.week) && state.accessible); });
  const staleThreshold = now.getTime() - 48 * 60 * 60 * 1000;
  const overdueGates = relevantOpenGates.filter((gate) => new Date(progressMap.get(gate.user_profile_id)?.last_activity_at || progressMap.get(gate.user_profile_id)?.updated_at || now).getTime() < staleThreshold);
  const attention = [];
  questions.filter((item) => accessMap.get(item.user_profile_id)?.canAccessWeek(item.week)).forEach((item) => { const profile = profileMap.get(item.user_profile_id); attention.push({ id: `question-${item.id}`, priority: 1, tone: 'orange', icon: '?', title: `${profile?.name || 'Teilnehmer'} · ${item.question.startsWith('[Klarheits-Nachgespräch für Markus]') ? 'Klarheits-Nachgespräch' : 'Kundenfrage'}`, subtitle: `Woche ${item.week} · ${item.question}`, actionLabel: 'Antworten', entityType: 'participant', entityId: item.user_profile_id, createdAt: item.created_at }); });
  const gatesByParticipant = new Map();
  overdueGates.forEach((gate) => { const list = gatesByParticipant.get(gate.user_profile_id) || []; list.push(gate); gatesByParticipant.set(gate.user_profile_id, list); });
  gatesByParticipant.forEach((gates, profileId) => { const profile = profileMap.get(profileId), progress = progressMap.get(profileId), access = accessMap.get(profileId); attention.push({ id: `gate-${profileId}`, priority: 1, tone: 'orange', icon: '↗', title: `${profile?.name || 'Teilnehmer'} · Gate blockiert`, subtitle: `Woche ${access?.processWeek || 0} · ${gates.length} offene Pflichtschritte`, actionLabel: 'Prüfen', entityType: 'participant', entityId: profileId, createdAt: progress?.last_activity_at || progress?.updated_at }); });
  const tomorrowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  tasks.filter((item) => item.due_at && new Date(`${item.due_at}T23:59:59`) <= tomorrowEnd).forEach((item) => { const lead = leadMap.get(item.lead_id); attention.push({ id: `task-${item.id}`, priority: 1, tone: 'orange', icon: '✓', title: `${lead?.name || 'Interessent'} · Aufgabe fällig`, subtitle: item.title, actionLabel: 'Öffnen', entityType: 'lead', entityId: item.lead_id, createdAt: item.due_at }); });
  unreadMessages.forEach((item) => { const lead = leadMap.get(item.lead_id); attention.push({ id: `message-${item.id}`, priority: 2, tone: 'green', icon: '✉', title: `${lead?.name || 'Kontakt'} · Neue Nachricht`, subtitle: item.subject, actionLabel: 'Lesen', entityType: 'lead', entityId: item.lead_id, createdAt: item.occurred_at }); });
  const upcomingEnd = now.getTime() + 48 * 60 * 60 * 1000;
  leads.filter((lead) => { const time = new Date(lead.appointment_start || 0).getTime(); return time >= now.getTime() && time <= upcomingEnd; }).forEach((lead) => attention.push({ id: `appointment-${lead.id}`, priority: 3, tone: 'green', icon: '◷', title: `${lead.name} · Gespräch steht an`, subtitle: new Date(lead.appointment_start).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }), actionLabel: 'Öffnen', entityType: 'lead', entityId: lead.id, createdAt: lead.appointment_start }));
  attention.sort((a, b) => a.priority - b.priority || new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const upcomingAppointments = leads
    .filter((lead) => !lead.converted_user_profile_id && !['customer', 'lost', 'later'].includes(lead.status) && new Date(lead.appointment_start || 0).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.appointment_start) - new Date(right.appointment_start))
    .map((lead) => ({
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.mobile_phone || lead.phone,
      status: lead.status,
      source: lead.utm_source || lead.source || 'website',
      startsAt: lead.appointment_start,
      endsAt: lead.appointment_end,
      timezone: lead.appointment_timezone || 'Europe/Berlin',
      meetUrl: lead.meet_url,
      calendarUrl: lead.calendar_event_url,
    }));
  return {
    generatedAt: now.toISOString(),
    adminName: admin?.profile?.name || admin?.name || 'Markus',
    summary: { activeCustomers: activeProgress.length, newCustomers, activeLeads, unreadMessages: unreadMessages.length, openGates: relevantOpenGates.length, overdueGates: overdueGates.length, onboarding: distribution[0] || 0 },
    clarity: dashboardClarity(stateEntries, accessMap),
    openGateCustomers: [...new Set(relevantOpenGates.map(gate=>gate.user_profile_id))].map(id=>({id,name:profileMap.get(id)?.name||'Kunde',week:accessMap.get(id)?.processWeek,gates:relevantOpenGates.filter(gate=>gate.user_profile_id===id).map(gate=>gate.label)})),
    weekDistribution: distribution.slice(1),
    attention: { total: attention.length, items: attention.slice(0, 6) },
    upcomingAppointments,
  };
}

async function leadDashboard(service, id) {
  const lead = await leadById(service, id);
  const leadFilter = `lead_id=eq.${encodeURIComponent(lead.id)}`;
  const requests = [
    fetch(`${service.url}/rest/v1/lead_contracts?${leadFilter}&select=*&order=created_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_payments?${leadFilter}&select=*&order=booked_at.desc,created_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_communications?${leadFilter}&select=*&order=occurred_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_tasks?${leadFilter}&select=*&order=completed.asc,due_at.asc.nullslast,created_at.desc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/lead_bank_accounts?${leadFilter}&select=*&limit=1`, { headers: headers(service.key) }),
  ];
  if (lead.converted_user_profile_id) {
    requests.push(fetch(`${service.url}/rest/v1/customer_questions?user_profile_id=eq.${encodeURIComponent(lead.converted_user_profile_id)}&select=*&order=status.asc,created_at.desc`, { headers: headers(service.key) }));
    requests.push(fetch(`${service.url}/rest/v1/participant_progress?user_profile_id=eq.${encodeURIComponent(lead.converted_user_profile_id)}&select=current_week,process_status,program_start_date,program_status&limit=1`, { headers: headers(service.key) }));
  }
  const results = await Promise.all(requests);
  const bodies = await Promise.all(results.map((result) => readJson(result, 'Lead-Dashboard konnte nicht geladen werden.')));
  const [contracts, payments, communications, tasks, bankAccounts, questions = [], progressRows = []] = bodies;
  const contractTotal = contracts.filter((item) => item.status === 'signed').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paidTotal = payments.filter((item) => item.status === 'booked').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return { lead, contracts, payments, communications, tasks, bankAccount: bankAccounts[0] || null, questions, progress: progressRows[0] || null, finance: { contractTotal, paidTotal, openBalance: Math.max(0, contractTotal - paidTotal) } };
}

async function recordDashboardMutation(service, request) {
  const lead = await leadById(service, request.body?.id);
  const recordType = clean(request.body?.recordType, 40);
  if (recordType === 'contract') {
    const tariffId = uuidValid(request.body?.tariffId) ? request.body.tariffId : null;
    const tariff = tariffId ? (await serviceTariffs(service)).find((item) => item.id === tariffId && item.is_active) : null;
    if (!tariff) throw Object.assign(new Error('Bitte wähle einen aktiven Tarif aus den Einstellungen.'), { status: 400 });
    const amount = Number(tariff.gross_price);
    const status = ['draft', 'sent', 'signed', 'cancelled'].includes(request.body?.status) ? request.body.status : 'draft';
    const title = clean(tariff.product_label, 180);
    if (!title || !Number.isFinite(amount) || amount < 0) throw Object.assign(new Error('Vertragsbezeichnung und gültiger Betrag sind erforderlich.'), { status: 400 });
    const now = new Date().toISOString();
    const documentConfirmed = request.body?.documentConfirmed === 'true' || request.body?.documentConfirmed === true;
    const videoContractConfirmed = request.body?.videoContractConfirmed === 'true' || request.body?.videoContractConfirmed === true;
    const programStartDate = /^\d{4}-\d{2}-\d{2}$/.test(request.body?.programStartDate || '') ? request.body.programStartDate : now.slice(0, 10);
    const contractNumber = await reserveContractNumber(service, now.slice(0, 10));
    const record = await insertLeadRecord(service, 'lead_contracts', { lead_id: lead.id, tariff_id: tariff.id, title, contract_number: contractNumber, amount, status, signed_at: status === 'signed' ? now : null, document_confirmed_at: documentConfirmed ? now : null, video_contract_confirmed_at: videoContractConfirmed ? now : null, program_start_date: programStartDate });
    const readyForParticipant = status === 'signed' && documentConfirmed && videoContractConfirmed;
    const participant = readyForParticipant ? await activateContractedLead(service, lead, programStartDate) : null;
    return { record, participantActivated: Boolean(participant && !participant.alreadyActive), participant };
  }
  if (recordType === 'payment') {
    const amount = Number(request.body?.amount);
    const bookedAt = /^\d{4}-\d{2}-\d{2}$/.test(request.body?.bookedAt || '') ? request.body.bookedAt : new Date().toISOString().slice(0, 10);
    if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Ein positiver Zahlungsbetrag ist erforderlich.'), { status: 400 });
    return { record: await insertLeadRecord(service, 'lead_payments', { lead_id: lead.id, amount, status: 'booked', booked_at: bookedAt, reference: clean(request.body?.reference, 180) || null }) };
  }
  if (recordType === 'communication') {
    const subject = clean(request.body?.subject, 220);
    const direction = ['inbound', 'outbound', 'system'].includes(request.body?.direction) ? request.body.direction : 'outbound';
    const body = clean(request.body?.preview, 10000);
    if (!subject) throw Object.assign(new Error('Ein Betreff ist erforderlich.'), { status: 400 });
    return { record: await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, subject, direction, preview: body.slice(0, 500) || null, body: body || null, delivery_status: direction === 'inbound' ? 'received' : direction === 'system' ? 'system' : 'logged' }) };
  }
  if (recordType === 'task') {
    const title = clean(request.body?.title, 220);
    if (!title) throw Object.assign(new Error('Eine Aufgabenbezeichnung ist erforderlich.'), { status: 400 });
    return { record: await insertLeadRecord(service, 'lead_tasks', { lead_id: lead.id, title, details: clean(request.body?.details, 2000) || null, due_at: /^\d{4}-\d{2}-\d{2}$/.test(request.body?.dueAt || '') ? request.body.dueAt : null }) };
  }
  if (recordType === 'bank') {
    const payload = { lead_id: lead.id, account_holder: clean(request.body?.accountHolder, 180) || null, iban: clean(request.body?.iban, 50).replace(/\s+/g, '').toUpperCase() || null, bic: clean(request.body?.bic, 20).replace(/\s+/g, '').toUpperCase() || null, payment_reference: clean(request.body?.paymentReference, 180) || null, updated_at: new Date().toISOString() };
    const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_bank_accounts?on_conflict=lead_id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(payload) }), 'Bankverbindung konnte nicht gespeichert werden.');
    return { record: rows[0] || null };
  }
  if (recordType === 'note') return { record: await patchLead(service, lead.id, { internal_notes: clean(request.body?.notes, 10000) || null }) };
  if (recordType === 'toggle_task') {
    if (!uuidValid(request.body?.taskId)) throw Object.assign(new Error('Gültige Aufgaben-ID fehlt.'), { status: 400 });
    const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_tasks?id=eq.${encodeURIComponent(request.body.taskId)}&lead_id=eq.${encodeURIComponent(lead.id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ completed: request.body?.completed === true, updated_at: new Date().toISOString() }) }), 'Aufgabe konnte nicht aktualisiert werden.');
    if (!rows[0]) throw Object.assign(new Error('Aufgabe wurde nicht gefunden.'), { status: 404 });
    return { record: rows[0] };
  }
  if (recordType === 'answer_question') {
    if (!uuidValid(request.body?.questionId) || !lead.converted_user_profile_id) throw Object.assign(new Error('Gültige Kundenfrage fehlt.'), { status: 400 });
    const rows = await readJson(await fetch(`${service.url}/rest/v1/customer_questions?id=eq.${encodeURIComponent(request.body.questionId)}&user_profile_id=eq.${encodeURIComponent(lead.converted_user_profile_id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ status: 'answered', admin_note: clean(request.body?.adminNote, 2000) || null, updated_at: new Date().toISOString() }) }), 'Kundenfrage konnte nicht aktualisiert werden.');
    if (!rows[0]) throw Object.assign(new Error('Kundenfrage wurde nicht gefunden.'), { status: 404 });
    return { record: rows[0] };
  }
  throw Object.assign(new Error('Unbekannter Dashboard-Eintrag.'), { status: 400 });
}

async function setLeadInterestStatus(service, request) {
  const lead = await leadById(service, request.body?.id);
  if (lead.converted_user_profile_id || lead.status === 'customer') throw Object.assign(new Error('Der Interessenstatus kann nur bei Interessenten geändert werden.'), { status: 409 });
  const status = clean(request.body?.status, 20);
  if (!['lost', 'later'].includes(status)) throw Object.assign(new Error('Bitte einen gültigen Interessenstatus auswählen.'), { status: 400 });
  const followUpDate = clean(request.body?.followUpDate, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'later' && (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate) || followUpDate < today)) throw Object.assign(new Error('Bitte ein heutiges oder zukünftiges Datum für die Wiedervorlage auswählen.'), { status: 400 });
  const result = await readJson(await fetch(`${service.url}/rest/v1/rpc/set_lead_interest_status`, {
    method: 'POST',
    headers: headers(service.key),
    body: JSON.stringify({ p_lead_id: lead.id, p_status: status, p_follow_up_date: status === 'later' ? followUpDate : null }),
  }), 'Interessenstatus und Wiedervorlage konnten nicht gespeichert werden.');
  if (!result?.lead) throw Object.assign(new Error('Der gespeicherte Interessenstatus konnte nicht bestätigt werden.'), { status: 500 });
  return {
    ...result,
    message: status === 'later'
      ? `Späteres Interesse gespeichert. Wiedervorlage am ${followUpDate.split('-').reverse().join('.')}.`
      : 'Der Interessent wurde der Liste „Kein Interesse“ zugeordnet.',
  };
}

async function googleConnection(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/integration_settings?provider=eq.google_calendar&select=encrypted_credentials,connected_email,granted_scopes,updated_at&limit=1`, { headers: headers(service.key) }), 'Google-Verbindung konnte nicht geladen werden.');
  if (!rows[0]?.encrypted_credentials) throw Object.assign(new Error('Google Calendar ist noch nicht mit dem CRM verbunden.'), { status: 409 });
  return rows[0];
}

const GOOGLE_MEET_RECORDING_SCOPES = ['https://www.googleapis.com/auth/meetings.space.readonly', 'https://www.googleapis.com/auth/drive.meet.readonly'];
function googleMeetRecordingReady(connection) {
  const granted = new Set(Array.isArray(connection?.granted_scopes) ? connection.granted_scopes : String(connection?.granted_scopes || '').split(/\s+/).filter(Boolean));
  return GOOGLE_MEET_RECORDING_SCOPES.every((scope) => granted.has(scope));
}

async function googleAccessToken(service) {
  const connection = await googleConnection(service);
  return refreshAccessToken(decryptCredential(connection.encrypted_credentials));
}

async function optionalGoogleAccessToken(service) {
  try {
    return await googleAccessToken(service);
  } catch (error) {
    if (error.status === 409) return null;
    throw error;
  }
}

async function bookingSettings(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/booking_settings?id=eq.default&select=*&limit=1`, { headers: headers(service.key) }), 'Termin-Einstellungen konnten nicht geladen werden.');
  return normalizeBookingSettings(rows[0] || DEFAULT_BOOKING_SETTINGS);
}

async function serviceTariffs(service) {
  return readJson(await fetch(`${service.url}/rest/v1/service_tariffs?select=*&order=is_default.desc,sort_order.asc,name.asc`, { headers: headers(service.key) }), 'Tarife konnten nicht geladen werden.');
}

function tariffCode(value, name) {
  const source = clean(value, 80) || clean(name, 180);
  return source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function saveServiceTariff(service, body = {}) {
  const tariffs = await serviceTariffs(service), id = uuidValid(body.id) ? body.id : null;
  const name = clean(body.name, 180), code = tariffCode(body.code, name), productLabel = clean(body.productLabel, 240);
  const durationLabel = clean(body.durationLabel, 120), paymentModel = clean(body.paymentModel, 180), paymentDue = clean(body.paymentDue, 180);
  const grossPrice = Number(body.grossPrice), isActive = body.isActive === true || body.isActive === 'true' || body.isActive === 'on';
  if (!name || !code || !productLabel || !durationLabel || !paymentModel || !paymentDue || !Number.isFinite(grossPrice) || grossPrice < 0) throw Object.assign(new Error('Tarifname, Produkt, Laufzeit, Preis und Zahlungsbedingungen sind erforderlich.'), { status: 400 });
  const otherDefault = tariffs.find((item) => item.id !== id && item.is_active && item.is_default);
  const isDefault = isActive && (body.isDefault === true || body.isDefault === 'true' || body.isDefault === 'on' || !otherDefault);
  if (isDefault) await readJson(await fetch(`${service.url}/rest/v1/service_tariffs?is_default=eq.true${id ? `&id=neq.${encodeURIComponent(id)}` : ''}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }) }), 'Bisheriger Standardtarif konnte nicht aktualisiert werden.');
  const payload = { code, name, description: clean(body.description, 600) || null, product_label: productLabel, duration_label: durationLabel, gross_price: grossPrice, payment_model: paymentModel, payment_due: paymentDue, additional_agreements: clean(body.additionalAgreements, 1000) || null, is_active: isActive, is_default: isDefault, sort_order: Math.max(0, Math.min(9999, Number.parseInt(body.sortOrder, 10) || 0)), updated_at: new Date().toISOString() };
  const result = id
    ? await readJson(await fetch(`${service.url}/rest/v1/service_tariffs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(payload) }), 'Tarif konnte nicht gespeichert werden.')
    : await readJson(await fetch(`${service.url}/rest/v1/service_tariffs`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(payload) }), 'Tarif konnte nicht angelegt werden.');
  if (!result[0]) throw Object.assign(new Error('Der gespeicherte Tarif konnte nicht bestätigt werden.'), { status: 500 });
  if (!isActive && tariffs.find((item) => item.id === id)?.is_default) {
    const replacement = tariffs.find((item) => item.id !== id && item.is_active);
    if (replacement) await readJson(await fetch(`${service.url}/rest/v1/service_tariffs?id=eq.${encodeURIComponent(replacement.id)}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ is_default: true, updated_at: new Date().toISOString() }) }), 'Neuer Standardtarif konnte nicht festgelegt werden.');
  }
  return result[0];
}

async function scheduledLeadIntervals(service, start, end) {
  const query = new URLSearchParams({
    appointment_start: `lt.${end}`,
    appointment_end: `gt.${start}`,
    status: 'neq.lost',
    select: 'appointment_start,appointment_end',
  });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/leads?${query}`, { headers: headers(service.key) }), 'Bereits vereinbarte Termine konnten nicht geprüft werden.');
  return rows.map((lead) => ({ start: lead.appointment_start, end: lead.appointment_end })).filter((item) => item.start && item.end);
}

async function availableBookingSlots(service, query = {}) {
  const settings = await bookingSettings(service);
  const duration = Number(query.duration || settings.defaultDurationMinutes);
  const candidates = generateAvailableSlots({ settings, from: clean(query.from, 10), to: clean(query.to, 10), duration, now: new Date() });
  if (!candidates.length) return { settings, slots: [], calendarConnected: false };
  const accessToken = await optionalGoogleAccessToken(service);
  const storedBusy = await scheduledLeadIntervals(service, candidates[0].start, candidates.at(-1).end);
  const calendarBusy = accessToken ? await calendarBusyIntervals(accessToken, candidates[0].start, candidates.at(-1).end) : [];
  const slots = generateAvailableSlots({ settings, from: clean(query.from, 10), to: clean(query.to, 10), duration, busyIntervals: [...storedBusy, ...calendarBusy], now: new Date() });
  return { settings, slots, calendarConnected: Boolean(accessToken) };
}

function bookingSettingsPayload(settings) {
  return {
    id: 'default',
    timezone: settings.timezone,
    weekly_availability: settings.weeklyAvailability,
    slot_interval_minutes: settings.slotIntervalMinutes,
    default_duration_minutes: settings.defaultDurationMinutes,
    offered_durations: settings.offeredDurations,
    min_notice_hours: settings.minNoticeHours,
    booking_horizon_days: settings.bookingHorizonDays,
    updated_at: new Date().toISOString(),
  };
}

function qualificationAnswers(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`q${index + 1}`, clean(source[`q${index + 1}`], 3000)]));
}

async function publicLead(request, response, service) {
  if (request.body?.website) return response.status(200).json({ ok: true });
  const name = clean(request.body?.name, 120), email = clean(request.body?.email, 254).toLowerCase();
  if (!name || !emailValid(email)) return response.status(400).json({ error: 'Bitte Name und gültige E-Mail-Adresse eingeben.' });
  const publicPhone = clean(request.body?.phone, 40) || null;
  const payload = { name, email, phone: publicPhone, mobile_phone: publicPhone, whatsapp_phone: publicPhone, whatsapp_same_as_mobile: true, challenge: clean(request.body?.challenge, 500) || null, source: clean(request.body?.source, 80) || 'website', utm_source: clean(request.body?.utm_source, 100) || null, utm_medium: clean(request.body?.utm_medium, 100) || null, utm_campaign: clean(request.body?.utm_campaign, 150) || null, consent_at: request.body?.consent ? new Date().toISOString() : null };
  if (!payload.consent_at) return response.status(400).json({ error: 'Bitte bestätige die Datenschutzhinweise.' });
  const settings = await bookingSettings(service);
  const startDate = new Date(request.body?.appointmentStart), duration = settings.defaultDurationMinutes;
  if (Number.isNaN(startDate.getTime())) return response.status(400).json({ error: 'Bitte wähle einen freien Termin für dein Klarheitsgespräch.' });
  if (!isWithinBookingAvailability(startDate, duration, settings, new Date())) return response.status(409).json({ error: 'Dieser Termin ist nicht mehr verfügbar. Bitte wähle einen anderen freien Termin.' });
  const endDate = new Date(startDate.getTime() + duration * 60000);
  const storedBusy = await scheduledLeadIntervals(service, startDate.toISOString(), endDate.toISOString());
  if (storedBusy.length) return response.status(409).json({ error: 'Dieser Termin wurde gerade vergeben. Bitte wähle einen anderen freien Termin.' });
  const accessToken = await optionalGoogleAccessToken(service);
  if (accessToken) await assertCalendarAvailable(accessToken, startDate.toISOString(), endDate.toISOString());
  const event = accessToken ? await saveCalendarEvent(accessToken, payload, startDate.toISOString(), endDate.toISOString()) : null;
  const meetUrl = event?.hangoutLink || event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || null;
  const leadPayload = { ...payload, status: 'scheduled', appointment_start: startDate.toISOString(), appointment_end: endDate.toISOString(), appointment_timezone: settings.timezone, calendar_event_id: event?.id || null, calendar_event_url: event?.htmlLink || null, meet_url: meetUrl };
  try {
    const rows = await readJson(await fetch(`${service.url}/rest/v1/leads`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(leadPayload) }), 'Interessent und Termin konnten nicht gespeichert werden.');
    const lead = rows[0];
    if (lead?.id) await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, direction: 'outbound', subject: 'Dein Klarheitsgespräch ist vereinbart', preview: `Termin am ${startDate.toLocaleString('de-DE', { timeZone: settings.timezone })}${meetUrl ? ' mit Google Meet' : ''}.` }).catch(() => null);
    return response.status(201).json({ ok: true, appointment: { startsAt: startDate.toISOString(), endsAt: endDate.toISOString(), timezone: settings.timezone, calendarConnected: Boolean(accessToken), meetUrl } });
  } catch (error) {
    if (event?.id && accessToken) await deleteCalendarEvent(accessToken, event.id).catch(() => null);
    throw error;
  }
}

function permissionForAction(action) {
  if (action === 'command-dashboard') return 'dashboard';
  if (action.startsWith('communication')) return 'communications';
  if (['available-slots', 'tariffs'].includes(action)) return ['settings', 'sales_calls', 'leads'];
  if (['google-connect', 'google-callback', 'booking-settings', 'system-status', 'tariff'].includes(action)) return 'settings';
  if (['dashboard', 'dashboard-record'].includes(action)) return ['leads', 'customers', 'finance'];
  if (['update', 'complete-sales-conversation', 'set-interest-status'].includes(action)) return ['leads', 'sales_calls', 'customers'];
  if (['schedule', 'cancel-appointment'].includes(action)) return ['leads', 'sales_calls'];
  if (['create-video-contract', 'begin-video-recording', 'sync-google-meet-recording', 'video-recording-upload', 'complete-video-recording-upload', 'finalize-video-contract', 'contract-download', 'video-recording-download'].includes(action)) return ['leads', 'sales_calls'];
  return 'leads';
}

export default async function handler(request, response) {
  const service = serviceConfig();
  const action = request.query?.action || request.body?.action || '';
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (action === 'public-contract-sign') return handlePublicContractSign(request, response);
  if (request.method === 'GET' && action === 'public-available-slots') {
    try {
      const result = await availableBookingSlots(service, request.query || {});
      return response.status(200).json({ slots: result.slots, timezone: result.settings.timezone, durationMinutes: result.settings.defaultDurationMinutes, bookingHorizonDays: result.settings.bookingHorizonDays, calendarConnected: result.calendarConnected });
    } catch (error) {
      return response.status(error.status || 503).json({ error: error.message });
    }
  }
  if (request.method === 'POST' && !action) {
    try { return await publicLead(request, response, service); }
    catch (error) { return response.status(error.status || 500).json({ error: error.message }); }
  }
  const admin = await requireCurrentAdmin(request, response, permissionForAction(action));
  if (!admin) return;
  try {
    if (request.method === 'GET' && action === 'google-connect') {
      if (!googleConfig()) return response.status(503).json({ error: 'Google Client-ID und Secret fehlen in Vercel.' });
      return response.redirect(302, authorizationUrl(admin.profileId));
    }
    if (request.method === 'GET' && action === 'google-callback') {
      if (request.query?.error) return response.redirect(302, `/admin?view=settings&section=integrations&google=error&reason=${encodeURIComponent(request.query.error)}`);
      if (!verifyOAuthState(request.query?.state, admin.profileId)) return response.status(400).send('Ungültiger oder abgelaufener Google-Verbindungsversuch.');
      const tokens = await exchangeAuthorizationCode(request.query?.code);
      if (!tokens.refresh_token) return response.status(409).send('Google hat keinen dauerhaften Zugriff erteilt. Bitte die Verbindung erneut starten.');
      const payload = { provider: 'google_calendar', encrypted_credentials: encryptCredential(tokens.refresh_token), connected_email: emailFromIdToken(tokens.id_token) || admin.email, granted_scopes: String(tokens.scope || '').split(/\s+/).filter(Boolean), updated_at: new Date().toISOString() };
      await readJson(await fetch(`${service.url}/rest/v1/integration_settings?on_conflict=provider`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(payload) }), 'Google-Verbindung konnte nicht gespeichert werden.');
      return response.redirect(302, '/admin?view=settings&section=integrations&google=connected');
    }
    if (request.method === 'GET' && action === 'google-status') {
      const configured = Boolean(googleConfig());
      let connection = null;
      if (configured) connection = await googleConnection(service).catch(() => null);
      return response.status(200).json({ configured, connected: Boolean(connection), meetRecordingReady: googleMeetRecordingReady(connection), email: connection?.connected_email || null, updatedAt: connection?.updated_at || null });
    }
    if (request.method === 'GET' && action === 'system-status') {
      const googleConfigured = Boolean(googleConfig());
      const googleConnectionRecord = googleConfigured ? await googleConnection(service).catch(() => null) : null;
      const openai = claraConfig();
      const registry = buildSystemRegistry({
        googleConfigured,
        googleConnection: googleConnectionRecord,
        googleMeetRecordingReady: googleMeetRecordingReady(googleConnectionRecord),
        openaiConfigured: Boolean(openai.apiKey),
        openaiModel: openai.model,
        whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      });
      const checks=await checkIntegrationHealth({service,openaiKey:openai.apiKey,openaiModel:openai.model,googleToken:googleConnectionRecord?()=>googleAccessToken(service):null,whatsappToken:process.env.WHATSAPP_ACCESS_TOKEN,whatsappId:process.env.WHATSAPP_PHONE_NUMBER_ID,whatsappVersion:process.env.WHATSAPP_GRAPH_API_VERSION||'v23.0'});
      response.setHeader('Cache-Control','private, no-store');
      return response.status(200).json(applyIntegrationHealth(registry,checks));
    }
    if (request.method === 'GET' && action === 'command-dashboard') {
      response.setHeader('Cache-Control','private, no-store');
      return response.status(200).json(await commandDashboard(service, admin));
    }
    if (request.method === 'GET' && action === 'communications') {
      return response.status(200).json(await communicationInbox(service));
    }
    if (request.method === 'GET' && action === 'communication-center') {
      return response.status(200).json(await communicationCenter(service));
    }
    if (request.method === 'POST' && action === 'communication-template') {
      return response.status(200).json({ record: await saveCommunicationTemplate(service, request.body), message: 'Nachrichtenvorlage wurde gespeichert.' });
    }
    if (request.method === 'POST' && action === 'communication-campaign') {
      return response.status(200).json({ record: await saveCommunicationCampaign(service, request.body), message: request.body?.status === 'scheduled' ? 'Seriennachricht wurde geplant und wartet bis zur Mail-Anbindung auf den Versand.' : 'Seriennachricht wurde als Entwurf gespeichert.' });
    }
    if (request.method === 'POST' && action === 'communication-automation') {
      return response.status(200).json({ record: await saveCommunicationAutomation(service, request.body), message: 'Automatisierte Nachricht wurde gespeichert.' });
    }
    if (request.method === 'POST' && action === 'communication-signature') {
      return response.status(200).json({ record: await saveCommunicationSignature(service, request.body), message: 'Signatur wurde gespeichert und steht im Nachrichteneditor bereit.' });
    }
    if (request.method === 'POST' && action === 'communication-branding') {
      return response.status(200).json({ record: await saveSystemBranding(service, request.body), message: 'Globale Marke und Logoquelle wurden gespeichert.' });
    }
    if (request.method === 'PATCH' && action === 'communication-campaign-state') {
      const status = ['draft', 'scheduled', 'paused', 'cancelled'].includes(request.body?.status) ? request.body.status : 'draft';
      return response.status(200).json({ record: await patchCommunicationRecord(service, 'communication_campaigns', request.body?.id, { status }) });
    }
    if (request.method === 'PATCH' && action === 'communication-automation-state') {
      return response.status(200).json({ record: await patchCommunicationRecord(service, 'communication_automations', request.body?.id, { enabled: request.body?.enabled === true }) });
    }
    if (request.method === 'POST' && action === 'communication-draft') {
      const lead = await leadById(service, request.body?.leadId);
      const subject = clean(request.body?.subject, 220), messageBody = clean(request.body?.body, 10000);
      let signature = null;
      if (uuidValid(request.body?.signatureId)) {
        const signatureRows = await readJson(await fetch(`${service.url}/rest/v1/communication_signatures?id=eq.${encodeURIComponent(request.body.signatureId)}&active=eq.true&select=*&limit=1`, { headers: headers(service.key) }));
        signature = signatureRows[0] || null;
      }
      const body = `${messageBody}${signature ? `\n\n${signatureText(signature)}` : ''}`.slice(0, 20000);
      if (!subject || !messageBody) return response.status(400).json({ error: 'Empfänger, Betreff und Nachricht sind erforderlich.' });
      const record = await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, direction: 'outbound', channel: 'email', subject, preview: body.slice(0, 500), body, signature_id: signature?.id || null, delivery_status: 'draft' });
      return response.status(201).json({ record, message: 'Nachricht wurde als Entwurf gespeichert. Der Versand wird nach Anschluss der Domain-Mail-Schnittstelle aktiviert.' });
    }
    if (request.method === 'PATCH' && action === 'communication-read') {
      const id = clean(request.body?.id, 80);
      if (!uuidValid(id)) return response.status(400).json({ error: 'Gültige Nachrichten-ID fehlt.' });
      const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_communications?id=eq.${encodeURIComponent(id)}&direction=eq.inbound`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }), 'Nachricht konnte nicht als gelesen markiert werden.');
      return response.status(200).json({ record: rows[0] || null });
    }
    if (request.method === 'GET' && action === 'booking-settings') {
      return response.status(200).json({ settings: await bookingSettings(service) });
    }
    if (request.method === 'GET' && action === 'tariffs') {
      return response.status(200).json({ tariffs: await serviceTariffs(service) });
    }
    if (request.method === 'POST' && action === 'tariff') {
      return response.status(200).json({ record: await saveServiceTariff(service, request.body), message: 'Tarif wurde gespeichert und steht im Vertragsabschluss bereit.' });
    }
    if (request.method === 'PATCH' && action === 'booking-settings') {
      const settings = normalizeBookingSettings(request.body || {});
      const savedRows = await readJson(await fetch(`${service.url}/rest/v1/booking_settings?on_conflict=id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(bookingSettingsPayload(settings)) }), 'Termin-Einstellungen konnten nicht gespeichert werden.');
      if (!savedRows[0]) throw Object.assign(new Error('Die gespeicherte Termin-Verfügbarkeit konnte nicht bestätigt werden.'), { status: 500 });
      return response.status(200).json({ settings: normalizeBookingSettings(savedRows[0]) });
    }
    if (request.method === 'GET' && action === 'available-slots') {
      const result = await availableBookingSlots(service, { ...request.query, duration: Number(request.query?.duration) });
      return response.status(200).json(result);
    }
    if (request.method === 'POST' && action === 'create-video-contract') {
      const lead = await leadById(service, request.body?.id);
      const normalized = normalizeVideoContract(request.body?.contract, lead);
      if (request.body?.saveDraft !== true && normalized.missing.length) return response.status(400).json({ error: `Bitte ergänze zuerst: ${normalized.missing.join(', ')}.`, missingFields: normalized.missing });
      const now = new Date().toISOString();
      const existing = uuidValid(request.body?.contractId) ? await leadContractById(service, lead.id, request.body.contractId) : null;
      if (existing && existing.status !== 'draft') {
        return response.status(409).json({ error: 'Ein bereits dokumentierter Video-Abschluss kann nicht überschrieben werden. Lege dafür einen neuen Vertrag an.' });
      }
      const contractNumber = existing?.contract_number || await reserveContractNumber(service, normalized.contract.contractDate);
      const pdf = await buildVideoContractPdf(normalized.contract, { draft: true });
      const stored = await uploadCustomerObject(service, 'documents', lead.id, pdfUpload(pdf, `${contractNumber}-Videovertrag-Entwurf.pdf`));
      const amount = currencyNumber(normalized.contract.totalPrice);
      const payload = {
        title: normalized.contract.product, contract_number: existing?.contract_number || contractNumber,
        tariff_id: uuidValid(normalized.contract.tariffId) ? normalized.contract.tariffId : null,
        amount, status: 'draft', program_start_date: normalized.contract.serviceStart || null,
        contract_data: normalized.contract, document_bucket: stored.bucket, document_storage_path: stored.storagePath,
        document_mime_type: 'application/pdf', signature_method: null, updated_at: now,
      };
      const record = existing ? await patchLeadContract(service, lead.id, existing.id, payload, true) : await insertLeadRecord(service, 'lead_contracts', { lead_id: lead.id, ...payload });
      if (existing?.document_bucket && existing.document_storage_path !== stored.storagePath) await deleteCustomerObject(service, existing.document_bucket, existing.document_storage_path);
      return response.status(201).json({ record, documentUrl: `/api/leads?action=contract-download&id=${encodeURIComponent(lead.id)}&contractId=${encodeURIComponent(record.id)}` });
    }
    if (request.method === 'POST' && ['video-recording-upload','complete-video-recording-upload'].includes(action)) {
      const lead = await leadById(service, request.body?.id);
      const contract = await leadContractById(service, lead.id, request.body?.contractId);
      if (action === 'video-recording-upload') return response.status(200).json(await prepareRecordingUpload(service,lead,contract,request.body));
      const record = await completeRecordingUpload(service,lead,contract,request.body);
      return response.status(200).json({record,message:'Video vollständig gespeichert und der Vertragsakte zugeordnet.'});
    }
    if (request.method === 'POST' && action === 'begin-video-recording') {
      const lead = await leadById(service, request.body?.id);
      const contract = await leadContractById(service, lead.id, request.body?.contractId);
      const startedAt = await beginRecording(service,lead,contract,request.body);
      return response.status(200).json({startedAt,message:'Einwilligung zur Aufnahme protokolliert.'});
    }
    if (request.method === 'POST' && action === 'sync-google-meet-recording') {
      const lead = await leadById(service, request.body?.id);
      const contract = await leadContractById(service, lead.id, request.body?.contractId);
      if (!contract.video_recording_consent_at) return response.status(409).json({ error: 'Bitte protokolliere zuerst die Aufzeichnungseinwilligung.' });
      if (contract.video_recording_path && await customerObjectExists(service, contract.video_recording_bucket, contract.video_recording_path)) return response.status(200).json({ state: 'imported', record: contract, message: 'Die Google-Meet-Aufzeichnung ist bereits sicher in der Vertragsakte gespeichert.' });
      const connection = await googleConnection(service);
      if (!googleMeetRecordingReady(connection)) return response.status(409).json({ error: 'Google muss unter Einstellungen → Schnittstellen einmal neu verbunden werden, damit Meet-Aufzeichnungen übernommen werden dürfen.' });
      const accessToken = await googleAccessToken(service);
      const match = await findGoogleMeetRecording(accessToken, lead.meet_url, { notBefore: contract.video_recording_consent_at });
      if (!match.recording) {
        await patchLeadContract(service, lead.id, contract.id, { video_recording_provider: 'google_meet', google_meet_conference_record: match.conference?.name || null, google_meet_recording_state: 'awaiting_recording' });
        return response.status(202).json({ state: 'awaiting_recording', message: 'Noch keine Meet-Aufzeichnung gefunden. Starte und beende sie im laufenden Google Meet; das CRM prüft anschließend erneut.' });
      }
      const recording = match.recording;
      if (recording.state !== 'FILE_GENERATED' || !recording.driveDestination?.file) {
        await patchLeadContract(service, lead.id, contract.id, { video_recording_provider: 'google_meet', google_meet_conference_record: match.conference?.name || null, google_meet_recording_name: recording.name, google_meet_recording_state: recording.state === 'STARTED' ? 'recording' : 'processing' });
        return response.status(202).json({ state: recording.state === 'STARTED' ? 'recording' : 'processing', message: recording.state === 'STARTED' ? 'Die native Google-Meet-Aufzeichnung läuft noch. Beende sie zuerst in Meet.' : 'Google verarbeitet die beendete Aufzeichnung. Das CRM übernimmt sie automatisch, sobald die MP4 bereitsteht.' });
      }
      const driveFileId = String(recording.driveDestination.file).split('/').pop();
      const metadata = await googleDriveFileMetadata(accessToken, driveFileId);
      const source = await downloadGoogleDriveFile(accessToken, driveFileId);
      const imported = await importCustomerObject(service, 'contractRecordings', lead.id, {
        fileName: `${contract.contract_number || 'FDD-Videovertrag'}-Google-Meet.mp4`,
        mimeType: metadata.mimeType || 'video/mp4', byteSize: Number(metadata.size), sourceResponse: source,
      });
      const record = await patchLeadContract(service, lead.id, contract.id, {
        video_recording_provider: 'google_meet', video_recording_bucket: imported.bucket, video_recording_path: imported.storagePath,
        video_recording_mime_type: imported.mimeType, video_recording_bytes: imported.byteSize,
        video_recording_started_at: recording.startTime || contract.video_recording_started_at, video_recording_ended_at: recording.endTime || new Date().toISOString(),
        google_meet_conference_record: match.conference?.name || null, google_meet_recording_name: recording.name,
        google_drive_file_id: driveFileId, google_drive_export_uri: recording.driveDestination.exportUri || metadata.webViewLink || null,
        google_meet_recording_state: 'imported', video_recording_imported_at: new Date().toISOString(),
      });
      return response.status(200).json({ state: 'imported', record, message: 'Die native Google-Meet-Aufzeichnung wurde als MP4 sicher in der Vertragsakte gespeichert.' });
    }
    if (request.method === 'POST' && action === 'finalize-video-contract') {
      const lead = await leadById(service, request.body?.id);
      const existing = await leadContractById(service, lead.id, request.body?.contractId);
      if (!existing.video_recording_path || !await customerObjectExists(service, existing.video_recording_bucket, existing.video_recording_path)) return response.status(409).json({ error: 'Die Videoaufzeichnung wurde noch nicht vollständig hochgeladen.' });
      if (['browser_screen','device_upload'].includes(existing.video_recording_provider) && request.body?.recordingReviewed !== true) return response.status(400).json({error:'Bitte die gespeicherte Aufnahme ansehen und Bild sowie beide Gesprächsstimmen prüfen.'});
      const normalized = normalizeVideoContract({ ...(existing.contract_data || {}), ...(request.body?.contract || {}), answers: request.body?.answers || {} }, lead);
      if (normalized.missing.length) return response.status(400).json({ error: `Im Vertrag fehlen noch: ${normalized.missing.join(', ')}.` });
      const missingConfirmations = VIDEO_CONFIRMATION_KEYS.filter((key) => normalized.contract.answers[key] !== true);
      if (missingConfirmations.length || !normalized.contract.recordingConsent || !normalized.contract.recordingPurposeAccepted || !normalized.contract.recordingRevocationAccepted || !normalized.contract.finalContractConfirmed) return response.status(400).json({ error: 'Alle Video-Abschlussfragen und die ausdrückliche Aufzeichnungseinwilligung müssen einzeln mit Ja bestätigt sein.' });
      const now = new Date().toISOString();
      const finalPdf = await buildVideoContractPdf(normalized.contract, { videoConfirmed: true, providerConfirmed: true });
      const fileName = `${existing.contract_number || 'FDD-Videovertrag'}-Videoabschluss.pdf`;
      const stored = await uploadCustomerObject(service, 'documents', lead.id, pdfUpload(finalPdf, fileName));
      const signingToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(signingToken).digest('hex');
      const record = await patchLeadContract(service, lead.id, existing.id, {
        status: 'signed', signed_at: now, document_confirmed_at: now, video_contract_confirmed_at: now,
        video_recording_reviewed_at: request.body?.recordingReviewed === true ? now : existing.video_recording_reviewed_at,
        contract_data: normalized.contract, video_answers: normalized.contract.answers,
        video_recording_ended_at: existing.video_recording_ended_at || now, document_bucket: stored.bucket, document_storage_path: stored.storagePath,
        document_mime_type: 'application/pdf', signing_token_hash: tokenHash,
        signing_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), signature_method: 'video_confirmation',
      });
      if (existing.document_bucket && existing.document_storage_path && existing.document_storage_path !== stored.storagePath) await deleteCustomerObject(service, existing.document_bucket, existing.document_storage_path);
      const signingPath = `/contract-sign.html?token=${encodeURIComponent(signingToken)}`;
      const signingUrl = new URL(signingPath, process.env.PUBLIC_SITE_URL || 'https://findedeinding.vercel.app').href;
      await insertLeadRecord(service, 'lead_communications', {
        lead_id: lead.id, direction: 'outbound', channel: 'email', subject: 'Dein Finde-dein-Ding-Vertrag zur digitalen Bestätigung',
        preview: 'Der Video-Abschluss wurde dokumentiert. Der zusätzliche digitale Signaturlink ist versandbereit.',
        body: `Hallo ${lead.name},\n\nder Video-Abschluss wurde dokumentiert. Bitte prüfe deinen Vertrag und bestätige ihn zusätzlich digital:\n${signingUrl}\n\nHerzliche Grüße\nMarkus Becker`, delivery_status: 'draft',
      }).catch(() => null);
      const participant = await activateContractedLead(service, lead, normalized.contract.serviceStart);
      return response.status(200).json({ record, signingPath, participantActivated: Boolean(participant && !participant.alreadyActive), participant, message: 'Video-Abschluss dokumentiert. Der Signaturlink wurde als E-Mail-Entwurf angelegt.' });
    }
    if (request.method === 'GET' && ['contract-download', 'video-recording-download'].includes(action)) {
      const lead = await leadById(service, request.query?.id);
      const contract = await leadContractById(service, lead.id, request.query?.contractId);
      const bucket = action === 'contract-download' ? contract.document_bucket : contract.video_recording_bucket;
      const storagePath = action === 'contract-download' ? contract.document_storage_path : contract.video_recording_path;
      const url = await signedCustomerUrl(service, bucket, storagePath);
      if (!url) return response.status(404).json({ error: 'Die Datei ist noch nicht verfügbar.' });
      return response.redirect(302, url);
    }
    if (request.method === 'GET' && action === 'dashboard') return response.status(200).json(await leadDashboard(service, request.query?.id));
    if (request.method === 'POST' && action === 'set-interest-status') return response.status(200).json(await setLeadInterestStatus(service, request));
    if (request.method === 'POST' && action === 'dashboard-record') {
      const result = await recordDashboardMutation(service, request);
      return response.status(200).json({ ok: true, ...result });
    }
    if (request.method === 'GET') {
      const leads = await readJson(await fetch(`${service.url}/rest/v1/leads?select=*&order=created_at.desc&limit=200`, { headers: headers(service.key) }), 'Leads konnten nicht geladen werden.');
      return response.status(200).json({ leads });
    }
    if (request.method === 'PATCH' && action === 'update') {
      const current = await leadById(service, request.body?.id);
      const firstName = clean(request.body?.firstName, 80), lastName = clean(request.body?.lastName, 80);
      const name = clean(`${firstName} ${lastName}`, 120) || current.name;
      const email = clean(request.body?.email, 254).toLowerCase();
      const requestedStatus = VALID_STATUSES.includes(request.body?.status) ? request.body.status : current.status;
      const status = current.converted_user_profile_id ? 'customer' : requestedStatus;
      if (!name || !emailValid(email)) return response.status(400).json({ error: 'Name und gültige E-Mail sind erforderlich.' });
      if (current.converted_user_profile_id && email !== current.email) return response.status(409).json({ error: 'Die E-Mail eines Kunden wird sicher über Portal-Login geändert.' });
      if (status === 'customer' && !current.converted_user_profile_id) return response.status(409).json({ error: 'Ein Lead wird erst durch einen vollständig bestätigten Vertragsabschluss automatisch zum Teilnehmer.' });
      const mobilePhone = clean(request.body?.mobilePhone, 40);
      const whatsappSameAsMobile = request.body?.whatsappSameAsMobile !== false;
      const whatsappPhone = whatsappSameAsMobile ? mobilePhone : clean(request.body?.whatsappPhone, 40);
      if (!firstName || !lastName || !mobilePhone) return response.status(400).json({ error: 'Vorname, Nachname, E-Mail-Adresse und Mobilnummer sind Pflichtfelder.' });
      if (!whatsappSameAsMobile && !whatsappPhone) return response.status(400).json({ error: 'Bitte die abweichende WhatsApp-Nummer ergänzen.' });
      const lead = await patchLead(service, current.id, { first_name: firstName, last_name: lastName, name, email, mobile_phone: mobilePhone, phone: clean(request.body?.phone, 40) || null, whatsapp_phone: whatsappPhone || null, whatsapp_same_as_mobile: whatsappSameAsMobile, challenge: request.body?.challenge === undefined ? current.challenge || null : clean(request.body.challenge, 1000) || null, internal_notes: request.body?.internalNotes === undefined ? current.internal_notes || null : clean(request.body.internalNotes, 10000) || null, qualification_answers: qualificationAnswers(request.body?.qualificationAnswers), status });
      return response.status(200).json({ lead });
    }
    if (request.method === 'POST' && action === 'schedule') {
      const lead = await leadById(service, request.body?.id);
      const startDate = new Date(request.body?.start), duration = Number(request.body?.duration || 45);
      if (Number.isNaN(startDate.getTime()) || ![30, 45, 60, 90].includes(duration)) return response.status(400).json({ error: 'Gültiger Termin und Dauer erforderlich.' });
      if (startDate.getTime() < Date.now() - 60000) return response.status(400).json({ error: 'Der Termin muss in der Zukunft liegen.' });
      const settings = await bookingSettings(service);
      if (!isWithinBookingAvailability(startDate, duration, settings)) return response.status(409).json({ error: 'Dieser Termin liegt außerhalb deiner freigegebenen Buchungszeiten.' });
      const endDate = new Date(startDate.getTime() + duration * 60000), accessToken = await optionalGoogleAccessToken(service);
      const unchangedAppointment = lead.calendar_event_id && lead.appointment_start === startDate.toISOString() && lead.appointment_end === endDate.toISOString();
      if (accessToken && !unchangedAppointment) await assertCalendarAvailable(accessToken, startDate.toISOString(), endDate.toISOString());
      const event = accessToken ? await saveCalendarEvent(accessToken, lead, startDate.toISOString(), endDate.toISOString(), { notifyAttendees: false }) : null;
      const meetUrl = event?.hangoutLink || event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || lead.meet_url || null;
      const updated = await patchLead(service, lead.id, { appointment_start: startDate.toISOString(), appointment_end: endDate.toISOString(), appointment_timezone: 'Europe/Berlin', calendar_event_id: event?.id || null, calendar_event_url: event?.htmlLink || null, meet_url: meetUrl, appointment_confirmation_prepared_at: null, status: lead.converted_user_profile_id ? 'customer' : 'scheduled' });
      if (lead.converted_user_profile_id && event?.id) await readJson(await fetch(`${service.url}/rest/v1/customer_appointments?on_conflict=google_event_id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify({ user_profile_id: lead.converted_user_profile_id, lead_id: lead.id, title: 'Kundengespräch', starts_at: startDate.toISOString(), ends_at: endDate.toISOString(), timezone: 'Europe/Berlin', google_event_id: event.id, google_event_url: event.htmlLink || null, meet_url: meetUrl, status: 'scheduled', source: 'google_calendar', updated_at: new Date().toISOString() }) }), 'Der Kundentermin konnte nicht synchronisiert werden.');
      return response.status(200).json({ lead: updated, event: event ? { id: event.id, htmlLink: event.htmlLink, meetUrl } : null, calendarConnected: Boolean(accessToken) });
    }
    if (request.method === 'POST' && action === 'complete-sales-conversation') {
      let lead = await leadById(service, request.body?.id);
      if (!lead.appointment_start || !lead.appointment_end) return response.status(409).json({ error: 'Bitte plane zuerst einen freien Termin.' });
      const now = new Date().toISOString();
      let calendarNotified = false;
      const accessToken = await optionalGoogleAccessToken(service);
      if (accessToken && !lead.appointment_confirmation_prepared_at) {
        const event = await saveCalendarEvent(accessToken, lead, lead.appointment_start, lead.appointment_end, { notifyAttendees: true });
        const meetUrl = event?.hangoutLink || event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || lead.meet_url || null;
        lead = await patchLead(service, lead.id, { calendar_event_id: event?.id || lead.calendar_event_id, calendar_event_url: event?.htmlLink || lead.calendar_event_url, meet_url: meetUrl });
        calendarNotified = true;
      }
      if (!lead.appointment_confirmation_prepared_at) {
        const appointmentLabel = new Date(lead.appointment_start).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone: lead.appointment_timezone || 'Europe/Berlin' });
        const meetLine = lead.meet_url ? `\nGoogle Meet: ${lead.meet_url}` : '\nDer Google-Meet-Link wird ergänzt, sobald die Google-Schnittstelle verbunden ist.';
        await insertLeadRecord(service, 'lead_communications', {
          lead_id: lead.id, direction: 'outbound', channel: 'email', subject: 'Dein Klarheitsgespräch ist bestätigt',
          preview: `Dein Klarheitsgespräch am ${appointmentLabel} ist bestätigt.`,
          body: `Hallo ${lead.first_name || lead.name},\n\ndein Klarheitsgespräch findet am ${appointmentLabel} statt.${meetLine}\n\nHerzliche Grüße\nMarkus Becker`,
          delivery_status: calendarNotified ? 'sent' : 'draft',
        });
      }
      const completedStatus = lead.converted_user_profile_id ? 'customer' : ['offer', 'later', 'lost'].includes(lead.status) ? lead.status : 'consultation';
      const completed = await patchLead(service, lead.id, { sales_conversation_completed_at: now, appointment_confirmation_prepared_at: lead.appointment_confirmation_prepared_at || now, status: completedStatus });
      return response.status(200).json({ lead: completed, calendarNotified, mailStatus: calendarNotified ? 'sent' : 'draft', message: calendarNotified ? 'Verkaufsgespräch abgeschlossen. Google-Einladung und Terminbestätigung wurden versendet.' : 'Verkaufsgespräch abgeschlossen. Die Terminbestätigung ist als E-Mail-Entwurf vorbereitet; Google Calendar ist noch nicht verbunden.' });
    }
    if (request.method === 'POST' && action === 'cancel-appointment') {
      const lead = await leadById(service, request.body?.id);
      if (lead.calendar_event_id) await deleteCalendarEvent(await googleAccessToken(service), lead.calendar_event_id);
      if (lead.converted_user_profile_id && lead.calendar_event_id) await fetch(`${service.url}/rest/v1/customer_appointments?google_event_id=eq.${encodeURIComponent(lead.calendar_event_id)}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }) });
      const updated = await patchLead(service, lead.id, { appointment_start: null, appointment_end: null, calendar_event_id: null, calendar_event_url: null, meet_url: null, status: lead.status === 'customer' ? 'customer' : 'contacted' });
      return response.status(200).json({ lead: updated });
    }
    if (request.method === 'POST' && action === 'convert') {
      const lead = await leadById(service, request.body?.id);
      if (lead.converted_user_profile_id) return response.status(409).json({ error: 'Für diesen Lead wurde bereits ein Kundenkonto angelegt.' });
      const contract = await completedContract(service, lead.id);
      if (!contract) return response.status(409).json({ error: 'Teilnehmer-Aktivierung gesperrt: Vertragsdokument und Videovertrag müssen vollständig bestätigt sein.' });
      const participant = await activateContractedLead(service, lead, contract.program_start_date || request.body?.programStartDate);
      return response.status(200).json({ lead: await leadById(service, lead.id), profile: { id: participant.profileId, name: participant.name, email: participant.email, loginName: participant.loginName, customerNumber: participant.customerNumber }, oneTimePassword: participant.oneTimePassword, invitationSent: true });
    }
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Lead-Workflow konnte nicht verarbeitet werden.' });
  }
}
