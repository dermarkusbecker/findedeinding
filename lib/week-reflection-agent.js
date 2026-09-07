import OpenAI from 'openai';
import { claraConfig } from './clara/config.js';

export const WEEK_REFLECTION_VERSION = '2026-09-07.1';

const reflectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'highlights', 'development', 'nextImpulse', 'closing'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    development: { type: 'string' },
    nextImpulse: { type: 'string' },
    closing: { type: 'string' },
  },
};

function usefulStrings(value, output = []) {
  if (typeof value === 'string' && value.trim() && value.length > 2) output.push(value.trim().slice(0, 500));
  else if (Array.isArray(value)) value.forEach((item) => usefulStrings(item, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    if (!['id', 'status', 'version', 'created_at', 'updated_at', 'completed_at', 'conversation_context'].includes(key)) usefulStrings(item, output);
  });
  return [...new Set(output)].slice(0, 12);
}

function reflectionInputData(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === 'string') return value.trim().slice(0, 3000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => reflectionInputData(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'version', 'responseId', 'conversation_context', 'clara_suggestion', 'created_at', 'updated_at'].includes(key))
    .map(([key, item]) => [key, reflectionInputData(item, depth + 1)]));
}

export function fallbackWeekReflection({ week, title, state }) {
  const statements = usefulStrings(state);
  const highlights = statements.slice(0, 3);
  return {
    title: `Deine Reflexion zu Woche ${week}`,
    summary: highlights.length
      ? `In „${title}“ hast du wichtige persönliche Gedanken festgehalten. Besonders sichtbar werden: ${highlights.join(' · ')}.`
      : `Du hast die Schritte aus „${title}“ vollständig bearbeitet und diese Woche bewusst abgeschlossen.`,
    highlights: highlights.length ? highlights : ['Du hast alle Pflichtschritte dieser Woche abgeschlossen.'],
    development: 'Diese Reflexion hält deinen aktuellen Stand fest. Sie ist eine Momentaufnahme und darf sich in den nächsten Wochen weiterentwickeln.',
    nextImpulse: 'Nimm die stärkste Erkenntnis dieser Woche mit und beobachte, wo sie dir im Alltag erneut begegnet.',
    closing: 'Deine Antworten geben die Richtung vor – Clara ordnet sie, ohne dir eine Entscheidung abzunehmen.',
    generatedAt: new Date().toISOString(),
    generator: 'grounded_fallback',
    model: null,
    responseId: null,
    version: WEEK_REFLECTION_VERSION,
  };
}

export function hasWeekReflection(state = {}) {
  const reflection = state?.week_reflection;
  return Boolean(
    reflection
    && typeof reflection === 'object'
    && typeof reflection.title === 'string'
    && reflection.title.trim()
    && typeof reflection.summary === 'string'
    && reflection.summary.trim()
    && Array.isArray(reflection.highlights)
    && reflection.highlights.length,
  );
}

export async function ensureWeekReflection({ participantId, participantName, week, title, state, persist, generate = generateWeekReflection }) {
  if (hasWeekReflection(state)) return { created: false, reflection: state.week_reflection, state };
  const reflection = await generate({ participantId, participantName, week, title, state });
  const updatedState = {
    ...state,
    week_reflection: reflection,
    ...(Number(week) === 1 ? { week_summary: reflection.summary } : {}),
  };
  await persist(updatedState);
  return { created: true, reflection, state: updatedState };
}

export async function generateWeekReflection({ participantId, participantName, week, title, state, client = null, env = process.env }) {
  const config = claraConfig(env);
  if (!config.apiKey && !client) return fallbackWeekReflection({ week, title, state });
  const openai = client || new OpenAI({ apiKey: config.apiKey });
  try {
    const result = await openai.responses.create({
      model: env.WEEK_REFLECTION_MODEL || config.model,
      store: false,
      reasoning: { effort: env.WEEK_REFLECTION_REASONING_EFFORT || 'low' },
      max_output_tokens: Number(env.WEEK_REFLECTION_MAX_OUTPUT_TOKENS || 1400),
      instructions: [
        'Du bist der FDD-Wochenreflexionsagent. Erstelle eine warme, klare Reflexion auf Deutsch in direkter Du-Ansprache.',
        'Nutze ausschließlich Aussagen aus den übergebenen Wochendaten. Erfinde keine Motive, Diagnosen, Fähigkeiten, Berufe oder Fortschritte.',
        'Unterscheide Beobachtung und Entwicklung. Formuliere den nächsten Impuls offen, klein und nicht-direktiv.',
        'Keine Therapie-, Medizin-, Rechts- oder Karriereentscheidung. Keine Erwähnung interner Datenstrukturen.',
      ].join('\n'),
      input: JSON.stringify({ participantName, week, weekTitle: title, finalizedWeekData: reflectionInputData(state) }),
      text: { format: { type: 'json_schema', name: 'week_reflection', strict: true, schema: reflectionSchema } },
      metadata: { prompt_version: WEEK_REFLECTION_VERSION, week: String(week) },
      safety_identifier: `participant_${participantId}`,
      prompt_cache_key: `week-reflection:${WEEK_REFLECTION_VERSION}:week:${week}`,
    });
    const parsed = JSON.parse(result.output_text || '');
    if (!parsed.title || !parsed.summary || !Array.isArray(parsed.highlights) || !parsed.highlights.length) throw new Error('Unvollständige Reflexion');
    return { ...parsed, generatedAt: new Date().toISOString(), generator: 'openai', model: result.model || config.model, responseId: result.id || null, version: WEEK_REFLECTION_VERSION };
  } catch {
    return fallbackWeekReflection({ week, title, state });
  }
}
