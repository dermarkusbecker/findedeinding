import { authHeaders, profileById, provisionProgramUser, randomTemporaryPassword, requireCurrentAdmin, sendPasswordReset, supabaseAuthConfig } from '../lib/user-auth.js';
import { handleCustomerRecords } from '../lib/customer-records-service.js';
import { calculateProgramAccess } from '../lib/program-access.js';
import { reconcileAccessFromEntries } from '../lib/program-position.js';
import { splitContactName } from '../lib/contact-lifecycle.js';

function config() { const auth = supabaseAuthConfig(); return auth ? { ...auth, key: auth.serviceKey } : null; }
function headers(key, extra = {}) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }; }
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

async function readJson(result, fallback = 'Supabase-Anfrage fehlgeschlagen.') {
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(payload.message || payload.error || fallback), { status: result.status });
  return payload;
}

async function createManualCustomer(service, body = {}) {
  const name = clean(body.name, 160);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 40);
  const programStartDate = validDate(body.programStartDate) ? body.programStartDate : new Date().toISOString().slice(0, 10);
  if (!name || !validEmail(email)) throw Object.assign(new Error('Vollständiger Name und gültige E-Mail-Adresse sind erforderlich.'), { status: 400 });

  const existingProfiles = await readJson(await fetch(`${service.url}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=id,role&limit=1`, { headers: headers(service.key) }));
  if (existingProfiles[0]) throw Object.assign(new Error(existingProfiles[0].role === 'user' ? 'Für diese E-Mail-Adresse besteht bereits ein Kunde.' : 'Diese E-Mail-Adresse gehört bereits zu einem internen Benutzerkonto.'), { status: 409 });

  const matchingLeads = await readJson(await fetch(`${service.url}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&select=id,converted_user_profile_id&order=created_at.desc&limit=20`, { headers: headers(service.key) }));
  if (matchingLeads.some((lead) => lead.converted_user_profile_id)) throw Object.assign(new Error('Der zugehörige Interessent wurde bereits in einen Kunden umgewandelt.'), { status: 409 });
  const now = new Date().toISOString();
  const { firstName, lastName } = splitContactName(name);
  let lead = matchingLeads[0] || null;
  if (!lead) {
    const createdLeads = await readJson(await fetch(`${service.url}/rest/v1/leads`, {
      method: 'POST',
      headers: headers(service.key, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        name,
        first_name: firstName || null,
        last_name: lastName || null,
        email,
        phone: phone || null,
        source: 'manual_crm',
        challenge: 'Kunde wurde manuell durch das FindeDeinDing-Team angelegt.',
        status: 'new',
        consent_at: now,
        qualification_answers: { manual_customer_creation: true, recorded_at: now },
      }),
    }), 'Die verknüpfte Kundenakte konnte nicht angelegt werden.');
    lead = createdLeads[0];
  }

  const participant = await provisionProgramUser(service, {
    name,
    email,
    phone,
    startDate: programStartDate,
    sourceLeadId: lead.id,
    permissions: ['customer_portal', 'clara_program', 'documents'],
    sendInvitation: body.sendInvitation === true,
  });
  const profileChanges = {
    birth_date: validDate(body.birthDate) ? body.birthDate : null,
    street: clean(body.street, 200) || null,
    postal_code: clean(body.postalCode, 20) || null,
    city: clean(body.city, 120) || null,
    country: clean(body.country, 80) || 'Deutschland',
    mobile_phone: clean(body.mobilePhone, 40) || null,
    preferred_communication_channel: ['email', 'phone', 'whatsapp'].includes(body.preferredCommunicationChannel) ? body.preferredCommunicationChannel : 'email',
    postal_mail_active: true,
  };
  const profiles = await readJson(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(participant.id)}`, {
    method: 'PATCH',
    headers: headers(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify(profileChanges),
  }), 'Die Kundenstammdaten konnten nicht gespeichert werden.');
  await readJson(await fetch(`${service.url}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    headers: headers(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      name,
      first_name: firstName || null,
      last_name: lastName || null,
      email,
      phone: phone || null,
      status: 'customer',
      converted_user_profile_id: participant.id,
      converted_at: now,
      updated_at: now,
    }),
  }), 'Die 1:1-Verknüpfung zur Kundenakte konnte nicht abgeschlossen werden.');
  return { participant: profiles[0], oneTimePassword: participant.oneTimePassword, invitationSent: body.sendInvitation === true };
}

export function summarizeCustomerProgress(gates = [], progress = {}, entries = [], now = new Date(), fullProgramAccess = false) {
  const storedProgress = typeof progress === 'object' && progress !== null ? progress : { current_week: Number(progress) || 0 };
  const scheduled = calculateProgramAccess({ progress: storedProgress, gates, now, fullProgramAccess });
  const canonical = reconcileAccessFromEntries({ access: scheduled, progress: storedProgress, entries: Array.isArray(entries) ? entries : [] });
  return {
    completed_weeks: canonical.completedWeeks,
    process_week: canonical.processWeek,
    released_week: canonical.currentWeek,
    completion_percent: Math.round(canonical.completedWeeks.length / 8 * 100),
  };
}

export default async function handler(request, response) {
  if (['overview', 'document-download', 'document-upload', 'avatar-upload', 'whatsapp-send'].includes(request.query?.action || request.body?.action)) return handleCustomerRecords(request, response);
  const requiredPermission = request.method === 'GET' ? ['customers', 'program', 'sales_calls'] : request.method === 'POST' ? 'customers' : ['customers', 'program'];
  const admin = await requireCurrentAdmin(request, response, requiredPermission);
  if (!admin) return;
  const service = config();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'GET') {
    const [result, linksResult, gatesResult, entriesResult] = await Promise.all([
      fetch(`${service.url}/rest/v1/user_profiles?role=eq.user&select=*,participant_progress!inner(*)&order=created_at.desc`, { headers: headers(service.key) }),
      fetch(`${service.url}/rest/v1/leads?converted_user_profile_id=not.is.null&status=eq.customer&select=id,converted_user_profile_id,converted_at,created_at`, { headers: headers(service.key) }),
      fetch(`${service.url}/rest/v1/week_gates?required=eq.true&select=user_profile_id,week,required,completed_at&limit=5000`, { headers: headers(service.key) }),
      fetch(`${service.url}/rest/v1/process_entries?data_block=like.week_*_state&select=user_profile_id,week,data_block,structured_data,created_at&order=created_at.desc&limit=10000`, { headers: headers(service.key) }),
    ]);
    const participants = await result.json(), links = await linksResult.json(), gates = await gatesResult.json(), entries = await entriesResult.json();
    if (!result.ok) return response.status(result.status).json({ error: participants.message });
    if (!linksResult.ok) return response.status(linksResult.status).json({ error: links.message });
    if (!gatesResult.ok) return response.status(gatesResult.status).json({ error: gates.message });
    if (!entriesResult.ok) return response.status(entriesResult.status).json({ error: entries.message });
    const leadByCustomer = new Map(links.map((lead) => [lead.converted_user_profile_id, lead]));
    const gatesByCustomer = new Map();
    gates.forEach((gate) => {
      const rows = gatesByCustomer.get(gate.user_profile_id) || [];
      rows.push(gate);
      gatesByCustomer.set(gate.user_profile_id, rows);
    });
    const entriesByCustomer = new Map();
    entries.forEach((entry) => {
      const rows = entriesByCustomer.get(entry.user_profile_id) || [];
      rows.push(entry);
      entriesByCustomer.set(entry.user_profile_id, rows);
    });
    const fullCustomerAccess = admin.staffPermissions.some((permission) => ['customers', 'program'].includes(permission));
    const customers = participants.filter((participant) => leadByCustomer.has(participant.id)).map((participant) => {
      const lead = leadByCustomer.get(participant.id);
      const progress = participant.participant_progress?.[0] || {};
      const visibleProfile = fullCustomerAccess ? participant : {
        id: participant.id, name: participant.name, email: participant.email, phone: participant.phone,
        mobile_phone: participant.mobile_phone, birth_date: participant.birth_date, street: participant.street,
        postal_code: participant.postal_code, city: participant.city, country: participant.country,
        preferred_communication_channel: participant.preferred_communication_channel,
        participant_progress: participant.participant_progress, created_at: participant.created_at,
      };
      return {
        ...visibleProfile,
        linked_lead_id: participant.source_lead_id || lead.id,
        customer_since: lead.converted_at || lead.created_at || participant.created_at,
        ...summarizeCustomerProgress(gatesByCustomer.get(participant.id) || [], progress, entriesByCustomer.get(participant.id) || [], new Date(), participant.permissions?.includes('demo_full_access')),
      };
    });
    return response.status(200).json({ participants: customers });
  }
  if (request.method === 'POST') {
    try {
      return response.status(201).json(await createManualCustomer(service, request.body || {}));
    } catch (error) {
      return response.status(error.status || 500).json({ error: error.message || 'Kunde konnte nicht angelegt werden.' });
    }
  }
  if (request.method === 'PATCH') {
    try {
      const id = typeof request.body?.id === 'string' ? request.body.id.trim() : '';
      const action = request.body?.action;
      const participant = await profileById({ ...service, serviceKey: service.key }, id);
      if (!participant || !participant.permissions?.includes('clara_program')) return response.status(404).json({ error: 'Teilnehmer-Zugang wurde nicht gefunden.' });
      if (action === 'update-login') {
        const loginName = typeof request.body?.loginName === 'string' ? request.body.loginName.trim().slice(0, 100) : '';
        if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(loginName)) return response.status(400).json({ error: 'Der Login darf nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich enthalten.' });
        const changed = await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ portal_username: loginName }) });
        const rows = await changed.json().catch(() => ({}));
        if (!changed.ok) return response.status(changed.status === 409 ? 409 : changed.status).json({ error: changed.status === 409 ? 'Dieser Teilnehmer-Login ist bereits vergeben.' : rows.message || 'Login konnte nicht gespeichert werden.' });
        return response.status(200).json({ participant: rows[0] });
      }
      if (action === 'issue-one-time-password') {
        const oneTimePassword = randomTemporaryPassword();
        const authResult = await fetch(`${service.url}/auth/v1/admin/users/${encodeURIComponent(participant.auth_user_id)}`, { method: 'PUT', headers: authHeaders(service.key), body: JSON.stringify({ password: oneTimePassword, email_confirm: true }) });
        const authBody = await authResult.json().catch(() => ({}));
        if (!authResult.ok) return response.status(authResult.status).json({ error: authBody.message || 'Einmalpasswort konnte nicht erzeugt werden.' });
        const issuedAt = new Date().toISOString();
        await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ must_change_password: true, one_time_password_issued_at: issuedAt }) });
        return response.status(200).json({ oneTimePassword, issuedAt, visibleOnce: true });
      }
      if (action === 'send-login-mail') {
        await sendPasswordReset({ ...service, serviceKey: service.key, anonKey: process.env.SUPABASE_ANON_KEY }, participant.email);
        const sentAt = new Date().toISOString();
        await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: headers(service.key), body: JSON.stringify({ access_invite_sent_at: sentAt }) });
        return response.status(200).json({ sentAt, provider: 'supabase_auth', message: 'Ein sicherer Einmal-Link wurde per E-Mail versendet.' });
      }
      return response.status(400).json({ error: 'Unbekannte Login-Aktion.' });
    } catch (error) {
      return response.status(error.status || 500).json({ error: error.message || 'Teilnehmer-Zugang konnte nicht bearbeitet werden.' });
    }
  }
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
