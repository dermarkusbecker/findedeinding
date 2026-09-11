import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoWeekPreview } from '../lib/demo-week-preview.js';
import { guidedWeekDefinition } from '../lib/guided-weeks.js';
const demo = { onboardingComplete: true, access: { fullProgramAccess: true, status: 'active', processWeek: 1, completedWeeks: [] } };
test('demo can browse all eight weeks without completing prior weeks or recording a score', () => {
  const before = structuredClone(demo);
  for (let week = 1; week <= 8; week++) {
    const preview = buildDemoWeekPreview(demo, week);
    assert.equal(preview.week, week);
    assert.ok(preview.steps.every((step) => step.title && step.question));
    if (week >= 2) assert.deepEqual(preview.steps.slice(1), guidedWeekDefinition(week).steps);
  }
  assert.deepEqual(demo, before);
});
test('ordinary customers, paused programs and invalid weeks do not get demo browsing', () => {
  for (const program of [{}, { ...demo, onboardingComplete: false }, { ...demo, access: { ...demo.access, fullProgramAccess: false } }, { ...demo, access: { ...demo.access, status: 'paused' } }]) {
    assert.equal(buildDemoWeekPreview(program, 8), null);
  }
  for (const week of [0,9,2.5,NaN]) assert.equal(buildDemoWeekPreview(demo,week),null);
});
