import { requireCurrentAdmin } from '../lib/user-auth.js';

function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

export default async function handler(request, response) {
  if (!await requireCurrentAdmin(request, response)) return;
  if (request.method !== 'GET') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const service = config(), participantId = request.query?.participantId;
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (!participantId) return response.status(400).json({ error: 'Teilnehmer-ID fehlt.' });
  const [entriesResponse, progressResponse] = await Promise.all([
    fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${encodeURIComponent(participantId)}&select=*&order=created_at.asc`, { headers: headers(service.key) }),
    fetch(`${service.url}/rest/v1/participant_progress?user_profile_id=eq.${encodeURIComponent(participantId)}&select=*&limit=1`, { headers: headers(service.key) }),
  ]);
  const entries = await entriesResponse.json(), progressRows = await progressResponse.json();
  if (!entriesResponse.ok || !progressResponse.ok) return response.status(500).json({ error: 'Analysegrundlage konnte nicht geladen werden.' });
  const grouped = entries.reduce((result, entry) => { (result[entry.data_block] ||= []).push(entry); return result; }, {});
  const evidence = entries.reduce((result, entry) => { const level = entry.evidence_level || 'unbewertet'; result[level] = (result[level] || 0) + 1; return result; }, {});
  return response.status(200).json({ participantId, progress: progressRows[0] || null, blocks: grouped, evidence, entryCount: entries.length, generatedAt: new Date().toISOString() });
}
