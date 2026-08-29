import { USER_PERMISSIONS } from '../lib/auth.js';
import { authHeaders, createManagedAuthUser, profileById, requireCurrentAdmin, sendPasswordReset, supabaseAuthConfig } from '../lib/user-auth.js';

const clean = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailValid = (email) => /^\S+@\S+\.\S+$/.test(email);
const permissionsFrom = (value) => [...new Set((Array.isArray(value) ? value : []).filter((permission) => USER_PERMISSIONS.includes(permission)))];

async function data(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.msg || 'Supabase-Anfrage fehlgeschlagen.'), { status: response.status });
  return body;
}

export default async function handler(request, response) {
  const admin = await requireCurrentAdmin(request, response);
  if (!admin) return;
  const service = supabaseAuthConfig();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  try {
    if (request.method === 'GET') {
      const users = await data(await fetch(`${service.url}/rest/v1/user_profiles?select=id,auth_user_id,name,email,role,status,permissions,created_at,participant_progress(current_week,process_status,program_status,access_mode)&order=created_at.desc`, { headers: authHeaders(service.serviceKey) }));
      return response.status(200).json({ users, permissions: USER_PERMISSIONS });
    }
    if (request.method === 'POST') {
      const name = clean(request.body?.name, 120), email = clean(request.body?.email, 254).toLowerCase(), role = clean(request.body?.role, 20) || 'user';
      const permissions = permissionsFrom(request.body?.permissions);
      if (!name || !emailValid(email) || !['admin', 'user'].includes(role)) return response.status(400).json({ error: 'Name, gültige E-Mail und Rolle sind erforderlich.' });
      const authUser = await createManagedAuthUser(service, email, name);
      const profiles = await data(await fetch(`${service.url}/rest/v1/user_profiles`, { method: 'POST', headers: { ...authHeaders(service.serviceKey), Prefer: 'return=representation' }, body: JSON.stringify({ auth_user_id: authUser.id, name, email, role, status: 'active', permissions }) }));
      return response.status(201).json({ user: profiles[0], passwordResetSent: true });
    }
    if (request.method === 'PATCH') {
      const id = clean(request.body?.id, 80);
      const existing = await profileById(service, id);
      if (!existing) return response.status(404).json({ error: 'Benutzer wurde nicht gefunden.' });
      if (request.body?.action === 'password_reset') {
        await sendPasswordReset(service, existing.email);
        return response.status(200).json({ ok: true, message: 'Passwort-Reset wurde ausgelöst.' });
      }
      const changes = {};
      if (request.body?.role !== undefined) {
        if (!['admin', 'user'].includes(request.body.role)) return response.status(400).json({ error: 'Ungültige Rolle.' });
        if (existing.id === admin.profileId && request.body.role !== 'admin') return response.status(409).json({ error: 'Du kannst deinem eigenen Konto nicht die Adminrolle entziehen.' });
        changes.role = request.body.role;
      }
      if (request.body?.status !== undefined) {
        if (!['active', 'inactive'].includes(request.body.status)) return response.status(400).json({ error: 'Ungültiger Kontostatus.' });
        if (existing.id === admin.profileId && request.body.status === 'inactive') return response.status(409).json({ error: 'Du kannst dein eigenes Konto nicht deaktivieren.' });
        changes.status = request.body.status;
      }
      if (request.body?.permissions !== undefined) changes.permissions = permissionsFrom(request.body.permissions);
      if (!Object.keys(changes).length) return response.status(400).json({ error: 'Keine Änderung übermittelt.' });
      const users = await data(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...authHeaders(service.serviceKey), Prefer: 'return=representation' }, body: JSON.stringify(changes) }));
      return response.status(200).json({ user: users[0] });
    }
    return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Benutzerverwaltung fehlgeschlagen.' });
  }
}
