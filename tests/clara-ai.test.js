import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeekOneState, weekOneComplete, WEEK_ONE_STEPS } from '../lib/week-one.js';
import { applyClaraStateSuggestions } from '../lib/clara/state-bridge.js';
import { buildClaraContext } from '../lib/clara/context-builder.js';
import { requestClaraResponse } from '../lib/clara/llm-client.js';
import { validatedExtractions, validatedMemoryUpdates } from '../lib/clara/memory-policy.js';
import { extractDocumentText } from '../lib/documents/cv-extractor.js';

const payload = (overrides = {}) => ({ wishes: null, wish_index: null, wish: null, answer: null, score: null, reason: null, source: null, confirmed: null, complete: null, ...overrides });

test('freier Clara-Chat darf den Week-1-State unverändert lassen', () => {
  const state = createWeekOneState();
  const result = applyClaraStateSuggestions(state, [{ action: 'none', payload: payload() }]);
  assert.equal(result.changed, false);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.ENTRY);
});

test('LLM kann keinen unpassenden Schritt überspringen oder ein Gate öffnen', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const result = applyClaraStateSuggestions(state, [{ action: 'save_target', payload: payload({ answer: 'Nach acht Wochen kenne ich meinen konkreten beruflichen Weg.' }) }]);
  assert.equal(result.changed, false);
  assert.equal(result.rejected[0].reason, 'ACTION_NOT_ALLOWED_FOR_CURRENT_STEP');
  assert.equal(weekOneComplete(result.state, { privacyConsent: true, startCommitment: true }), false);
});

test('Korrektur eines früheren Wunsches öffnet exakt diesen Wunsch erneut', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.TARGET;
  state.wishes.forEach((wish, index) => { wish.raw_wish = `Mein bisheriger Wunsch Nummer ${index + 1} war ausreichend beschrieben.`; wish.completed = true; });
  const originalSnapshot = JSON.parse(JSON.stringify(state));
  const result = applyClaraStateSuggestions(state, [{ action: 'correct_wish', payload: payload({ wish_index: 1, wish: 'Ich wünsche mir mehr kreative Freiheit in meiner täglichen Arbeit.' }) }]);
  assert.equal(result.changed, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_2);
  assert.equal(result.state.wishes[1].completed, false);
  assert.equal(originalSnapshot.wishes[1].raw_wish, 'Mein bisheriger Wunsch Nummer 2 war ausreichend beschrieben.');
});

test('Reload und Resume erhalten den durch Clara validierten State', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.WISHES;
  const wishes = ['Ich möchte wieder mit mehr innerer Ruhe leben.', 'Ich wünsche mir eine sinnvolle und kreative Aufgabe.', 'Ich möchte genügend Zeit für meine Familie haben.'];
  const result = applyClaraStateSuggestions(state, [{ action: 'save_wishes', payload: payload({ wishes }) }]);
  const reloaded = JSON.parse(JSON.stringify(result.state));
  assert.equal(reloaded.current_step, WEEK_ONE_STEPS.WISH_1);
  assert.deepEqual(reloaded.wishes.map((wish) => wish.raw_wish), wishes);
});

test('Context Builder sendet nur begrenzten relevanten Verlauf', () => {
  const state = createWeekOneState();
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'participant', content: `Nachricht ${index}`, created_at: String(index) }));
  const context = buildClaraContext({ participantId: 'p1', participantName: 'Mara Muster', week: 1, state, messages, memories: [], rawEntries: Array.from({ length: 30 }, (_, index) => ({ week: 1, data_block: 'dialog', raw_answer: String(index), created_at: String(index) })) });
  assert.equal(context.recentMessages.length, 8);
  assert.equal(context.rawMemory.length, 12);
});

test('nur belegte Extraktionen und plausible Memory-Updates passieren die Grenze', () => {
  const message = 'Ich möchte künftig selbstbestimmter arbeiten.';
  const extracted = validatedExtractions([{ type: 'preference', topic: 'work', value: 'selbstbestimmt', source_quote: 'selbstbestimmter arbeiten', confidence: .9 }, { type: 'preference', topic: 'work', value: 'reich', source_quote: 'sehr reich', confidence: .9 }], message);
  assert.equal(extracted.length, 1);
  assert.equal(validatedMemoryUpdates([{ operation: 'add', memory_type: 'preference', topic: 'work', value: 'selbstbestimmt', reason: 'Aussage', confidence: .9 }]).length, 1);
  assert.equal(validatedMemoryUpdates([{ operation: 'add', memory_type: 'diagnosis', topic: 'x', value: 'y', reason: '', confidence: .9 }]).length, 0);
});

test('Responses API nutzt SDK, GPT-5.6 Terra, vorherige Response und strenges Schema', async () => {
  let requestBody;
  const structured = { schema_version: '1.1', message: 'Ich höre dir zu.', mode: 'FREE_CHAT', action: 'free_chat', step_status: 'in_progress', structured_data: { wishes: null, active_wish: null, clara_suggestion: null }, intent: { type: 'free_reflection', target: null, confidence: .8 }, extracted_information: [], memory_updates: [], suggested_state_updates: [{ action: 'none', payload: payload() }], next_action: { type: 'stay', step: null }, needs_followup: true };
  const client = { responses: { create: async (body) => { requestBody = body; return { id: 'resp_1', model: 'gpt-5.6-terra', output_text: JSON.stringify(structured), usage: { total_tokens: 42 } }; } } };
  const context = buildClaraContext({ participantId: 'p1', participantName: 'Mara', week: 1, state: createWeekOneState() });
  const result = await requestClaraResponse({ context, message: 'Ich denke gerade nach.', previousResponseId: 'resp_previous', client, env: { OPENAI_API_KEY: 'test' } });
  assert.equal(result.response.message, 'Ich höre dir zu.');
  assert.equal(requestBody.model, 'gpt-5.6-terra');
  assert.equal(requestBody.store, true);
  assert.equal(requestBody.previous_response_id, 'resp_previous');
  assert.equal(requestBody.text.format.strict, true);
});

test('Bild-CV wird für OCR vorgemerkt und nicht als Text-PDF behandelt', async () => {
  const result = await extractDocumentText(Buffer.from('fake-image'), 'image/jpeg');
  assert.equal(result.needsOcr, true);
  assert.equal(result.method, null);
});

test('Dokumentmodul lädt den nativen PDF-Stack nicht beim Portalstart', async () => {
  assert.equal(globalThis.DOMMatrix, undefined);
  await extractDocumentText(Buffer.from('fake-image'), 'image/jpeg');
  assert.equal(globalThis.DOMMatrix, undefined);
});

test('Week-1-End-to-End: freier Chat, Korrektur, Reload und Gate-Sicherheit', async () => {
  let persistedState = createWeekOneState();
  persistedState.current_step = WEEK_ONE_STEPS.TARGET;
  persistedState.wishes.forEach((wish, index) => { wish.raw_wish = `Ich habe meinen Wunsch Nummer ${index + 1} ausführlich und ehrlich beschrieben.`; wish.completed = true; });
  const rawLog = [];

  const freeChat = 'Ich bin gerade unsicher, möchte aber trotzdem dranbleiben.';
  rawLog.push(freeChat);
  let result = applyClaraStateSuggestions(persistedState, [{ action: 'none', payload: payload() }]);
  assert.equal(result.changed, false);

  const correction = 'Mein zweiter Wunsch ist eigentlich mehr kreative Freiheit in meiner täglichen Arbeit.';
  rawLog.push(correction);
  result = applyClaraStateSuggestions(persistedState, [{ action: 'correct_wish', payload: payload({ wish_index: 1, wish: 'Ich wünsche mir mehr kreative Freiheit in meiner täglichen Arbeit.' }) }]);
  persistedState = JSON.parse(JSON.stringify(result.state));
  assert.equal(persistedState.current_step, WEEK_ONE_STEPS.WISH_2);
  assert.equal(rawLog[0], freeChat);
  assert.equal(rawLog[1], correction);

  const maliciousAdvance = applyClaraStateSuggestions(persistedState, [{ action: 'save_target', payload: payload({ answer: 'Ich möchte am Ende eine klare berufliche Richtung kennen.' }) }]);
  assert.equal(maliciousAdvance.changed, false);
  assert.equal(weekOneComplete(maliciousAdvance.state, { privacyConsent: true, startCommitment: true }), false);
  assert.equal(maliciousAdvance.state.wishes[1].completed, false);
});
