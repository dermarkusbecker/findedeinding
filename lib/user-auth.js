import crypto from 'node:crypto';
import { sessionFromRequest, USER_PERMISSIONS } from './auth.js';
import { participantGateRows } from './gate-templates.js';

const cleanEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '';
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value);

export function supabaseAuthConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
}

export function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function json(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.msg || data.message || data.error_description || 'Authentifizierung fehlgeschlagen.'), { status: response.status });
  return data;
}

export async function profileByAuthId(config, authUserId) {
  const response = await fetch(`${config.url}/rest/v1/user_profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=id,auth_user_id,name,email,role,status,permissions,portal_username,customer_number,must_change_password,one_time_password_issued_at,access_invite_sent_at,password_changed_at&limit=1`, { headers: authHeaders(config.serviceKey) });
  const rows = await json(response);
  return rows[0] || null;
}

export async function profileById(config, profileId) {
  const response = await fetch(`${config.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(profileId)}&select=id,auth_user_id,name,email,role,status,permissions,portal_username,customer_number,must_change_password,one_time_password_issued_at,access_invite_sent_at,password_changed_at&limit=1`, { headers: authHeaders(config.serviceKey) });
  const rows = await json(response);
  return rows[0] || null;
}

async function currentProfile(request, response) {
  const session = sessionFromRequest(request);
  if (!session?.profileId) { response.status(401).json({ error: 'Nicht angemeldet.' }); return null; }
  const config = supabaseAuthConfig();
  if (!config) { response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' }); return null; }
  try {
    const profile = await profileById(config, session.profileId);
    if (!profile || profile.status !== 'active') { response.status(401).json({ error: 'Benutzerkonto ist nicht aktiv.' }); return null; }
    if (profile.role !== 'admin' && profile.must_change_password === true) { response.status(428).json({ error: 'Bitte ersetze zuerst dein Einmalpasswort.' }); return null; }
    return { ...session, role: profile.role, permissions: profile.role === 'admin' ? USER_PERMISSIONS : (profile.permissions || []), profile };
  } catch (error) { response.status(error.status || 500).json({ error: error.message }); return null; }
}

export async function requireCurrentAdmin(request, response) {
  const session = sessionFromRequest(request);
  if (!session) { response.status(401).json({ error: 'Nicht angemeldet.' }); return null; }
  if (session.role !== 'admin') { response.status(403).json({ error: 'Nur für Administratoren.' }); return null; }
  const current = await currentProfile(request, response);
  if (!current) return null;
  if (current.role !== 'admin') { response.status(403).json({ error: 'Nur für Administratoren.' }); return null; }
  return current;
}

export function requireCurrentPermission(permission) {
  if (!USER_PERMISSIONS.includes(permission)) throw new Error(`Unbekannte Berechtigung: ${permission}`);
  return async (request, response) => {
    const session = sessionFromRequest(request);
    if (!session) { response.status(401).json({ error: 'Nicht angemeldet.' }); return null; }
    if (session.role !== 'admin' && !session.permissions?.includes(permission)) { response.status(403).json({ error: 'Für diesen Bereich fehlt die Freischaltung.' }); return null; }
    const current = await currentProfile(request, response);
    if (!current) return null;
    if (current.role === 'admin' || current.permissions.includes(permission)) return current;
    response.status(403).json({ error: 'Für diesen Bereich fehlt die Freischaltung.' });
    return null;
  };
}

function knownBootstrap(email, password) {
  const adminIdentity = cleanEmail(process.env.ADMIN_EMAIL || (process.env.ADMIN_USERNAME?.includes('@') ? process.env.ADMIN_USERNAME : 'markus@dermarkusbecker.de'));
  if (email === adminIdentity && password === process.env.ADMIN_PASSWORD) return { name: 'Markus Becker', role: 'admin', permissions: USER_PERMISSIONS };
  return null;
}

async function createAuthUser(config, email, password, metadata) {
  return json(await fetch(`${config.url}/auth/v1/admin/users`, { method: 'POST', headers: authHeaders(config.serviceKey), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: metadata.name } }) }));
}

async function createProfile(config, authUserId, email, metadata) {
  const existingResponse = await fetch(`${config.url}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: authHeaders(config.serviceKey) });
  const existing = await json(existingResponse);
  const path = existing[0] ? `user_profiles?id=eq.${encodeURIComponent(existing[0].id)}` : 'user_profiles';
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: existing[0] ? 'PATCH' : 'POST', headers: { ...authHeaders(config.serviceKey), Prefer: 'return=representation' },
    body: JSON.stringify({ auth_user_id: authUserId, name: metadata.name, email, role: metadata.role, status: 'active', permissions: metadata.permissions }),
  });
  const rows = await json(response);
  return rows[0];
}

async function bootstrapKnownAccount(config, email, password) {
  const metadata = knownBootstrap(email, password);
  if (!metadata) return null;
  const created = await createAuthUser(config, email, password, metadata);
  return createProfile(config, created.id, email, metadata);
}

export async function emailForLogin(config, identifierInput) {
  const identifier = typeof identifierInput === 'string' ? identifierInput.trim().slice(0, 254) : '';
  if (validEmail(cleanEmail(identifier))) return cleanEmail(identifier);
  if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(identifier)) return '';
  const rows = await json(await fetch(`${config.url}/rest/v1/user_profiles?portal_username=eq.${encodeURIComponent(identifier)}&select=email&limit=1`, { headers: authHeaders(config.serviceKey) }));
  return cleanEmail(rows[0]?.email);
}

export async function authenticateUser(identifierInput, password) {
  if (typeof password !== 'string' || !password) throw Object.assign(new Error('Login oder Passwort ist falsch.'), { status: 401 });
  const config = supabaseAuthConfig();
  if (!config) throw Object.assign(new Error('Der Login ist noch nicht vollständig konfiguriert.'), { status: 503 });
  const email = await emailForLogin(config, identifierInput);
  if (!validEmail(email)) throw Object.assign(new Error('Login oder Passwort ist falsch.'), { status: 401 });
  let authData;
  try {
    authData = await json(await fetch(`${config.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders(config.anonKey), body: JSON.stringify({ email, password }) }));
  } catch (error) {
    const bootstrapped = await bootstrapKnownAccount(config, email, password).catch((bootstrapError) => {
      if (/already|registered|exists/i.test(bootstrapError.message)) return null;
      throw bootstrapError;
    });
    if (!bootstrapped) throw Object.assign(new Error('Login oder Passwort ist falsch.'), { status: 401 });
    authData = await json(await fetch(`${config.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: authHeaders(config.anonKey), body: JSON.stringify({ email, password }) }));
  }
  const profile = await profileByAuthId(config, authData.user.id);
  if (!profile) throw Object.assign(new Error('Für dieses Benutzerkonto fehlt ein Profil.'), { status: 403 });
  if (profile.status !== 'active') throw Object.assign(new Error(profile.status === 'inactive' ? 'Dieses Benutzerkonto ist deaktiviert.' : 'Dieser Zugang ist aktuell nicht aktiv.'), { status: 403 });
  if (!['admin', 'user'].includes(profile.role)) throw Object.assign(new Error('Das Benutzerkonto besitzt keine gültige Rolle.'), { status: 403 });
  return profile;
}

export function randomTemporaryPassword() {
  return `${crypto.randomBytes(24).toString('base64url')}Aa1!`;
}

export async function createManagedAuthUser(config, email, name, initialPassword = '') {
  const password = typeof initialPassword === 'string' ? initialPassword : '';
  if (password && password.length < 8) throw Object.assign(new Error('Das Startpasswort muss mindestens acht Zeichen lang sein.'), { status: 400 });
  const user = await createAuthUser(config, email, password || randomTemporaryPassword(), { name });
  if (!password) await sendPasswordReset(config, email);
  return user;
}

export async function provisionProgramUser(config, { name, email: emailInput, startDate, permissions = ['customer_portal', 'clara_program', 'documents'] }) {
  const email = cleanEmail(emailInput);
  if (!name || !validEmail(email)) throw Object.assign(new Error('Name und gültige E-Mail sind erforderlich.'), { status: 400 });
  const lookup = await json(await fetch(`${config.url}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=id,auth_user_id,name,email,role,status,permissions&limit=1`, { headers: authHeaders(config.serviceKey) }));
  let profile = lookup[0] || null;
  let authUserId = profile?.auth_user_id;
  const oneTimePassword = randomTemporaryPassword();
  if (!authUserId) {
    const authUser = await createManagedAuthUser(config, email, name, oneTimePassword);
    authUserId = authUser.id;
  } else await json(await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { method: 'PUT', headers: authHeaders(config.serviceKey), body: JSON.stringify({ password: oneTimePassword, email_confirm: true }) }));
  const profilePayload = { auth_user_id: authUserId, name, email, role: 'user', status: 'active', permissions: USER_PERMISSIONS.filter((permission) => permissions.includes(permission)), must_change_password: true, one_time_password_issued_at: new Date().toISOString() };
  const profileResponse = await fetch(`${config.url}/rest/v1/${profile ? `user_profiles?id=eq.${encodeURIComponent(profile.id)}` : 'user_profiles'}`, { method: profile ? 'PATCH' : 'POST', headers: { ...authHeaders(config.serviceKey), Prefer: 'return=representation' }, body: JSON.stringify(profilePayload) });
  profile = (await json(profileResponse))[0];
  const progress = await json(await fetch(`${config.url}/rest/v1/participant_progress?user_profile_id=eq.${encodeURIComponent(profile.id)}&select=id&limit=1`, { headers: authHeaders(config.serviceKey) }));
  if (!progress[0] && profile.permissions.includes('clara_program')) {
    const programStartDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate || '') ? startDate : new Date().toISOString().slice(0, 10);
    await Promise.all([
      json(await fetch(`${config.url}/rest/v1/participant_progress`, { method: 'POST', headers: authHeaders(config.serviceKey), body: JSON.stringify({ user_profile_id: profile.id, process_status: 'ONBOARDING', current_week: 1, program_start_date: programStartDate, access_mode: 'time_based', program_status: 'active' }) })),
      json(await fetch(`${config.url}/rest/v1/week_gates`, { method: 'POST', headers: authHeaders(config.serviceKey), body: JSON.stringify(participantGateRows(profile.id)) })),
    ]);
  }
  await sendPasswordReset(config, email);
  const invitationSentAt = new Date().toISOString();
  const delivery = await json(await fetch(`${config.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(profile.id)}`, { method: 'PATCH', headers: { ...authHeaders(config.serviceKey), Prefer: 'return=representation' }, body: JSON.stringify({ access_invite_sent_at: invitationSentAt }) }));
  return { ...(delivery[0] || profile), oneTimePassword };
}

export async function sendPasswordReset(config, emailInput) {
  const email = cleanEmail(emailInput);
  if (!validEmail(email)) throw Object.assign(new Error('Bitte eine gültige E-Mail-Adresse eingeben.'), { status: 400 });
  await json(await fetch(`${config.url}/auth/v1/recover`, { method: 'POST', headers: authHeaders(config.anonKey), body: JSON.stringify({ email }) }));
}
