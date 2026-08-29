import { authHeaders, supabaseAuthConfig } from '../../lib/user-auth.js';

export default async function handler(request, response) {
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
