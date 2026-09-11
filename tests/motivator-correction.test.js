import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuidedWeekAction, createGuidedWeekState } from '../lib/guided-weeks.js';
const initialItems = ['Macht','Freiheit','Neugier','Anerkennung','Ordnung'];
function savedState() {
  const started = applyGuidedWeekAction(createGuidedWeekState(3), { type: 'save_clarity_checkin', score: 5, changed: false }).state;
  return applyGuidedWeekAction(started, { type: 'save_answer', stepId: 'motivators', items: initialItems }).state;
}
test('saved motivators can change selection and order without changing current step or later answers', () => {
  const state = savedState();
  state.answers.underused = { raw_answer: 'Meine bisherige Antwort', status: 'completed' };
  const items = ['Ruhe','Ordnung','Freiheit','Sparen','Macht'];
  const result = applyGuidedWeekAction(state, { type: 'correct_answer', stepId: 'motivators', items });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.answers.motivators.items, items);
  assert.equal(result.state.current_step, state.current_step);
  assert.deepEqual(result.state.answers.underused, state.answers.underused);
  assert.deepEqual(state.answers.motivators.items, initialItems);
});
test('exactly five distinct allowed motivators remain required for corrections', () => {
  for (const items of [[],initialItems.slice(1),[...initialItems,'Ruhe'],['Macht','Macht','Ruhe','Ordnung','Sparen'],['Unbekannt',...initialItems.slice(1)]]) {
    assert.equal(applyGuidedWeekAction(savedState(), { type: 'correct_answer', stepId: 'motivators', items }).ok, false);
  }
});
test('ready to finish still allows changes, but finalized weeks are locked', () => {
  const state = savedState();
  state.current_step = null;
  state.status = 'ready_to_complete';
  const action = { type: 'correct_answer', stepId: 'motivators', items: [...initialItems].reverse() };
  assert.equal(applyGuidedWeekAction(state, action).ok, true);
  assert.equal(applyGuidedWeekAction({ ...state, status: 'completed', completed_at: new Date().toISOString() }, action).ok, false);
});
