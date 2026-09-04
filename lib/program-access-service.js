import { calculateProgramAccess, serializeProgramAccess } from './program-access.js';

export function supabaseService() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

async function readRows(service, path) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, { headers: serviceHeaders(service.key) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Supabase-Abfrage fehlgeschlagen.');
  return data;
}

export async function getParticipantProgramAccess(participantId, now = new Date()) {
  if (!isUuid(participantId)) throw new Error('Ungültige Teilnehmer-ID.');
  const service = supabaseService();
  if (!service) throw new Error('Supabase ist noch nicht konfiguriert.');
  const encodedId = encodeURIComponent(participantId);
  const [profiles, progressRows, gates] = await Promise.all([
    readRows(service, `user_profiles?id=eq.${encodedId}&role=eq.user&select=id,name,email,birth_date,street,postal_code,city,country,phone,whatsapp_phone,preferred_communication_channel,postal_mail_active,status,permissions&limit=1`),
    readRows(service, `participant_progress?user_profile_id=eq.${encodedId}&select=*&limit=1`),
    readRows(service, `week_gates?user_profile_id=eq.${encodedId}&select=id,week,gate_key,label,required,completed_at&order=week.asc,gate_key.asc`),
  ]);
  if (!profiles[0]) throw new Error('Teilnehmer wurde nicht gefunden.');
  if (!progressRows[0]) throw new Error('Programmsteuerung für diesen Teilnehmer fehlt.');
  const access = calculateProgramAccess({ profileStatus: profiles[0].status, progress: progressRows[0], gates, now });
  return { service, profile: profiles[0], progress: progressRows[0], gates, access, serializedAccess: serializeProgramAccess(access) };
}

export async function patchParticipantProgress(service, participantId, changes) {
  const response = await fetch(`${service.url}/rest/v1/participant_progress?user_profile_id=eq.${encodeURIComponent(participantId)}`, {
    method: 'PATCH',
    headers: serviceHeaders(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  const rows = await response.json();
  if (!response.ok || !rows[0]) throw new Error(rows.message || 'Programmsteuerung konnte nicht gespeichert werden.');
  return rows[0];
}
