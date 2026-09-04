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

const catalog = [
  ...weekOneQuestions.map(([stepId, title, promptText, promptType], index) => ({ questionKey: `1.${stepId}`, week: 1, stepId, title, promptText, promptType, sortOrder: index + 1 })),
  ...Object.entries(GUIDED_WEEK_DEFINITIONS).flatMap(([week, definition]) => definition.steps.map((item, index) => ({
    questionKey: `${week}.${item.id}`,
    week: Number(week),
    stepId: item.id,
    title: item.title,
    promptText: item.question,
    promptType: item.kind,
    sortOrder: index + 1,
  }))),
];

export const CLARITY_QUESTION_CATALOG = Object.freeze(catalog.map((item) => Object.freeze(item)));

export function defaultClarityQuestion(questionKey) {
  return CLARITY_QUESTION_CATALOG.find((item) => item.questionKey === questionKey) || null;
}

export function resolveClarityPrompt(overrides, week, stepId, fallback = '') {
  const key = `${Number(week)}.${stepId}`;
  const configured = (Array.isArray(overrides) ? overrides : []).find((item) => item.question_key === key);
  if (configured?.enabled === false || !configured?.prompt_text?.trim()) return fallback;
  if (configured.default_prompt_text && configured.prompt_text.trim() === configured.default_prompt_text.trim()) return fallback;
  return configured.prompt_text.trim();
}

export async function readClarityQuestionOverrides(service, week = null) {
  const hasWeek = week !== null && week !== '' && Number.isInteger(Number(week));
  const filter = hasWeek ? `&week=eq.${Number(week)}` : '';
  const response = await fetch(`${service.url}/rest/v1/clarity_questions?select=question_key,week,step_id,title,prompt_text,default_prompt_text,prompt_type,sort_order,enabled,updated_at${filter}&order=week.asc,sort_order.asc`, { headers: serviceHeaders(service.key) });
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
    prompt_type: item.promptType,
    sort_order: item.sortOrder,
    enabled: true,
  }));
}
