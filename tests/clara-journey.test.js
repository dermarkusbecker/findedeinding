import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWeekOneAction, createWeekOneState, journeyStepStatuses, weekOnePrompt, WEEK_ONE_STEPS } from '../lib/week-one.js';
import { buildJourneyUiAction, restorePendingJourneyConfirmation, verifyConfirmationToken } from '../lib/clara/journey-actions.js';

process.env.AUTH_SECRET ||= 'clara-journey-test-secret';

const response = (wishes) => ({ action: 'show_confirmation', step_status: 'awaiting_confirmation', structured_data: { wishes, active_wish: null, clara_suggestion: null } });

test('ungültige Modell-Confirmation wird zu ask_followup herabgestuft', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const uiAction = buildJourneyUiAction({ state, response: response(['Mehr.', 'Freiheit.', 'Glücklich sein.']), participantId: 'p1', week: 1 });
  assert.equal(uiAction.type, 'ask_followup');
  assert.equal(uiAction.confirmation, null);
});

test('drei valide Wünsche erzeugen eine signierte, teilnehmergebundene Confirmation', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ich möchte wieder mit mehr innerer Ruhe durch meinen Alltag gehen.', 'Ich wünsche mir eine sinnvolle kreative Aufgabe mit echter Wirkung.', 'Ich möchte genügend freie Zeit für meine Familie und Freunde haben.'];
  const uiAction = buildJourneyUiAction({ state, response: response(wishes), participantId: 'p1', week: 1 });
  const verified = verifyConfirmationToken(uiAction.confirmation.token, { participantId: 'p1', secret: process.env.AUTH_SECRET });
  assert.equal(uiAction.type, 'show_confirmation');
  assert.deepEqual(verified.wishes, wishes);
  assert.equal(verifyConfirmationToken(uiAction.confirmation.token, { participantId: 'p2', secret: process.env.AUTH_SECRET }), null);
});

test('kurze, aber klare Wünsche dürfen bestätigt werden', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ich möchte reich sein.', 'Ich möchte die Welt bereisen.', 'Ich möchte einen Job haben, den ich liebe.'];
  const uiAction = buildJourneyUiAction({ state, response: response(wishes), participantId: 'p1', week: 1 });
  assert.equal(uiAction.type, 'show_confirmation');
  assert.deepEqual(uiAction.confirmation.wishes, wishes);
});

test('Backend korrigiert eine verfrühte complete_step-Antwort zu einer sicheren Bestätigung', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ein neues Auto', 'Mehr Geld', 'Mehr Anerkennung'];
  const modelResponse = { ...response(wishes), action: 'complete_step', step_status: 'completed', needs_followup: false, next_action: { type: 'advance_if_valid', step: null } };
  const uiAction = buildJourneyUiAction({ state, response: modelResponse, participantId: 'p1', week: 1 });
  assert.equal(uiAction.type, 'show_confirmation');
  assert.deepEqual(uiAction.confirmation.wishes, wishes);
});

test('eine bestehende hängende Clara-Antwort erhält beim Laden wieder ihre Freigabe', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ein neues Auto', 'Mehr Geld', 'Mehr Anerkennung'];
  const messages = [{ id: 'm1', role: 'assistant', content: 'Alles geklärt.', structured_response: { ...response(wishes), action: 'complete_step', step_status: 'completed' }, uiAction: { type: 'complete_step' } }];
  const restored = restorePendingJourneyConfirmation({ state, messages, participantId: 'p1', week: 1 });
  assert.equal(restored[0].uiAction.type, 'show_confirmation');
  assert.ok(restored[0].uiAction.confirmation.token);
});

test('eine neuere Rückfrage reaktiviert keine überholte Bestätigung', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ein neues Auto', 'Mehr Geld', 'Mehr Anerkennung'];
  const messages = [
    { id: 'm1', role: 'assistant', content: 'Bitte bestätigen.', structured_response: response(wishes) },
    { id: 'm2', role: 'participant', content: 'Ich möchte noch etwas ändern.' },
    { id: 'm3', role: 'assistant', content: 'Was möchtest du ändern?', structured_response: { ...response(null), action: 'ask_followup', step_status: 'needs_clarification' } },
  ];
  const restored = restorePendingJourneyConfirmation({ state, messages, participantId: 'p1', week: 1 });
  assert.equal(restored[0].uiAction, undefined);
  assert.equal(restored[2].uiAction, undefined);
});

test('erst die explizite Confirmation schreibt in den Week-1-Reducer', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ich möchte wieder mit mehr innerer Ruhe durch meinen Alltag gehen.', 'Ich wünsche mir eine sinnvolle kreative Aufgabe mit echter Wirkung.', 'Ich möchte genügend freie Zeit für meine Familie und Freunde haben.'];
  const unchanged = structuredClone(state);
  buildJourneyUiAction({ state, response: response(wishes), participantId: 'p1', week: 1 });
  assert.deepEqual(state, unchanged);
  const confirmed = applyWeekOneAction(state, { type: 'confirm_wishes', wishes });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.state.current_step, WEEK_ONE_STEPS.WISH_1);
  assert.deepEqual(confirmed.state.wishes.map((wish) => wish.final_answer), wishes);
  assert.equal(journeyStepStatuses(confirmed.state).find((step) => step.id === 'wishes_collected').status, 'completed');
  assert.match(weekOnePrompt(confirmed.state).question, /Was würde sich in deinem Leben konkret verändern/);
});
