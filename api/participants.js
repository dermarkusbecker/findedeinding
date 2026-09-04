import { requireCurrentAdmin } from '../lib/user-auth.js';

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
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
