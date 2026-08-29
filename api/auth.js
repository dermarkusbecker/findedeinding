import { clearSessionCookie, createSession, sessionCookie, sessionFromRequest } from '../lib/auth.js';
import { authHeaders, authenticateUser, sendPasswordReset, supabaseAuthConfig } from '../lib/user-auth.js';

async function login(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  try {
    const profile = await authenticateUser(request.body?.email, request.body?.password);
    const token = createSession(profile.email, profile.role, { userId: profile.auth_user_id, profileId: profile.id, participantId: profile.id, name: profile.name, email: profile.email, permissions: profile.permissions || [] });
    response.setHeader('Set-Cookie', sessionCookie(token));
    return response.status(200).json({ ok: true, destination: profile.role === 'admin' ? '/admin' : '/portal', user: { name: profile.name, email: profile.email, role: profile.role, permissions: profile.permissions || [] } });
  } catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Anmeldung fehlgeschlagen.' }); }
}

async function reset(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Der Login ist noch nicht vollständig konfiguriert.' });
  try {
    await sendPasswordReset(config, request.body?.email);
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
  return response.status(200).json({ ok: true });
}

function session(request, response) {
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearSessionCookie());
    return response.status(200).json({ ok: true });
  }
  const current = sessionFromRequest(request);
  return current ? response.status(200).json({ authenticated: true, user: current }) : response.status(401).json({ authenticated: false });
}

export default async function handler(request, response) {
  const action = request.query?.action;
  if (action === 'login') return login(request, response);
  if (action === 'password-reset') return reset(request, response);
  if (action === 'update-password') return updatePassword(request, response);
  if (action === 'session') return session(request, response);
  return response.status(404).json({ error: 'Auth-Aktion nicht gefunden.' });
}
