import { authorizationUrl, assertCalendarAvailable, decryptCredential, deleteCalendarEvent, emailFromIdToken, encryptCredential, exchangeAuthorizationCode, googleConfig, refreshAccessToken, saveCalendarEvent, verifyOAuthState } from '../lib/google-calendar.js';
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

async function googleConnection(service) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/integration_settings?provider=eq.google_calendar&select=encrypted_credentials,connected_email,updated_at&limit=1`, { headers: headers(service.key) }), 'Google-Verbindung konnte nicht geladen werden.');
  if (!rows[0]?.encrypted_credentials) throw Object.assign(new Error('Google Calendar ist noch nicht mit dem CRM verbunden.'), { status: 409 });
  return rows[0];
}

async function googleAccessToken(service) {
  const connection = await googleConnection(service);
  return refreshAccessToken(decryptCredential(connection.encrypted_credentials));
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
      if (request.query?.error) return response.redirect(302, `/admin?view=leads&google=error&reason=${encodeURIComponent(request.query.error)}`);
      if (!verifyOAuthState(request.query?.state, admin.profileId)) return response.status(400).send('Ungültiger oder abgelaufener Google-Verbindungsversuch.');
      const tokens = await exchangeAuthorizationCode(request.query?.code);
      if (!tokens.refresh_token) return response.status(409).send('Google hat keinen dauerhaften Zugriff erteilt. Bitte die Verbindung erneut starten.');
      const payload = { provider: 'google_calendar', encrypted_credentials: encryptCredential(tokens.refresh_token), connected_email: emailFromIdToken(tokens.id_token) || admin.email, updated_at: new Date().toISOString() };
      await readJson(await fetch(`${service.url}/rest/v1/integration_settings?on_conflict=provider`, { method: 'POST', headers: headers(service.key, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(payload) }), 'Google-Verbindung konnte nicht gespeichert werden.');
      return response.redirect(302, '/admin?view=leads&google=connected');
    }
    if (request.method === 'GET' && action === 'google-status') {
      const configured = Boolean(googleConfig());
      let connection = null;
      if (configured) connection = await googleConnection(service).catch(() => null);
      return response.status(200).json({ configured, connected: Boolean(connection), email: connection?.connected_email || null, updatedAt: connection?.updated_at || null });
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
      const lead = await patchLead(service, current.id, { first_name: firstName || null, last_name: lastName || null, name, email, phone: clean(request.body?.phone, 40) || null, challenge: clean(request.body?.challenge, 1000) || null, internal_notes: clean(request.body?.internalNotes, 10000) || null, qualification_answers: qualificationAnswers(request.body?.qualificationAnswers), status });
      return response.status(200).json({ lead });
    }
    if (request.method === 'POST' && action === 'schedule') {
      const lead = await leadById(service, request.body?.id);
      const startDate = new Date(request.body?.start), duration = Number(request.body?.duration || 45);
      if (Number.isNaN(startDate.getTime()) || ![30, 45, 60, 90].includes(duration)) return response.status(400).json({ error: 'Gültiger Termin und Dauer erforderlich.' });
      if (startDate.getTime() < Date.now() - 60000) return response.status(400).json({ error: 'Der Termin muss in der Zukunft liegen.' });
      const endDate = new Date(startDate.getTime() + duration * 60000), accessToken = await googleAccessToken(service);
      if (!lead.calendar_event_id) await assertCalendarAvailable(accessToken, startDate.toISOString(), endDate.toISOString());
      const event = await saveCalendarEvent(accessToken, lead, startDate.toISOString(), endDate.toISOString());
      const meetUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri || lead.meet_url || null;
      const updated = await patchLead(service, lead.id, { appointment_start: startDate.toISOString(), appointment_end: endDate.toISOString(), appointment_timezone: 'Europe/Berlin', calendar_event_id: event.id, calendar_event_url: event.htmlLink || lead.calendar_event_url, meet_url: meetUrl, status: 'scheduled' });
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
      const firstName = clean(request.body?.firstName, 80), lastName = clean(request.body?.lastName, 80), name = clean(`${firstName} ${lastName}`, 120) || lead.name;
      const email = clean(request.body?.email || lead.email, 254).toLowerCase();
      const permissions = Array.isArray(request.body?.permissions) ? request.body.permissions : ['customer_portal', 'clara_program', 'documents'];
      const profile = await provisionProgramUser(service, { name, email, startDate: request.body?.programStartDate, permissions });
      const updated = await patchLead(service, lead.id, { first_name: firstName || lead.first_name, last_name: lastName || lead.last_name, name, email, status: 'customer', converted_user_profile_id: profile.id, converted_at: new Date().toISOString() });
      return response.status(200).json({ lead: updated, profile: { id: profile.id, name: profile.name, email: profile.email }, invitationSent: true });
    }
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Lead-Workflow konnte nicht verarbeitet werden.' });
  }
}
