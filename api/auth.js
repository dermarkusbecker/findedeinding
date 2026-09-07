import { clearSessionCookie, createSession, sessionCookie, sessionFromRequest } from '../lib/auth.js';
import { authHeaders, authenticateUser, emailForLogin, profileByAuthId, profileById, requireCurrentAdmin, sendPasswordReset, supabaseAuthConfig } from '../lib/user-auth.js';

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

async function login(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  try {
    const profile = await authenticateUser(request.body?.identifier || request.body?.email, request.body?.password);
    const mustChangePassword = profile.role === 'user' && profile.must_change_password === true;
    const token = createSession(profile.email, profile.role, { userId: profile.auth_user_id, profileId: profile.id, participantId: profile.id, name: profile.name, email: profile.email, permissions: profile.permissions || [], staffRole: profile.staff_role || null, staffPermissions: profile.staff_permissions || [], mustChangePassword });
    response.setHeader('Set-Cookie', sessionCookie(token));
    return response.status(200).json({ ok: true, destination: mustChangePassword ? '/login?change=required' : profile.role === 'admin' ? '/admin' : '/portal', mustChangePassword, user: { name: profile.name, email: profile.email, loginName: profile.portal_username, role: profile.role, permissions: profile.permissions || [], staffRole: profile.staff_role || null, staffPermissions: profile.staff_permissions || [] } });
  } catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Anmeldung fehlgeschlagen.' }); }
}

async function reset(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Der Login ist noch nicht vollständig konfiguriert.' });
  try {
    const email = await emailForLogin(config, request.body?.identifier || request.body?.email);
    if (email) await sendPasswordReset(config, email);
    return response.status(200).json({ ok: true, message: 'Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.' });
  } catch (error) {
    if (error.status === 400) return response.status(400).json({ error: error.message });
    return response.status(200).json({ ok: true, message: 'Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.' });
  }
}

async function updatePassword(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const accessToken = typeof request.body?.accessToken === 'string' ? request.body.accessToken : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (!accessToken || password.length < 8) return response.status(400).json({ error: 'Das neue Passwort muss mindestens acht Zeichen lang sein.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Der Login ist noch nicht vollständig konfiguriert.' });
  const result = await fetch(`${config.url}/auth/v1/user`, { method: 'PUT', headers: { ...authHeaders(config.anonKey), Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ password }) });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) return response.status(result.status).json({ error: data.message || 'Der Reset-Link ist ungültig oder abgelaufen.' });
  const profile = data.id ? await profileByAuthId(config, data.id).catch(() => null) : null;
  if (profile) await fetch(`${config.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', headers: authHeaders(config.serviceKey), body: JSON.stringify({ must_change_password: false, password_changed_at: new Date().toISOString() }) });
  return response.status(200).json({ ok: true });
}

async function changeInitialPassword(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const current = sessionFromRequest(request);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (!current?.profileId || current.role !== 'user') return response.status(401).json({ error: 'Der Einmalzugang ist nicht mehr gültig.' });
  if (password.length < 8) return response.status(400).json({ error: 'Das neue Passwort muss mindestens acht Zeichen lang sein.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Der Login ist noch nicht vollständig konfiguriert.' });
  const profile = await profileById(config, current.profileId).catch(() => null);
  if (!profile?.auth_user_id || profile.must_change_password !== true) return response.status(409).json({ error: 'Für diesen Zugang ist kein Passwortwechsel offen.' });
  const changed = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(profile.auth_user_id)}`, { method: 'PUT', headers: authHeaders(config.serviceKey), body: JSON.stringify({ password, email_confirm: true }) });
  const changedData = await changed.json().catch(() => ({}));
  if (!changed.ok) return response.status(changed.status).json({ error: changedData.message || 'Das Passwort konnte nicht gespeichert werden.' });
  await fetch(`${config.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', headers: authHeaders(config.serviceKey), body: JSON.stringify({ must_change_password: false, password_changed_at: new Date().toISOString() }) });
  const token = createSession(profile.email, profile.role, { userId: profile.auth_user_id, profileId: profile.id, participantId: profile.id, name: profile.name, email: profile.email, permissions: profile.permissions || [], mustChangePassword: false });
  response.setHeader('Set-Cookie', sessionCookie(token));
  return response.status(200).json({ ok: true, destination: '/portal' });
}

function session(request, response) {
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.status(200).json({ ok: true });
  }
  const current = sessionFromRequest(request);
  return current ? response.status(200).json({ authenticated: true, user: current }) : response.status(401).json({ authenticated: false });
}

async function customerPreview(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const admin = await requireCurrentAdmin(request, response, ['customers', 'program']);
  if (!admin) return;
  const participantId = request.query?.participantId;
  if (!isUuid(participantId)) return response.status(400).json({ error: 'Gültige Kunden-ID fehlt.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  const participant = await profileById(config, participantId).catch(() => null);
  if (!participant || participant.role !== 'user' || participant.status !== 'active' || !participant.permissions?.includes('customer_portal')) return response.status(404).json({ error: 'Aktiver Kundenportal-Zugang wurde nicht gefunden.' });
  const token = createSession(participant.email, 'user', {
    userId: participant.auth_user_id,
    profileId: participant.id,
    participantId: participant.id,
    name: participant.name,
    email: participant.email,
    permissions: participant.permissions || [],
    mustChangePassword: false,
    adminPreview: true,
    adminProfileId: admin.profile.id,
  }, 1000 * 60 * 30);
  return response.redirect(302, `/portal?adminPreview=${encodeURIComponent(token)}`);
}

export default async function handler(request, response) {
  const action = request.query?.action;
  if (action === 'login') return login(request, response);
  if (action === 'password-reset') return reset(request, response);
  if (action === 'update-password') return updatePassword(request, response);
  if (action === 'change-initial-password') return changeInitialPassword(request, response);
  if (action === 'customer-preview') return customerPreview(request, response);
  if (action === 'session') return session(request, response);
  return response.status(404).json({ error: 'Auth-Aktion nicht gefunden.' });
}
