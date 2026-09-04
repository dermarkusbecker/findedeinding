import { requireCurrentAdmin } from '../lib/user-auth.js';
import { participantGateRows } from '../lib/gate-templates.js';
import { createManagedAuthUser, supabaseAuthConfig } from '../lib/user-auth.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
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
    const name = clean(request.body?.name, 120), email = clean(request.body?.email, 254).toLowerCase();
    const programStartDate = /^\d{4}-\d{2}-\d{2}$/.test(request.body?.programStartDate || '') ? request.body.programStartDate : new Date().toISOString().slice(0, 10);
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'Name und gültige E-Mail sind erforderlich.' });
    const auth = supabaseAuthConfig();
    if (!auth) return response.status(503).json({ error: 'Supabase Auth ist nicht konfiguriert.' });
    let authUser;
    try { authUser = await createManagedAuthUser(auth, email, name); }
    catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Benutzerkonto konnte nicht angelegt werden.' }); }
    const created = await fetch(`${service.url}/rest/v1/user_profiles`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ auth_user_id: authUser.id, name, email, role: 'user', status: 'active', permissions: ['customer_portal', 'clara_program', 'documents'] }) });
    const profiles = await created.json();
    if (!created.ok) return response.status(created.status).json({ error: profiles.message });
    await Promise.all([
      fetch(`${service.url}/rest/v1/participant_progress`, { method: 'POST', headers: headers(service.key), body: JSON.stringify({ user_profile_id: profiles[0].id, process_status: 'ONBOARDING', current_week: 1, program_start_date: programStartDate, access_mode: 'time_based', program_status: 'active' }) }),
      fetch(`${service.url}/rest/v1/week_gates`, { method: 'POST', headers: headers(service.key), body: JSON.stringify(participantGateRows(profiles[0].id)) }),
    ]);
    return response.status(201).json({ participant: profiles[0] });
  }
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
