import { authHeaders, profileById, randomTemporaryPassword, requireCurrentAdmin, sendPasswordReset } from '../lib/user-auth.js';

function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
function headers(key, extra = {}) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }; }
export default async function handler(request, response) {
  if (!await requireCurrentAdmin(request, response)) return;
  const service = config();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'GET') {
    const result = await fetch(`${service.url}/rest/v1/user_profiles?role=eq.user&select=*,participant_progress!inner(*)&order=created_at.desc`, { headers: headers(service.key) });
    const participants = await result.json();
    return response.status(result.status).json(result.ok ? { participants } : { error: participants.message });
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
