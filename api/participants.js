import { authHeaders, profileById, randomTemporaryPassword, requireCurrentAdmin, sendPasswordReset } from '../lib/user-auth.js';
import { handleCustomerRecords } from '../lib/customer-records-service.js';

function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
function headers(key, extra = {}) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }; }

export function summarizeCustomerProgress(gates = [], fallbackWeek = 0) {
  const required = gates.filter((gate) => gate.required !== false);
  if (!required.length) {
    const week = Math.max(0, Math.min(8, Number(fallbackWeek) || 0));
    return { completed_weeks: [], process_week: week, completion_percent: Math.round(week / 8 * 100) };
  }
  const gatesByWeek = new Map();
  required.forEach((gate) => {
    const week = Number(gate.week);
    const rows = gatesByWeek.get(week) || [];
    rows.push(gate);
    gatesByWeek.set(week, rows);
  });
  const completed = Array.from({ length: 8 }, (_, index) => index + 1).filter((week) => {
    const rows = gatesByWeek.get(week) || [];
    return rows.length > 0 && rows.every((gate) => Boolean(gate.completed_at));
  });
  const onboarding = gatesByWeek.get(0) || [];
  const onboardingComplete = onboarding.length > 0 && onboarding.every((gate) => Boolean(gate.completed_at));
  const processWeek = onboardingComplete
    ? (completed.length === 8 ? 8 : Array.from({ length: 8 }, (_, index) => index + 1).find((week) => !completed.includes(week)))
    : 0;
  return { completed_weeks: completed, process_week: processWeek, completion_percent: Math.round(completed.length / 8 * 100) };
}

export default async function handler(request, response) {
  if (['overview', 'document-download', 'document-upload', 'avatar-upload', 'whatsapp-send'].includes(request.query?.action || request.body?.action)) return handleCustomerRecords(request, response);
  const requiredPermission = request.method === 'GET' ? ['customers', 'program', 'sales_calls'] : ['customers', 'program'];
  const admin = await requireCurrentAdmin(request, response, requiredPermission);
  if (!admin) return;
  const service = config();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'GET') {
    const [result, linksResult, gatesResult] = await Promise.all([
      fetch(`${service.url}/rest/v1/user_profiles?role=eq.user&select=*,participant_progress!inner(*)&order=created_at.desc`, { headers: headers(service.key) }),
      fetch(`${service.url}/rest/v1/leads?converted_user_profile_id=not.is.null&status=eq.customer&select=id,converted_user_profile_id,converted_at,created_at`, { headers: headers(service.key) }),
      fetch(`${service.url}/rest/v1/week_gates?required=eq.true&select=user_profile_id,week,required,completed_at&limit=5000`, { headers: headers(service.key) }),
    ]);
    const participants = await result.json(), links = await linksResult.json(), gates = await gatesResult.json();
    if (!result.ok) return response.status(result.status).json({ error: participants.message });
    if (!linksResult.ok) return response.status(linksResult.status).json({ error: links.message });
    if (!gatesResult.ok) return response.status(gatesResult.status).json({ error: gates.message });
    const leadByCustomer = new Map(links.map((lead) => [lead.converted_user_profile_id, lead]));
    const gatesByCustomer = new Map();
    gates.forEach((gate) => {
      const rows = gatesByCustomer.get(gate.user_profile_id) || [];
      rows.push(gate);
      gatesByCustomer.set(gate.user_profile_id, rows);
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
        linked_lead_id: lead.id,
        customer_since: lead.converted_at || lead.created_at || participant.created_at,
        ...summarizeCustomerProgress(gatesByCustomer.get(participant.id) || [], progress.current_week),
      };
    });
    return response.status(200).json({ participants: customers });
  }
  if (request.method === 'POST') {
    return response.status(409).json({ error: 'Teilnehmer werden ausschließlich nach einem vollständig bestätigten Lead-Vertragsabschluss automatisch angelegt.' });
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
