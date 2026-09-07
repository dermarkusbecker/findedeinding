import test from 'node:test';
import assert from 'node:assert/strict';
import { processWeekResult } from '../api/program-control.js';
import { createGuidedWeekState } from '../lib/guided-weeks.js';
import { createWeekOneState } from '../lib/week-one.js';

test('Admin-Prozessansicht zeigt echte Eingaben der freigegebenen Woche', () => {
  const weekOne = createWeekOneState();
  weekOne.wishes[0] = { ...weekOne.wishes[0], raw_wish: 'Mehr Zeit für meine Familie', desired_state: 'Mehr Zeit für meine Familie', completed: true };
  weekOne.fdd_target = { ...weekOne.fdd_target, raw_answer: 'Eine klare berufliche Entscheidung treffen', completed: true };
  weekOne.clarity_baseline = { score: 3, reason_raw: 'Mir fehlen noch konkrete Optionen.', completed: true };
  weekOne.updated_at = '2026-09-04T09:30:00.000Z';
  const result = processWeekResult({
    stateEntries: [{ week: 1, data_block: 'week_1_state', structured_data: { week_1: weekOne }, created_at: weekOne.updated_at }],
    serializedAccess: {
      processWeek: 1,
      automaticUnlockedWeeks: [1],
      weekStates: Array.from({ length: 8 }, (_, index) => ({ week: index + 1, accessible: index === 0, completed: false, reason: index === 0 ? 'scheduled_release' : 'scheduled_wait', unlocksAt: `2026-${index < 4 ? '09' : '10'}-${String(4 + index * 7).padStart(2, '0')}` })),
    },
  });
  assert.equal(result.length, 8);
  assert.equal(result[0].title, 'Ausgangslage');
  assert.ok(result[0].answers.some((answer) => answer.label === 'Wunsch 1' && answer.value === 'Mehr Zeit für meine Familie'));
  assert.ok(result[0].answers.some((answer) => answer.label === 'Ziel nach acht Wochen'));
  assert.ok(result[0].answers.some((answer) => answer.label === 'Klarheits-Baseline' && answer.value.startsWith('3 von 10')));
});

test('Admin-Prozessansicht blendet verfrüht gespeicherte Zukunftsdaten aus', () => {
  const weekTwo = createGuidedWeekState(2);
  weekTwo.answers.education = { raw_answer: 'Diese Eingabe dürfte noch nicht sichtbar sein.', status: 'completed' };
  weekTwo.completed_steps = ['education'];
  const result = processWeekResult({
    stateEntries: [{ week: 2, data_block: 'week_2_state', structured_data: { week_2: weekTwo }, created_at: '2026-09-04T10:00:00.000Z' }],
    serializedAccess: {
      processWeek: 1,
      automaticUnlockedWeeks: [1],
      weekStates: Array.from({ length: 8 }, (_, index) => ({ week: index + 1, accessible: index === 0, completed: false, reason: index === 0 ? 'scheduled_release' : 'scheduled_wait', unlocksAt: null })),
    },
  });
  assert.deepEqual(result[1].answers, []);
  assert.equal(result[1].updatedAt, null);
});
