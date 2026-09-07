import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProgramAccess } from '../lib/program-access.js';
import { canonicalProgressPatch, reconcileAccessFromEntries } from '../lib/program-position.js';
import { createWeekOneState } from '../lib/week-one.js';
import { createGuidedWeekState, guidedWeekDefinition } from '../lib/guided-weeks.js';

const progress = {
  current_week: 3,
  process_status: 'WEEK_3',
  program_start_date: '2026-09-04',
  privacy_consent_at: '2026-09-04T08:00:00Z',
  start_commitment_at: '2026-09-04T08:00:00Z',
};

const entry = (week, state, createdAt = '2026-09-04T10:00:00Z') => ({
  week,
  data_block: `week_${week}_state`,
  structured_data: { [`week_${week}`]: state },
  created_at: createdAt,
});

function completedWeekOne() {
  const state = createWeekOneState();
  state.status = 'completed';
  state.completed_at = '2026-09-04T09:00:00Z';
  state.wishes = state.wishes.map((wish) => ({ ...wish, completed: true }));
  state.fdd_target.completed = true;
  state.clarity_baseline = { score: 4, completed: true };
  state.career_history = { ...state.career_history, cv_uploaded: true, completed: true };
  return state;
}

function completedGuidedWeek(week) {
  const state = createGuidedWeekState(week);
  state.status = 'completed';
  state.completed_at = '2026-09-11T09:00:00Z';
  state.clarity_checkin.completed = true;
  state.completed_steps = guidedWeekDefinition(week).steps.map((step) => step.id);
  return state;
}

test('ein gespeicherter Wochensprung ohne abgeschlossenen Wochenzustand fällt auf Woche 1 zurück', () => {
  const scheduled = calculateProgramAccess({ progress, now: new Date('2026-09-04T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress, entries: [] });
  assert.equal(access.processWeek, 1);
  assert.deepEqual(access.completedWeeks, []);
  assert.deepEqual(canonicalProgressPatch(access, progress), { current_week: 1, process_status: 'WEEK_1' });
});

test('ein früher Abschluss zeigt bis zur nächsten Freigabe weiterhin die laufende Kalenderwoche', () => {
  const scheduled = calculateProgramAccess({ progress: { ...progress, current_week: 1, process_status: 'WEEK_1' }, now: new Date('2026-09-04T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress, entries: [entry(1, completedWeekOne())] });
  assert.deepEqual(access.completedWeeks, [1]);
  assert.equal(access.processWeek, 1);
  assert.equal(access.weekStates[1].accessible, false);
  assert.equal(canonicalProgressPatch(access, { ...progress, current_week: 1, process_status: 'WEEK_1' }), null);
});

test('Demo-Kunde kann nach einem validen Abschluss ohne siebentägige Wartezeit in die nächste Woche', () => {
  const demoProgress = { ...progress, current_week: 2, process_status: 'WEEK_2' };
  const scheduled = calculateProgramAccess({ progress: demoProgress, fullProgramAccess: true, now: new Date('2026-09-04T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress: demoProgress, entries: [entry(1, completedWeekOne())] });
  assert.deepEqual(access.completedWeeks, [1]);
  assert.equal(access.processWeek, 2);
  assert.equal(access.canAccessWeek(2), true);
});

test('vollständige Daten einer zukünftigen Woche bleiben bis zu ihrem Startdatum wirkungslos', () => {
  const scheduled = calculateProgramAccess({ progress, now: new Date('2026-09-04T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress, entries: [entry(1, completedWeekOne()), entry(2, completedGuidedWeek(2))] });
  assert.deepEqual(access.automaticUnlockedWeeks, [1]);
  assert.deepEqual(access.completedWeeks, [1]);
  assert.equal(access.processWeek, 1);
  assert.equal(access.weekStates[1].completed, false);
});

test('am Freischaltungsdatum wird eine korrekt abgeschlossene Folgewoche berücksichtigt', () => {
  const scheduled = calculateProgramAccess({ progress, now: new Date('2026-09-11T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress, entries: [entry(1, completedWeekOne()), entry(2, completedGuidedWeek(2), '2026-09-11T10:00:00Z')] });
  assert.deepEqual(access.completedWeeks, [1, 2]);
  assert.equal(access.processWeek, 2);
});

test('vor der Freischaltung gespeicherte Abschlussdaten bleiben auch später ungültig', () => {
  const scheduled = calculateProgramAccess({ progress, now: new Date('2026-09-11T12:00:00Z') });
  const access = reconcileAccessFromEntries({ access: scheduled, progress, entries: [entry(1, completedWeekOne()), entry(2, completedGuidedWeek(2), '2026-09-04T10:00:00Z')] });
  assert.deepEqual(access.completedWeeks, [1]);
  assert.equal(access.processWeek, 2);
});
