import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuidedWeekAction, createGuidedWeekState, currentGuidedStep, guidedGateStatus, guidedStepStatuses, guidedWeekComplete, guidedWeekDefinition } from '../lib/guided-weeks.js';
import { applyClaraStateSuggestions } from '../lib/clara/state-bridge.js';

const payload = (overrides = {}) => ({ wishes: null, wish_index: null, wish: null, answer: null, score: null, reason: null, source: null, confirmed: null, complete: null, step_id: null, items: null, confirmed_none: null, ...overrides });
const beginWeek = (week, overrides = {}) => applyGuidedWeekAction(createGuidedWeekState(week), { type: 'save_clarity_checkin', stepId: 'weekly_clarity', score: 5, changed: false, note: '', ...overrides }).state;

test('Wochen 2 bis 8 besitzen einen versionierten geführten State', () => {
  for (let week = 2; week <= 8; week += 1) {
    const definition = guidedWeekDefinition(week);
    const state = createGuidedWeekState(week);
    assert.ok(definition.steps.length >= 4);
    assert.equal(state.week, week);
    assert.equal(state.version, 2);
    assert.equal(state.clarity_checkin.completed, false);
    assert.equal(guidedStepStatuses(state)[0].id, 'weekly_clarity');
    assert.equal(state.current_step, definition.steps[0].id);
    assert.equal(guidedWeekComplete(state), false);
  }
});

test('Clara kann ausschließlich den aktuell offenen Schritt verändern', () => {
  const state = createGuidedWeekState(2);
  const malicious = applyClaraStateSuggestions(state, [{ action: 'save_guided_answer', payload: payload({ step_id: 'current_goal', answer: 'Ich möchte wechseln.' }) }]);
  assert.equal(malicious.changed, false);
  assert.equal(malicious.rejected[0].reason, 'ACTION_NOT_ALLOWED_FOR_CURRENT_STEP');
  assert.equal(state.current_step, 'education');
});

test('eine validierte Antwort wird roh gespeichert und setzt exakt einen Schritt fort', () => {
  const state = beginWeek(2);
  const result = applyClaraStateSuggestions(state, [{ action: 'save_guided_answer', payload: payload({ step_id: 'education', answer: 'Ausbildung zum Mediengestalter und ein Seminar in Projektmanagement.' }) }]);
  assert.equal(result.changed, true);
  assert.equal(result.state.answers.education.raw_answer, 'Ausbildung zum Mediengestalter und ein Seminar in Projektmanagement.');
  assert.equal(result.state.current_step, 'informal_skills');
  assert.deepEqual(state.answers, {});
});

test('eine frühere Dialogantwort kann korrigiert werden, ohne den offenen Schritt zu überspringen', () => {
  let state = beginWeek(2);
  state = applyGuidedWeekAction(state, { type: 'save_answer', stepId: 'education', answer: 'Ausbildung im Verkauf.' }).state;
  const result = applyClaraStateSuggestions(state, [{ action: 'correct_guided_answer', payload: payload({ step_id: 'education', answer: 'Ausbildung im Verkauf und Weiterbildung im Projektmanagement.' }) }]);
  assert.equal(result.changed, true);
  assert.equal(result.state.current_step, 'informal_skills');
  assert.equal(result.state.answers.education.raw_answer, 'Ausbildung im Verkauf und Weiterbildung im Projektmanagement.');
  assert.ok(result.state.answers.education.corrected_at);
});

test('Mindestanforderungen werden im Reducer und nicht vom Modell durchgesetzt', () => {
  const state = beginWeek(6);
  state.current_step = 'exclusions';
  state.completed_steps = guidedWeekDefinition(6).steps.slice(0, 5).map((step) => step.id);
  const tooShort = applyGuidedWeekAction(state, { type: 'save_answer', stepId: 'exclusions', answer: 'Starre Zeiten', items: ['Starre Zeiten'] });
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.error, /mindestens 10/);
  const ten = Array.from({ length: 10 }, (_, index) => `Ausschluss ${index + 1}`);
  const valid = applyGuidedWeekAction(state, { type: 'save_answer', stepId: 'exclusions', answer: ten.join('\n'), items: ten });
  assert.equal(valid.ok, true);
  assert.equal(valid.state.answers.exclusions.items.length, 10);
});

test('Upload- und externe Schritte lassen sich nicht durch Chattext umgehen', () => {
  const upload = beginWeek(5);
  upload.current_step = 'eulogy';
  upload.completed_steps = guidedWeekDefinition(5).steps.slice(0, 4).map((step) => step.id);
  assert.equal(applyGuidedWeekAction(upload, { type: 'save_answer', stepId: 'eulogy', answer: 'Ist erledigt.' }).ok, false);
  assert.equal(applyGuidedWeekAction(upload, { type: 'document_uploaded', stepId: 'eulogy', documentId: 'doc_1', fileName: 'grabrede.pdf' }).ok, true);

  const external = beginWeek(4);
  external.current_step = 'human_design';
  external.completed_steps = ['birth_data'];
  assert.equal(applyGuidedWeekAction(external, { type: 'save_answer', stepId: 'human_design', answer: 'Generator' }).ok, false);
  assert.equal(applyGuidedWeekAction(external, { type: 'external_completed', stepId: 'human_design', external: 'human_design', verified: false }).ok, false);
  assert.equal(applyGuidedWeekAction(external, { type: 'external_completed', stepId: 'human_design', external: 'human_design', verified: true, resultId: 'chart_1' }).ok, true);
});

test('Woche 7 benötigt nach der Tendenz eine persönlich bestätigte Entscheidung', () => {
  const definition = guidedWeekDefinition(7);
  const resolution = definition.steps.find((step) => step.id === 'decision_resolution');
  assert.equal(resolution.kind, 'external');
  assert.equal(resolution.external, 'decision_confirmation');
  const state = beginWeek(7);
  state.current_step = resolution.id;
  state.completed_steps = definition.steps.filter((step) => step.id !== resolution.id).map((step) => step.id);
  assert.equal(guidedWeekComplete(state), false);
  assert.equal(applyGuidedWeekAction(state, { type: 'save_answer', stepId: resolution.id, answer: 'Ich entscheide mich einfach.' }).ok, false);
});

test('Gate-Status entsteht ausschließlich aus den zugehörigen abgeschlossenen Schritten', () => {
  let state = beginWeek(3);
  const first = currentGuidedStep(state);
  state = applyGuidedWeekAction(state, { type: 'save_answer', stepId: first.id, answer: 'Freiheit, Neugier, Beziehungen, Wirkung, Gerechtigkeit', items: ['Freiheit', 'Neugier', 'Beziehungen', 'Wirkung', 'Gerechtigkeit'] }).state;
  assert.equal(guidedGateStatus(state).motivators, false);
  state = applyGuidedWeekAction(state, { type: 'save_answer', stepId: 'undersupplied', answer: 'Freiheit' }).state;
  assert.equal(guidedGateStatus(state).motivators, true);
  assert.equal(guidedGateStatus(state).childhood, false);
});

test('End-to-End: Wochen 2 bis 8 können nur in Reihenfolge und mit verifizierten Hybrid-Schritten abgeschlossen werden', () => {
  for (let week = 2; week <= 8; week += 1) {
    let state = beginWeek(week, { score: Math.min(10, week + 1), changed: true, note: `Veränderung in Woche ${week}` });
    const definition = guidedWeekDefinition(week);
    for (const expectedStep of definition.steps) {
      state = JSON.parse(JSON.stringify(state));
      const active = currentGuidedStep(state);
      assert.equal(active.id, expectedStep.id);
      let action;
      if (active.kind === 'external') action = { type: 'external_completed', stepId: active.id, external: active.external, verified: true, resultId: `verified-${week}-${active.id}` };
      else if (active.kind === 'upload') action = { type: 'document_uploaded', stepId: active.id, documentId: `document-${week}-${active.id}`, fileName: `${active.id}.pdf` };
      else if (active.kind === 'scale') action = { type: 'save_answer', stepId: active.id, answer: '7', score: 7 };
      else {
        const count = active.minItems || 1;
        const items = Array.from({ length: count }, (_, index) => `${active.title} ${index + 1}`);
        const answer = active.expected || items.join('\n');
        action = { type: 'save_answer', stepId: active.id, answer, items };
      }
      const update = applyGuidedWeekAction(state, action);
      assert.equal(update.ok, true, `Woche ${week}, Schritt ${active.id}: ${update.error || ''}`);
      state = update.state;
    }
    assert.equal(guidedWeekComplete(state), true, `Woche ${week} muss vollständig sein`);
    assert.equal(state.status, 'ready_to_complete');
    assert.ok(Object.values(guidedGateStatus(state)).every(Boolean));
  }
});

test('jede Folgewoche beginnt mit einer unveränderlichen Klarheitsmessung', () => {
  const state = createGuidedWeekState(2);
  const blocked = applyGuidedWeekAction(state, { type: 'save_answer', stepId: 'education', answer: 'Ausbildung.' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Klarheits-Check-in/);
  const invalid = applyGuidedWeekAction(state, { type: 'save_clarity_checkin', score: 11, changed: true });
  assert.equal(invalid.ok, false);
  const saved = applyGuidedWeekAction(state, { type: 'save_clarity_checkin', score: 6, changed: true, note: 'Ich sehe zwei konkrete Richtungen.' });
  assert.equal(saved.ok, true);
  assert.equal(saved.state.clarity_checkin.score, 6);
  assert.equal(saved.state.clarity_checkin.changed, true);
  assert.equal(guidedStepStatuses(saved.state)[0].status, 'completed');
  assert.equal(currentGuidedStep(saved.state).id, 'education');
});
