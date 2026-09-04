import { DEFAULT_BOOKING_SETTINGS, generateAvailableSlots, isWithinBookingAvailability, normalizeBookingSettings } from '../lib/booking-availability.js';
import { authorizationUrl, assertCalendarAvailable, calendarBusyIntervals, decryptCredential, deleteCalendarEvent, emailFromIdToken, encryptCredential, exchangeAuthorizationCode, googleConfig, refreshAccessToken, saveCalendarEvent, verifyOAuthState } from '../lib/google-calendar.js';
import { provisionProgramUser, requireCurrentAdmin, supabaseAuthConfig } from '../lib/user-auth.js';

const VALID_STATUSES = ['new', 'contacted', 'scheduled', 'consultation', 'offer', 'customer', 'lost'];
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailValid = (value) => /^\S+@\S+\.\S+$/.test(value || '');
const uuidValid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

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

async function patchLead(service, id, changes) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }) }), 'Lead konnte nicht gespeichert werden.');
  if (!rows[0]) throw Object.assign(new Error('Lead wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

async function insertLeadRecord(service, table, payload) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/${table}`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify(payload) }), 'CRM-Eintrag konnte nicht gespeichert werden.');
  return rows[0] || null;
}

async function activateContractedLead(service, lead, programStartDate) {
  if (lead.converted_user_profile_id) return { profileId: lead.converted_user_profile_id, alreadyActive: true };
  const profile = await provisionProgramUser(service, { name: lead.name, email: lead.email, startDate: programStartDate, permissions: ['customer_portal', 'clara_program', 'documents'] });
  await patchLead(service, lead.id, { status: 'customer', converted_user_profile_id: profile.id, converted_at: new Date().toISOString() });
  await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, direction: 'outbound', subject: 'Kundenportal-Zugang versendet', preview: 'Vertragsdokument und Videovertrag sind bestätigt. Der neue Teilnehmer hat die E-Mail zur sicheren Passwortvergabe erhalten.' }).catch(() => null);
  return { profileId: profile.id, name: profile.name, email: profile.email, alreadyActive: false };
}

async function completedContract(service, leadId) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/lead_contracts?lead_id=eq.${encodeURIComponent(leadId)}&status=eq.signed&document_confirmed_at=not.is.null&video_contract_confirmed_at=not.is.null&select=*&order=signed_at.desc&limit=1`, { headers: headers(service.key) }), 'Vertragsstatus konnte nicht geprüft werden.');
  return rows[0] || null;
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
    const amount = Number(request.body?.amount);
    const status = ['draft', 'sent', 'signed', 'cancelled'].includes(request.body?.status) ? request.body.status : 'draft';
    const title = clean(request.body?.title, 180);
    if (!title || !Number.isFinite(amount) || amount < 0) throw Object.assign(new Error('Vertragsbezeichnung und gültiger Betrag sind erforderlich.'), { status: 400 });
    const now = new Date().toISOString();
    const documentConfirmed = request.body?.documentConfirmed === 'true' || request.body?.documentConfirmed === true;
    const videoContractConfirmed = request.body?.videoContractConfirmed === 'true' || request.body?.videoContractConfirmed === true;
    const programStartDate = /^\d{4}-\d{2}-\d{2}$/.test(request.body?.programStartDate || '') ? request.body.programStartDate : now.slice(0, 10);
    const record = await insertLeadRecord(service, 'lead_contracts', { lead_id: lead.id, title, contract_number: clean(request.body?.contractNumber, 80) || null, amount, status, signed_at: status === 'signed' ? now : null, document_confirmed_at: documentConfirmed ? now : null, video_contract_confirmed_at: videoContractConfirmed ? now : null, program_start_date: programStartDate });
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
    if (!subject) throw Object.assign(new Error('Ein Betreff ist erforderlich.'), { status: 400 });
    return { record: await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, subject, direction, preview: clean(request.body?.preview, 2000) || null }) };
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

async function googleConnection(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/integration_settings?provider=eq.google_calendar&select=encrypted_credentials,connected_email,updated_at&limit=1`, { headers: headers(service.key) }), 'Google-Verbindung konnte nicht geladen werden.');
  if (!rows[0]?.encrypted_credentials) throw Object.assign(new Error('Google Calendar ist noch nicht mit dem CRM verbunden.'), { status: 409 });
  return rows[0];
}

async function googleAccessToken(service) {
  const connection = await googleConnection(service);
  return refreshAccessToken(decryptCredential(connection.encrypted_credentials));
}

async function bookingSettings(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/booking_settings?id=eq.default&select=*&limit=1`, { headers: headers(service.key) }), 'Termin-Einstellungen konnten nicht geladen werden.');
  return normalizeBookingSettings(rows[0] || DEFAULT_BOOKING_SETTINGS);
}

function bookingSettingsPayload(settings) {
  return {
    id: 'default',
    timezone: settings.timezone,
    weekly_availability: settings.weeklyAvailability,
    slot_interval_minutes: settings.slotIntervalMinutes,
    default_duration_minutes: settings.defaultDurationMinutes,
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
  const payload = { name, email, phone: clean(request.body?.phone, 40) || null, challenge: clean(request.body?.challenge, 500) || null, source: clean(request.body?.source, 80) || 'website', utm_source: clean(request.body?.utm_source, 100) || null, utm_medium: clean(request.body?.utm_medium, 100) || null, utm_campaign: clean(request.body?.utm_campaign, 150) || null, consent_at: request.body?.consent ? new Date().toISOString() : null };
  if (!payload.consent_at) return response.status(400).json({ error: 'Bitte bestätige die Datenschutzhinweise.' });
  await readJson(await fetch(`${service.url}/rest/v1/leads`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=minimal' }), body: JSON.stringify(payload) }), 'Lead konnte nicht gespeichert werden.');
  return response.status(201).json({ ok: true });
}

export default async function handler(request, response) {
  const service = serviceConfig();
  const action = request.query?.action || request.body?.action || '';
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'POST' && !action) {
    try { return await publicLead(request, response, service); }
    catch (error) { return response.status(error.status || 500).json({ error: error.message }); }
  }
  const admin = await requireCurrentAdmin(request, response);
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
      const payload = { provider: 'google_calendar', encrypted_credentials: encryptCredential(tokens.refresh_token), connected_email: emailFromIdToken(tokens.id_token) || admin.email, updated_at: new Date().toISOString() };
      await readJson(await fetch(`${service.url}/rest/v1/integration_settings?on_conflict=provider`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(payload) }), 'Google-Verbindung konnte nicht gespeichert werden.');
      return response.redirect(302, '/admin?view=settings&section=integrations&google=connected');
    }
    if (request.method === 'GET' && action === 'google-status') {
      const configured = Boolean(googleConfig());
      let connection = null;
      if (configured) connection = await googleConnection(service).catch(() => null);
      return response.status(200).json({ configured, connected: Boolean(connection), email: connection?.connected_email || null, updatedAt: connection?.updated_at || null });
    }
    if (request.method === 'GET' && action === 'booking-settings') {
      return response.status(200).json({ settings: await bookingSettings(service) });
    }
    if (request.method === 'PATCH' && action === 'booking-settings') {
      const settings = normalizeBookingSettings(request.body || {});
      await readJson(await fetch(`${service.url}/rest/v1/booking_settings?on_conflict=id`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(bookingSettingsPayload(settings)) }), 'Termin-Einstellungen konnten nicht gespeichert werden.');
      return response.status(200).json({ settings });
    }
    if (request.method === 'GET' && action === 'available-slots') {
      const settings = await bookingSettings(service);
      const candidates = generateAvailableSlots({ settings, from: clean(request.query?.from, 10), to: clean(request.query?.to, 10), duration: Number(request.query?.duration), now: new Date() });
      if (!candidates.length) return response.status(200).json({ settings, slots: [] });
      const accessToken = await googleAccessToken(service);
      const busyIntervals = await calendarBusyIntervals(accessToken, candidates[0].start, candidates.at(-1).end);
      const slots = generateAvailableSlots({ settings, from: clean(request.query?.from, 10), to: clean(request.query?.to, 10), duration: Number(request.query?.duration), busyIntervals, now: new Date() });
      return response.status(200).json({ settings, slots });
    }
    if (request.method === 'GET' && action === 'dashboard') return response.status(200).json(await leadDashboard(service, request.query?.id));
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
      const status = VALID_STATUSES.includes(request.body?.status) ? request.body.status : current.status;
      if (!name || !emailValid(email)) return response.status(400).json({ error: 'Name und gültige E-Mail sind erforderlich.' });
      if (status === 'customer' && !current.converted_user_profile_id) return response.status(409).json({ error: 'Ein Lead wird erst durch einen vollständig bestätigten Vertragsabschluss automatisch zum Teilnehmer.' });
      const lead = await patchLead(service, current.id, { first_name: firstName || null, last_name: lastName || null, name, email, phone: clean(request.body?.phone, 40) || null, challenge: clean(request.body?.challenge, 1000) || null, internal_notes: clean(request.body?.internalNotes, 10000) || null, qualification_answers: qualificationAnswers(request.body?.qualificationAnswers), status });
      return response.status(200).json({ lead });
    }
    if (request.method === 'POST' && action === 'schedule') {
      const lead = await leadById(service, request.body?.id);
      const startDate = new Date(request.body?.start), duration = Number(request.body?.duration || 45);
      if (Number.isNaN(startDate.getTime()) || ![30, 45, 60, 90].includes(duration)) return response.status(400).json({ error: 'Gültiger Termin und Dauer erforderlich.' });
      if (startDate.getTime() < Date.now() - 60000) return response.status(400).json({ error: 'Der Termin muss in der Zukunft liegen.' });
      const settings = await bookingSettings(service);
      if (!isWithinBookingAvailability(startDate, duration, settings)) return response.status(409).json({ error: 'Dieser Termin liegt außerhalb deiner freigegebenen Buchungszeiten.' });
      const endDate = new Date(startDate.getTime() + duration * 60000), accessToken = await googleAccessToken(service);
      const unchangedAppointment = lead.calendar_event_id && lead.appointment_start === startDate.toISOString() && lead.appointment_end === endDate.toISOString();
      if (!unchangedAppointment) await assertCalendarAvailable(accessToken, startDate.toISOString(), endDate.toISOString());
      const event = await saveCalendarEvent(accessToken, lead, startDate.toISOString(), endDate.toISOString());
      const meetUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || lead.meet_url || null;
      const updated = await patchLead(service, lead.id, { appointment_start: startDate.toISOString(), appointment_end: endDate.toISOString(), appointment_timezone: 'Europe/Berlin', calendar_event_id: event.id, calendar_event_url: event.htmlLink || lead.calendar_event_url, meet_url: meetUrl, status: 'scheduled' });
      await insertLeadRecord(service, 'lead_communications', { lead_id: lead.id, direction: 'outbound', subject: 'Kalendereinladung zum Erstgespräch', preview: `Termin am ${startDate.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} mit Google Meet.` }).catch(() => null);
      return response.status(200).json({ lead: updated, event: { id: event.id, htmlLink: event.htmlLink, meetUrl } });
    }
    if (request.method === 'POST' && action === 'cancel-appointment') {
      const lead = await leadById(service, request.body?.id);
      if (lead.calendar_event_id) await deleteCalendarEvent(await googleAccessToken(service), lead.calendar_event_id);
      const updated = await patchLead(service, lead.id, { appointment_start: null, appointment_end: null, calendar_event_id: null, calendar_event_url: null, meet_url: null, status: lead.status === 'customer' ? 'customer' : 'contacted' });
      return response.status(200).json({ lead: updated });
    }
    if (request.method === 'POST' && action === 'convert') {
      const lead = await leadById(service, request.body?.id);
      if (lead.converted_user_profile_id) return response.status(409).json({ error: 'Für diesen Lead wurde bereits ein Kundenkonto angelegt.' });
      const contract = await completedContract(service, lead.id);
      if (!contract) return response.status(409).json({ error: 'Teilnehmer-Aktivierung gesperrt: Vertragsdokument und Videovertrag müssen vollständig bestätigt sein.' });
      const participant = await activateContractedLead(service, lead, contract.program_start_date || request.body?.programStartDate);
      return response.status(200).json({ lead: await leadById(service, lead.id), profile: { id: participant.profileId, name: participant.name, email: participant.email }, invitationSent: true });
    }
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Lead-Workflow konnte nicht verarbeitet werden.' });
  }
}
