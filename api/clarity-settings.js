import { CLARITY_QUESTION_CATALOG, clarityQuestionSeedRows, defaultClarityQuestion, readClarityQuestionOverrides } from '../lib/clarity-questions.js';
import { authHeaders, requireCurrentAdmin, supabaseAuthConfig } from '../lib/user-auth.js';

const json = async (response, fallback) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || fallback), { status: response.status });
  return data;
};

async function ensureQuestionCatalog(config) {
  const existing = await readClarityQuestionOverrides({ url: config.url, key: config.serviceKey });
  const known = new Set(existing.map((item) => item.question_key));
  const missing = clarityQuestionSeedRows().filter((item) => !known.has(item.question_key));
  if (!missing.length) return existing;
  await json(await fetch(`${config.url}/rest/v1/clarity_questions`, {
    method: 'POST',
    headers: { ...authHeaders(config.serviceKey), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(missing),
  }), 'Die Standardfragen konnten nicht angelegt werden.');
  return readClarityQuestionOverrides({ url: config.url, key: config.serviceKey });
}

export default async function handler(request, response) {
  const admin = await requireCurrentAdmin(request, response);
  if (!admin) return;
  const config = supabaseAuthConfig();
  if (!config) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  try {
    if (request.method === 'GET') {
      const questions = await ensureQuestionCatalog(config);
      return response.status(200).json({ questions, total: questions.length, weeks: 8 });
    }
    if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    const questionKey = String(request.body?.questionKey || '').trim();
    const definition = defaultClarityQuestion(questionKey);
    if (!definition) return response.status(400).json({ error: 'Diese Klarheitsfrage ist nicht Teil des freigegebenen Prozesses.' });
    const reset = request.body?.action === 'reset';
    const promptText = reset ? definition.promptText : String(request.body?.promptText || '').trim();
    if (promptText.length < 5 || promptText.length > 2000) return response.status(400).json({ error: 'Die Frage muss zwischen 5 und 2.000 Zeichen lang sein.' });
    await ensureQuestionCatalog(config);
    const path = `clarity_questions?question_key=eq.${encodeURIComponent(questionKey)}`;
    const rows = await json(await fetch(`${config.url}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: { ...authHeaders(config.serviceKey), Prefer: 'return=representation' },
      body: JSON.stringify({ prompt_text: promptText, updated_at: new Date().toISOString(), updated_by: admin.profile.id }),
    }), 'Die Klarheitsfrage konnte nicht gespeichert werden.');
    if (!rows[0]) return response.status(404).json({ error: 'Die Klarheitsfrage wurde nicht gefunden.' });
    return response.status(200).json({ question: rows[0], reset, catalogSize: CLARITY_QUESTION_CATALOG.length });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Klarheitsfragen konnten nicht verarbeitet werden.' });
  }
}
