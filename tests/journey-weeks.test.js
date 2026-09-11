import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyWeeks } from '../lib/journey-weeks.js';

test('Mein Weg zeigt auch während einer leeren Zugriffssynchronisierung alle acht Wochen', () => {
  const weeks = buildJourneyWeeks({
    onboardingComplete: false,
    programWeeks: [],
    access: { weekStates: [], completedWeeks: [] },
  });
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.map((item) => item.week), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(weeks.every((item) => item.reason === 'onboarding_required'));
  assert.equal(weeks[0].summary.title, 'Ausgangslage');
  assert.equal(weeks[7].summary.title, 'Umsetzung');
});

test('Demo-Kunde behält alle acht Wochen und deren Sofortzugriff', () => {
  const weeks = buildJourneyWeeks({
    onboardingComplete: true,
    programWeeks: Array.from({ length: 8 }, (_, index) => ({ week: index + 1, title: `Inhalt ${index + 1}` })),
    access: { fullProgramAccess: true, completedWeeks: [1], weekStates: [{ week: 1, completed: true }] },
  });
  assert.equal(weeks.length, 8);
  assert.ok(weeks.every((item) => item.accessible));
  assert.ok(weeks.every((item) => item.reason === 'demo_full_access'));
  assert.equal(weeks[0].completed, true);
  assert.equal(weeks[7].summary.title, 'Inhalt 8');
});

test('unvollständige API-Zustände verändern weder Reihenfolge noch Programminhalte', () => {
  const weeks = buildJourneyWeeks({
    onboardingComplete: true,
    programWeeks: [{ week: 3, title: 'Meine Motivatoren' }],
    access: { weekStates: [{ week: 3, accessible: true, reason: 'scheduled_release' }] },
  });
  assert.equal(weeks.length, 8);
  assert.equal(weeks[2].summary.title, 'Meine Motivatoren');
  assert.equal(weeks[2].accessible, true);
  assert.equal(weeks[1].summary.title, 'Fähigkeiten & Umfeld');
});
