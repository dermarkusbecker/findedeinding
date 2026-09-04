import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProgramAccess, isOnboardingComplete, programWeekSchedule, reopenWeekState, resetParticipantProgressState } from '../lib/program-access.js';

const requiredGates = (week, completed = true) => [1, 2, 3].map((index) => ({ week, gate_key: `w${week}_${index}`, required: true, completed_at: completed ? '2026-08-01T10:00:00Z' : null }));

test('resetParticipantProgressState setzt den Prozess auf Onboarding zurück und öffnet die Wiederholung', () => {
  const reset = resetParticipantProgressState();
  assert.equal(reset.current_week, 0);
  assert.equal(reset.process_status, 'ONBOARDING');
  assert.equal(reset.privacy_consent_at, null);
  assert.equal(reset.start_commitment_at, null);
  assert.deepEqual(reset.manually_unlocked_weeks, []);
  assert.deepEqual(reset.manually_locked_weeks, []);
  assert.equal(reset.access_mode, 'time_based');
});

test('Onboarding richtet sich nach den beiden getrennt protokollierten Start-Gates', () => {
  assert.equal(isOnboardingComplete({ current_week: 0, process_status: 'ONBOARDING', privacy_consent_at: '2026-08-01T00:00:00Z', start_commitment_at: '2026-08-01T00:00:00Z' }), true);
  assert.equal(isOnboardingComplete({ current_week: 1, process_status: 'WEEK_1', privacy_consent_at: '2026-08-01T00:00:00Z', start_commitment_at: '2026-08-01T00:00:00Z' }), true);
  assert.equal(isOnboardingComplete({ current_week: 1, process_status: 'ONBOARDING', privacy_consent_at: '2026-08-01T00:00:00Z', start_commitment_at: '2026-08-01T00:00:00Z' }), true);
  assert.equal(isOnboardingComplete({ current_week: 1, process_status: 'WEEK_1', privacy_consent_at: '2026-08-01T00:00:00Z' }), false);
  assert.equal(isOnboardingComplete({ current_week: 1, process_status: 'WEEK_1', start_commitment_at: '2026-08-01T00:00:00Z' }), false);
});

test('reopenWeekState setzt den Teilnehmer auf die gewählte Woche zurück und erlaubt den Replay', () => {
  const reopened = reopenWeekState(3);
  assert.equal(reopened.current_week, 3);
  assert.equal(reopened.process_status, 'WEEK_3');
  assert.equal(reopened.last_activity_at, null);
});

test('zeitbasiert ist der Standard und öffnet am Projektstart nur Woche 1', () => {
  const access = calculateProgramAccess({ progress: { program_start_date: '2026-09-04' }, gates: [], now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.accessMode, 'time_based');
  assert.deepEqual(access.unlockedWeeks, [1]);
});

test('gespeicherte Woche 3 überspringt am neuen Projektstart nicht Woche 1', () => {
  const access = calculateProgramAccess({ progress: { current_week: 3, access_mode: 'time_based', program_start_date: '2026-09-04' }, now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.recordedCurrentWeek, 3);
  assert.equal(access.currentWeek, 1);
  assert.deepEqual(access.unlockedWeeks, [1]);
});

test('Projektstart erzeugt acht vollständige Wochenfenster und ein festes Programmende', () => {
  const schedule = programWeekSchedule('2026-09-04');
  assert.equal(schedule.length, 8);
  assert.deepEqual(schedule[0], { week: 1, unlocksAt: '2026-09-04', endsAt: '2026-09-11' });
  assert.deepEqual(schedule[7], { week: 8, unlocksAt: '2026-10-23', endsAt: '2026-10-30' });
  const access = calculateProgramAccess({ progress: { access_mode: 'time_based', program_start_date: '2026-09-04' }, now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.programEndDate, '2026-10-30');
  assert.equal(access.weekStates[1].reason, 'scheduled_wait');
});

test('alte Abschlussmodi verändern die feste zeitbasierte Freischaltung nicht mehr', () => {
  const progress = { access_mode: 'completion_based', program_start_date: '2026-09-04' };
  const access = calculateProgramAccess({ progress, gates: [...requiredGates(1), ...requiredGates(2)], now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.accessMode, 'time_based');
  assert.deepEqual(access.unlockedWeeks, [1]);
});

test('time_based öffnet unabhängig vom Abschluss alle sieben Tage eine Woche', () => {
  const progress = { access_mode: 'time_based', program_start_date: '2026-08-31' };
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-08-31T12:00:00Z') }).unlockedWeeks, [1]);
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-09-07T00:00:00Z') }).unlockedWeeks, [1, 2]);
  assert.deepEqual(calculateProgramAccess({ progress, now: new Date('2026-09-14T23:59:00Z') }).unlockedWeeks, [1, 2, 3]);
});

test('Prozessposition bleibt nach zwei Abschlüssen in Woche 3, auch wenn Woche 8 zeitlich freigeschaltet ist', () => {
  const gates = [...requiredGates(1), ...requiredGates(2), ...requiredGates(3, false)];
  const access = calculateProgramAccess({ progress: { current_week: 8, program_start_date: '2026-07-01' }, gates, now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.currentWeek, 8);
  assert.deepEqual(access.completedWeeks, [1, 2]);
  assert.equal(access.processWeek, 3);
});

test('time_based verweigert vor dem individuellen Startdatum jeden Wochenzugriff', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'time_based', program_start_date: '2026-08-31' }, now: new Date('2026-08-30T21:59:00Z') });
  assert.deepEqual(access.unlockedWeeks, []);
});

test('alter Full-Access-Modus wird zugunsten des Zeitplans ignoriert', () => {
  const access = calculateProgramAccess({ progress: { access_mode: 'full_access', program_start_date: '2026-09-04' }, now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(access.accessMode, 'time_based');
  assert.deepEqual(access.unlockedWeeks, [1]);
});

test('alte manuelle Overrides können den automatischen Zeitplan nicht umgehen', () => {
  const access = calculateProgramAccess({ progress: { program_start_date: '2026-09-04', manually_unlocked_weeks: [3], manually_locked_weeks: [1] }, now: new Date('2026-09-04T12:00:00Z') });
  assert.deepEqual(access.unlockedWeeks, [1]);
  assert.deepEqual(access.manuallyUnlockedWeeks, []);
  assert.deepEqual(access.manuallyLockedWeeks, []);
  assert.equal(access.weekStates[0].reason, 'scheduled_release');
});

test('Pausierung stoppt auch den festen Zeitplan', () => {
  const access = calculateProgramAccess({ profileStatus: 'paused', progress: { program_start_date: '2026-09-04' }, now: new Date('2026-09-25T12:00:00Z') });
  assert.deepEqual(access.unlockedWeeks, []);
  assert.ok(access.weekStates.every((week) => week.reason === 'participant_paused'));
});

test('abgeschlossene Wochen bleiben weiterhin zugänglich', () => {
  const access = calculateProgramAccess({ progress: { program_start_date: '2026-09-04' }, gates: [...requiredGates(1), ...requiredGates(2), ...requiredGates(3)], now: new Date('2026-09-25T12:00:00Z') });
  assert.deepEqual(access.completedWeeks, [1, 2, 3]);
  assert.deepEqual(access.unlockedWeeks, [1, 2, 3, 4]);
});
