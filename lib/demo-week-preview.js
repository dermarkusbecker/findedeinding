import { guidedWeekDefinition } from './guided-weeks.js';
import { createWeekOneState, weekOnePrompt, WEEK_ONE_STEPS } from './week-one.js';

export function buildDemoWeekPreview(program, week) {
  if (program?.access?.fullProgramAccess !== true || !program.onboardingComplete || program.access.status === 'paused') return null;
  const number = Number(week);
  if (!Number.isInteger(number) || number < 1 || number > 8) return null;
  const summary = program.programWeeks?.find((item) => Number(item.week) === number) || {};
  const definition = guidedWeekDefinition(number);
  const baseline = { title: 'Klarheits-Check-in', question: 'Wie klar ist dir gerade, was wirklich dein Ding ist? Wähle deinen Wert von 1 bis 10.', kind: 'scale' };
  let steps;
  if (number === 1) {
    const state = createWeekOneState();
    steps = [
      [WEEK_ONE_STEPS.WISHES, 'Deine drei Wünsche'],
      [WEEK_ONE_STEPS.WISH_1, 'Deinen ersten Wunsch vertiefen'],
      [WEEK_ONE_STEPS.WISH_2, 'Deinen zweiten Wunsch vertiefen'],
      [WEEK_ONE_STEPS.WISH_3, 'Deinen dritten Wunsch vertiefen'],
      [WEEK_ONE_STEPS.TARGET, 'Dein persönliches Ziel'],
      [WEEK_ONE_STEPS.CAREER_CHOICE, 'Dein beruflicher Werdegang'],
      [WEEK_ONE_STEPS.REVIEW, 'Deine Wochenreflexion'],
    ].map(([current_step, title]) => {
      const prompt = weekOnePrompt({ ...state, current_step });
      return { title, question: prompt.question || prompt.help, kind: current_step === WEEK_ONE_STEPS.CAREER_CHOICE ? 'upload' : 'reflection' };
    });
  } else steps = definition.steps;
  return { week: number, title: summary.title || definition?.title || 'Jetzt geht es los', description: summary.description || definition?.intro || '', steps: [baseline, ...steps] };
}
