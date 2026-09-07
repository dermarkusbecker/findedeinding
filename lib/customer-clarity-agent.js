import crypto from 'node:crypto';
import OpenAI from 'openai';
import { claraConfig } from './clara/config.js';

export const CUSTOMER_CLARITY_VERSION = '2026-09-07.1';

const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'finding', 'evidence', 'weekRefs'],
  properties: {
    title: { type: 'string' },
    finding: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    weekRefs: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 8 },
  },
};

const guidanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'reason'],
  properties: { prompt: { type: 'string' }, reason: { type: 'string' } },
};

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'executiveSummary', 'currentFocus', 'clarityTrajectory', 'themes', 'tensions', 'openQuestions', 'conversationGuidance', 'boundaries'],
  properties: {
    headline: { type: 'string' },
    executiveSummary: { type: 'string' },
    currentFocus: { type: 'string' },
    clarityTrajectory: {
      type: 'object', additionalProperties: false,
      required: ['start', 'current', 'change', 'interpretation'],
      properties: {
        start: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        current: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        change: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        interpretation: { type: 'string' },
      },
    },
    themes: { type: 'array', items: itemSchema, maxItems: 6 },
    tensions: { type: 'array', items: itemSchema, maxItems: 5 },
    openQuestions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    conversationGuidance: {
      type: 'object', additionalProperties: false, required: ['meet', 'phone', 'whatsapp'],
      properties: {
        meet: { type: 'array', items: guidanceSchema, minItems: 1, maxItems: 5 },
        phone: { type: 'array', items: guidanceSchema, minItems: 1, maxItems: 4 },
        whatsapp: { type: 'array', items: guidanceSchema, minItems: 1, maxItems: 4 },
      },
    },
    boundaries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
  },
};

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
const cleanText = (value, max = 900) => String(value || '').trim().slice(0, max);

function sourceWeeks(processWeeks = []) {
  return processWeeks.filter((week) => week?.accessible && (week.answers?.length || week.reflection)).map((week) => ({
    week: Number(week.week),
    title: cleanText(week.title, 120),
    completed: Boolean(week.completed),
    answers: (week.answers || []).slice(0, 30).map((answer) => ({ label: cleanText(answer.label, 180), value: cleanText(answer.value, 1400), status: answer.status })),
    reflection: week.reflection ? {
      summary: cleanText(week.reflection.summary, 1600),
      highlights: (week.reflection.highlights || []).slice(0, 5).map((value) => cleanText(value, 700)),
      development: cleanText(week.reflection.development, 900),
      nextImpulse: cleanText(week.reflection.nextImpulse, 700),
    } : null,
  }));
}

function clarityScores(weeks) {
  return weeks.flatMap((week) => week.answers.filter((answer) => /klarheit/i.test(answer.label)).map((answer) => ({ week: week.week, score: Number(answer.value.match(/\b(10|[1-9])\b/)?.[1]) })).filter((entry) => Number.isInteger(entry.score)));
}

export function fallbackCustomerClarityAnalysis({ participantName = 'Der Kunde', processWeeks = [] }) {
  const weeks = sourceWeeks(processWeeks);
  const scores = clarityScores(weeks);
  const first = scores[0]?.score ?? null, current = scores.at(-1)?.score ?? first;
  const evidence = weeks.flatMap((week) => week.answers.slice(0, 2).map((answer) => ({ week: week.week, title: week.title, label: answer.label, value: answer.value })));
  const themes = weeks.slice(-4).map((week) => {
    const items = week.answers.slice(0, 3);
    return { title: `Woche ${week.week} · ${week.title}`, finding: items.length ? items.map((item) => `${item.label}: ${item.value}`).join(' · ') : week.reflection?.summary || 'Die Woche wurde abgeschlossen.', evidence: items.map((item) => item.value).filter(Boolean).slice(0, 3).length ? items.map((item) => item.value).filter(Boolean).slice(0, 3) : [week.reflection?.summary || 'Abschluss der Prozesswoche'], weekRefs: [week.week] };
  });
  const latest = evidence.at(-1);
  const anchor = latest ? `${latest.label}: ${latest.value}` : 'Es liegen noch keine belastbaren Kundenaussagen aus dem Wochenprozess vor.';
  return {
    headline: weeks.length ? `Arbeitsstand aus ${weeks.length} bearbeiteten ${weeks.length === 1 ? 'Prozesswoche' : 'Prozesswochen'}` : 'Analyse startet mit den ersten Kundeneingaben',
    executiveSummary: weeks.length ? `Die aktuelle Gesprächsgrundlage für ${participantName} fasst ausschließlich die bisher freigegebenen Eingaben und Wochenreflexionen zusammen. Der jüngste belegte Anknüpfungspunkt lautet: ${anchor}` : 'Sobald der Kunde im Acht-Wochen-Prozess antwortet, werden die Aussagen hier systematisch als Gesprächsgrundlage zusammengeführt.',
    currentFocus: latest ? `Aktuell anschlussfähig: ${anchor}` : 'Zuerst die aktuelle Ausgangslage und das gewünschte Ergebnis offen erkunden.',
    clarityTrajectory: { start: first, current, change: first !== null && current !== null ? current - first : null, interpretation: scores.length > 1 ? `Die Selbsteinschätzung hat sich von ${first} auf ${current} entwickelt. Die Begründungen des Kunden bleiben für die Einordnung maßgeblich.` : scores.length === 1 ? `Bisher liegt eine Klarheitseinschätzung von ${first} von 10 vor.` : 'Noch keine Klarheitsmessung vorhanden.' },
    themes,
    tensions: [],
    openQuestions: latest ? [`Was ist für dich an „${latest.label}“ im Moment besonders wichtig?`, 'Woran würdest du im Alltag merken, dass du hier einen konkreten Schritt weiter bist?'] : ['Was soll nach dem heutigen Gespräch klarer sein als davor?'],
    conversationGuidance: {
      meet: [{ prompt: latest ? `Lass uns bei deiner Aussage „${latest.value}“ einsteigen: Was davon ist heute noch genauso stimmig?` : 'Was beschäftigt dich im Moment am stärksten, wenn du an dein Ding denkst?', reason: 'Öffnet das Gespräch an einer belegten Kundenaussage.' }],
      phone: [{ prompt: latest ? `Ich würde gern kurz an deinen Gedanken zu „${latest.label}“ anknüpfen. Was hat sich seit deiner Eingabe verändert?` : 'Was ist seit unserem letzten Kontakt klarer oder unklarer geworden?', reason: 'Ermöglicht einen kompakten Statusabgleich ohne Vorannahme.' }],
      whatsapp: [{ prompt: latest ? `Kurzer Impuls zu deiner Eingabe „${latest.label}“: Was davon möchtest du in unserem nächsten Gespräch unbedingt vertiefen?` : 'Was möchtest du beim nächsten Gespräch unbedingt klarer bekommen?', reason: 'Eine kurze, offene Nachricht, auf die der Kunde freiwillig antworten kann.' }],
    },
    boundaries: ['Arbeitsstand, keine Diagnose oder endgültige Wahrheit.', 'Ableitungen beruhen ausschließlich auf freigegebenen Prozessdaten.', 'Gesprächsimpulse sind Vorschläge und werden niemals automatisch versendet.'],
  };
}

async function generate({ participantId, participantName, processWeeks, env = process.env, client = null }) {
  const config = claraConfig(env);
  if (!config.apiKey && !client) return { analysis: fallbackCustomerClarityAnalysis({ participantName, processWeeks }), generator: 'grounded_fallback', model: null };
  const openai = client || new OpenAI({ apiKey: config.apiKey });
  try {
    const result = await openai.responses.create({
      model: env.CUSTOMER_CLARITY_MODEL || config.model,
      store: false,
      reasoning: { effort: env.CUSTOMER_CLARITY_REASONING_EFFORT || 'medium' },
      max_output_tokens: Number(env.CUSTOMER_CLARITY_MAX_OUTPUT_TOKENS || 2600),
      instructions: [
        'Du bist der interne FDD-Klarheitsanalyse-Agent für Mitarbeitende.',
        'Systematisiere ausschließlich die bereitgestellten, zeitlich freigegebenen Kundenaussagen und Wochenreflexionen. Erfinde keine Fakten, Motive, Diagnosen, Berufe oder Fortschritte.',
        'Trenne Beobachtung, vorsichtige Ableitung, Spannungsfeld und offene Frage. Jede Analyseaussage braucht kurze Evidenz und Wochenreferenzen.',
        'Erstelle konkrete, respektvolle Gesprächsansätze für Google Meet, Telefon und WhatsApp. WhatsApp-Texte sind Entwürfe und dürfen keinen Versand behaupten.',
        'Nutze direkte, warme deutsche Sprache im Stil von Finde dein Ding. Keine Therapie-, Medizin-, Rechts- oder endgültige Karriereentscheidung.',
      ].join('\n'),
      input: JSON.stringify({ participantName, releasedProcessWeeks: sourceWeeks(processWeeks) }),
      text: { format: { type: 'json_schema', name: 'customer_clarity_analysis', strict: true, schema: analysisSchema } },
      metadata: { prompt_version: CUSTOMER_CLARITY_VERSION },
      safety_identifier: `participant_${participantId}`,
      prompt_cache_key: `customer-clarity:${CUSTOMER_CLARITY_VERSION}`,
    });
    return { analysis: JSON.parse(result.output_text || ''), generator: 'openai', model: result.model || config.model };
  } catch {
    return { analysis: fallbackCustomerClarityAnalysis({ participantName, processWeeks }), generator: 'grounded_fallback', model: null };
  }
}

export async function ensureCustomerClarityAnalysis({ service, participantId, participantName, processWeeks, env = process.env, client = null }) {
  const source = sourceWeeks(processWeeks);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ version: CUSTOMER_CLARITY_VERSION, source })).digest('hex');
  const key = service.key || service.serviceKey;
  try {
    const response = await fetch(`${service.url}/rest/v1/customer_clarity_analyses?user_profile_id=eq.${encodeURIComponent(participantId)}&select=*&limit=1`, { headers: headers(key) });
    const cached = await response.json().catch(() => ([]));
    if (response.ok && cached[0]?.source_fingerprint === fingerprint && cached[0]?.analysis) return { ...cached[0].analysis, generatedAt: cached[0].generated_at, generator: cached[0].generator, model: cached[0].model, version: cached[0].version, sourceWeeks: source.map((week) => week.week) };
  } catch { /* cache is optional; grounded generation remains available */ }
  const generated = await generate({ participantId, participantName, processWeeks, env, client });
  const generatedAt = new Date().toISOString();
  const complete = { ...generated.analysis, generatedAt, generator: generated.generator, model: generated.model, version: CUSTOMER_CLARITY_VERSION, sourceWeeks: source.map((week) => week.week) };
  try {
    await fetch(`${service.url}/rest/v1/customer_clarity_analyses?on_conflict=user_profile_id`, { method: 'POST', headers: headers(key, { Prefer: 'resolution=merge-duplicates' }), body: JSON.stringify({ user_profile_id: participantId, source_fingerprint: fingerprint, analysis: generated.analysis, generator: generated.generator, model: generated.model, version: CUSTOMER_CLARITY_VERSION, generated_at: generatedAt, updated_at: generatedAt }) });
  } catch { /* returning the current analysis is more useful than failing the customer record */ }
  return complete;
}
