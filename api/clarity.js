import { CLARITY_QUESTION_CATALOG, clarityQuestionSeedRows, defaultClarityQuestion, readClarityQuestionOverrides } from '../lib/clarity-questions.js';
import { authHeaders, requireCurrentAdmin } from '../lib/user-auth.js';

function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

const parseJson = async (result, fallback) => {
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data.message || fallback), { status: result.status });
  return data;
};

async function ensureQuestionCatalog(service) {
  const existing = await readClarityQuestionOverrides(service);
  const known = new Set(existing.map((item) => item.question_key));
  const missing = clarityQuestionSeedRows().filter((item) => !known.has(item.question_key));
  if (!missing.length) return existing;
  await parseJson(await fetch(`${service.url}/rest/v1/clarity_questions`, {
    method: 'POST',
    headers: { ...authHeaders(service.key), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(missing),
  }), 'Die Standardfragen konnten nicht angelegt werden.');
  return readClarityQuestionOverrides(service);
}

async function handleQuestionSettings(request, response, service, admin) {
  if (request.method === 'GET') {
    const questions = await ensureQuestionCatalog(service);
    return response.status(200).json({ questions, total: questions.length, weeks: 8 });
  }
  if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
  const questionKey = String(request.body?.questionKey || '').trim();
  const definition = defaultClarityQuestion(questionKey);
  if (!definition) return response.status(400).json({ error: 'Diese Klarheitsfrage ist nicht Teil des freigegebenen Prozesses.' });
  const reset = request.body?.action === 'reset';
  const promptText = reset ? definition.promptText : String(request.body?.promptText || '').trim();
  if (promptText.length < 5 || promptText.length > 2000) return response.status(400).json({ error: 'Die Frage muss zwischen 5 und 2.000 Zeichen lang sein.' });
  await ensureQuestionCatalog(service);
  const rows = await parseJson(await fetch(`${service.url}/rest/v1/clarity_questions?question_key=eq.${encodeURIComponent(questionKey)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(service.key), Prefer: 'return=representation' },
    body: JSON.stringify({ prompt_text: promptText, updated_at: new Date().toISOString(), updated_by: admin.profile.id }),
  }), 'Die Klarheitsfrage konnte nicht gespeichert werden.');
  if (!rows[0]) return response.status(404).json({ error: 'Die Klarheitsfrage wurde nicht gefunden.' });
  return response.status(200).json({ question: rows[0], reset, catalogSize: CLARITY_QUESTION_CATALOG.length });
}

export default async function handler(request, response) {
  const admin = await requireCurrentAdmin(request, response, ['settings', 'program']);
  if (!admin) return;
  const service = config(), participantId = request.query?.participantId;
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.query?.action === 'settings') {
    try { return await handleQuestionSettings(request, response, service, admin); }
    catch (error) { return response.status(error.status || 500).json({ error: error.message || 'Klarheitsfragen konnten nicht verarbeitet werden.' }); }
  }
  if (request.method !== 'GET') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
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
