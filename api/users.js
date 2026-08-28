import { requireAdmin } from '../lib/auth.js';

const clean = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
function headers(key, extra = {}) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }; }

export default async function handler(request, response) {
  if (!requireAdmin(request, response)) return;
  const service = config();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'GET') {
    const result = await fetch(`${service.url}/rest/v1/user_profiles?select=*&order=created_at.desc`, { headers: headers(service.key) });
    const users = await result.json();
    return response.status(result.status).json(result.ok ? { users } : { error: users.message });
  }
  if (request.method === 'POST') {
    const name = clean(request.body?.name, 120), email = clean(request.body?.email, 254).toLowerCase(), role = clean(request.body?.role, 30);
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !['admin', 'coach', 'participant'].includes(role)) return response.status(400).json({ error: 'Name, E-Mail und gültige Rolle sind erforderlich.' });
    const result = await fetch(`${service.url}/rest/v1/user_profiles`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ name, email, role, status: 'invited' }) });
    const users = await result.json();
    return response.status(result.status).json(result.ok ? { user: users[0] } : { error: users.message });
  }
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
