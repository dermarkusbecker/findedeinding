import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProgramAccess } from '../lib/program-access.js';

const requiredGates = (week, completed = true) => [1, 2, 3].map((index) => ({ week, gate_key: `w${week}_${index}`, required: true, completed_at: completed ? '2026-08-01T10:00:00Z' : null }));

test('completion_based ist der sichere Standard und öffnet zunächst nur Woche 1', () => {
  const access = calculateProgramAccess({ progress: {}, gates: [] });
  assert.equal(access.accessMode, 'completion_based');
  assert.deepEqual(access.unlockedWeeks, [1]);
});

test('completion_based öffnet die nächste Woche nur nach allen Pflicht-Gates', () => {
  const partialWeekOne = requiredGates(1); partialWeekOne[2].completed_at = null;
  assert.deepEqual(calculateProgramAccess({ progress: {}, gates: partialWeekOne }).unlockedWeeks, [1]);
  assert.deepEqual(calculateProgramAccess({ progress: {}, gates: requiredGates(1) }).unlockedWeeks, [1, 2]);
  assert.deepEqual(calculateProgramAccess({ progress: {}, gates: [...requiredGates(1), ...requiredGates(2)] }).unlockedWeeks, [1, 2, 3]);
});

test('time_based öffnet unabhängig vom Abschluss alle sieben Tage eine Woche', () => {
  const progress = { access_mode: 'time_based', program_start_date: '2026-08-31' };
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-08-31T12:00:00Z') }).unlockedWeeks, [1]);
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-09-07T00:00:00Z') }).unlockedWeeks, [1, 2]);
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-09-14T23:59:00Z') }).unlockedWeeks, [1, 2, 3]);
});

test('time_based verweigert vor dem individuellen Startdatum jeden Wochenzugriff', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'time_based', program_start_date: '2026-08-31' }, now: new Date('2026-08-30T21:59:00Z') });
  assert.deepEqual(access.unlockedWeeks, []);
});

test('full_access öffnet alle acht Wochen sofort', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'full_access' } });
  assert.deepEqual(access.unlockedWeeks, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('Admin-Unlock öffnet genau die gewählte Woche ohne vorherige Woche abzuschließen', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'completion_based', manually_unlocked_weeks: [3] }, gates: [] });
  assert.deepEqual(access.unlockedWeeks, [1, 3]);
  assert.deepEqual(access.completedWeeks, []);
  assert.equal(access.weekStates[2].reason, 'admin_unlocked');
});

test('Admin-Lock hat Vorrang vor Unlock und Full Access', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'full_access', manually_unlocked_weeks: [3], manually_locked_weeks: [3] } });
  assert.equal(access.canAccessWeek(3), false);
  assert.equal(access.weekStates[2].reason, 'admin_locked');
  assert.deepEqual(access.unlockedWeeks, [1, 2, 4, 5, 6, 7, 8]);
});

test('Pausierung hat höchste Priorität vor allen Modi und Overrides', () => {
  const access = calculateProgramAccess({ profileStatus: 'paused', progress: { access_mode: 'full_access', manually_unlocked_weeks: [1, 2, 3] } });
  assert.deepEqual(access.unlockedWeeks, []);
  assert.ok(access.weekStates.every((week) => week.reason === 'participant_paused'));
});

test('abgeschlossene Wochen bleiben weiterhin zugänglich', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'completion_based' }, gates: [...requiredGates(1), ...requiredGates(2), ...requiredGates(3)] });
  assert.deepEqual(access.completedWeeks, [1, 2, 3]);
  assert.deepEqual(access.unlockedWeeks, [1, 2, 3, 4]);
});
