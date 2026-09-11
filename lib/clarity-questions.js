import { GUIDED_WEEK_DEFINITIONS } from './guided-weeks.js';
import { WEEK_ONE_STEPS } from './week-one.js';
import { serviceHeaders } from './program-access-service.js';

const weekOneQuestions = [
  [WEEK_ONE_STEPS.WISHES, 'Deine drei Wünsche', 'Stell dir vor, vor dir steht eine Fee und du hast genau drei Wünsche frei. Welche drei Dinge würdest du dir für dein Leben aktuell am meisten wünschen?', 'dialog'],
  [WEEK_ONE_STEPS.WISH_1, 'Ersten Wunsch vertiefen', 'Was würde sich in deinem Leben konkret verändern, wenn dieser Wunsch erfüllt wäre?', 'dialog'],
  [WEEK_ONE_STEPS.WISH_2, 'Zweiten Wunsch vertiefen', 'Was würde sich in deinem Leben konkret verändern, wenn dieser Wunsch erfüllt wäre?', 'dialog'],
  [WEEK_ONE_STEPS.WISH_3, 'Dritten Wunsch vertiefen', 'Was würde sich in deinem Leben konkret verändern, wenn dieser Wunsch erfüllt wäre?', 'dialog'],
  [WEEK_ONE_STEPS.TARGET, 'Dein Zielbild', 'Stell dir vor, die acht Wochen sind vorbei und du blickst auf unseren gemeinsamen Prozess zurück. Was müsste sich für dich konkret verändert haben, damit du am Ende sagst: Finde dein Ding hat sich für mich wirklich gelohnt?', 'dialog'],
  [WEEK_ONE_STEPS.TARGET_CLARIFY, 'Zielbild konkretisieren', 'Was bedeutet Klarheit für dich konkret? Woran würdest du nach den acht Wochen merken: Jetzt habe ich sie?', 'dialog'],
  [WEEK_ONE_STEPS.CLARITY, 'Klarheits-Baseline', 'Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?', 'scale'],
  [WEEK_ONE_STEPS.CAREER_CHOICE, 'Lebenslauf hochladen', 'Lade jetzt bitte deinen aktuellen Lebenslauf hoch.', 'upload'],
  [WEEK_ONE_STEPS.CAREER_DIALOG, 'Berufliche Stationen', 'Was waren bisher die wichtigsten beruflichen Stationen in deinem Leben?', 'dialog'],
  [WEEK_ONE_STEPS.CAREER_CONFIRM, 'Beruflichen Weg bestätigen', 'Ist dein bisheriger beruflicher Weg damit im Wesentlichen vollständig?', 'confirmation'],
];

function defaultGuidance(item) {
  if (item.promptType === 'upload') return 'Erkläre ausschließlich, welches Dokument für diesen Schritt benötigt wird. Schließe den Schritt erst nach einem bestätigten Upload ab.';
  if (item.promptType === 'external') return 'Erkläre ausschließlich das sichtbare technische Ergebnis. Schließe den Schritt erst ab, wenn das System dieses Ergebnis bestätigt hat.';
  if (item.promptType === 'scale') return 'Bitte den Teilnehmer um genau einen Wert innerhalb der vorgegebenen Skala und stelle nur dann eine Rückfrage, wenn kein eindeutiger Wert erkennbar ist.';
  if (item.promptType === 'priority_selection') return 'Verwende nur die vorgegebene Auswahl. Die gewählten Einträge müssen eindeutig sein und in einer persönlichen Prioritätenreihenfolge stehen.';
  if (item.stepId === WEEK_ONE_STEPS.WISHES) return 'Erfasse genau drei verständliche Wünsche. Frage nur bei einem wirklich unklaren Wunsch einmal konkret nach und zeranalysiere klare Aussagen nicht.';
  return 'Bleibe ausschließlich bei dieser Frage. Stelle höchstens eine konkrete Rückfrage, wenn die Antwort die Abschlusskriterien noch nicht erfüllt, und erfinde keine Angaben.';
}

function defaultCompletionCriteria(item) {
  if (item.promptType === 'upload') return 'Ein technisch bestätigter Dokument-Upload ist vorhanden.';
  if (item.promptType === 'external') return 'Das angebundene System hat das erforderliche Ergebnis technisch bestätigt.';
  if (item.promptType === 'scale') return `Ein eindeutiger Wert${item.rules?.min ? ` zwischen ${item.rules.min} und ${item.rules.max}` : ' innerhalb der sichtbaren Skala'} ist erfasst.`;
  if (item.promptType === 'priority_selection') return `Genau ${item.rules?.minItems || 1} unterschiedliche Einträge wurden ausgewählt und vollständig priorisiert.`;
  if (item.stepId === WEEK_ONE_STEPS.WISHES) return 'Genau drei eigenständige und verständliche Wünsche sind erfasst und vom Teilnehmer bestätigt.';
  if (item.rules?.expected) return `Die eindeutige Bestätigung „${item.rules.expected}“ wurde erfasst.`;
  if (item.rules?.minItems && item.rules?.maxItems === item.rules?.minItems) return `Genau ${item.rules.minItems} eigenständige Punkte sind eindeutig erfasst.`;
  if (item.rules?.minItems) return `Mindestens ${item.rules.minItems} eigenständige Punkte sind eindeutig erfasst.`;
  return 'Die Frage ist inhaltlich verständlich beantwortet; es besteht keine offene Rückfrage mehr.';
}

const rawCatalog = [
  ...weekOneQuestions.map(([stepId, title, promptText, promptType], index) => ({ questionKey: `1.${stepId}`, week: 1, stepId, title, promptText, promptType, sortOrder: index + 1, rules: null })),
  ...Object.entries(GUIDED_WEEK_DEFINITIONS).flatMap(([week, definition]) => definition.steps.map((item, index) => ({
    questionKey: `${week}.${item.id}`,
    week: Number(week),
    stepId: item.id,
    title: item.title,
    promptText: item.question,
    promptType: item.kind,
    sortOrder: index + 1,
    rules: item,
  }))),
];

const catalog = rawCatalog.map((item) => ({
  ...item,
  guidanceText: defaultGuidance(item),
  completionCriteria: defaultCompletionCriteria(item),
}));

export const CLARITY_QUESTION_CATALOG = Object.freeze(catalog.map((item) => Object.freeze(item)));

export function defaultClarityQuestion(questionKey) {
  return CLARITY_QUESTION_CATALOG.find((item) => item.questionKey === questionKey) || null;
}

export function resolveClarityPrompt(overrides, week, stepId, fallback = '') {
  return resolveClarityQuestionConfig(overrides, week, stepId, { promptText: fallback }).promptText;
}

export function resolveClarityQuestionConfig(overrides, week, stepId, fallback = {}) {
  const key = `${Number(week)}.${stepId}`;
  const definition = defaultClarityQuestion(key);
  const configured = (Array.isArray(overrides) ? overrides : []).find((item) => item.question_key === key);
  const fallbackPrompt = String(fallback.promptText ?? fallback.question ?? '').trim();
  const promptText = configured?.enabled === false || !configured?.prompt_text?.trim()
    ? fallbackPrompt
    : configured.default_prompt_text && configured.prompt_text.trim() === configured.default_prompt_text.trim()
      ? fallbackPrompt || configured.prompt_text.trim()
      : configured.prompt_text.trim();
  return {
    questionKey: key,
    title: configured?.title || definition?.title || fallback.title || '',
    promptText: promptText || definition?.promptText || '',
    guidanceText: configured?.guidance_text?.trim() || definition?.guidanceText || fallback.guidanceText || '',
    completionCriteria: configured?.completion_criteria?.trim() || definition?.completionCriteria || fallback.completionCriteria || '',
    enabled: configured?.enabled !== false,
  };
}

export async function readClarityQuestionOverrides(service, week = null) {
  const hasWeek = week !== null && week !== '' && Number.isInteger(Number(week));
  const filter = hasWeek ? `&week=eq.${Number(week)}` : '';
  const response = await fetch(`${service.url}/rest/v1/clarity_questions?select=question_key,week,step_id,title,prompt_text,default_prompt_text,guidance_text,default_guidance_text,completion_criteria,default_completion_criteria,prompt_type,sort_order,enabled,updated_at${filter}&order=week.asc,sort_order.asc`, { headers: serviceHeaders(service.key) });
  const rows = await response.json().catch(() => ([]));
  if (!response.ok && (response.status === 404 || ['PGRST205', '42P01'].includes(rows?.code))) return [];
  if (!response.ok) throw new Error(rows.message || 'Die konfigurierten Klarheitsfragen konnten nicht geladen werden.');
  return rows;
}

export function clarityQuestionSeedRows() {
  return CLARITY_QUESTION_CATALOG.map((item) => ({
    question_key: item.questionKey,
    week: item.week,
    step_id: item.stepId,
    title: item.title,
    prompt_text: item.promptText,
    default_prompt_text: item.promptText,
    guidance_text: item.guidanceText,
    default_guidance_text: item.guidanceText,
    completion_criteria: item.completionCriteria,
    default_completion_criteria: item.completionCriteria,
    prompt_type: item.promptType,
    sort_order: item.sortOrder,
    enabled: true,
  }));
}
