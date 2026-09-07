import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackWeekReflection, generateWeekReflection } from '../lib/week-reflection-agent.js';

test('fallback reflection stays grounded in finalized week data', () => {
  const reflection = fallbackWeekReflection({ week: 1, title: 'Jetzt geht es los', state: { wishes: [{ final_answer: 'Mehr Zeit für meine Familie' }], clarity_baseline: { reason_raw: 'Ich sehe erste Schritte.' } } });
  assert.equal(reflection.week, undefined);
  assert.match(reflection.summary, /Mehr Zeit für meine Familie/);
  assert.equal(reflection.generator, 'grounded_fallback');
  assert.ok(reflection.highlights.length >= 1);
});

test('reflection agent requests a strict structured response without storing model output', async () => {
  let request;
  const client = {
    responses: {
      create: async (input) => {
        request = input;
        return { id: 'resp_1', model: 'test-model', output_text: JSON.stringify({ title: 'Deine Woche', summary: 'Du hast Freiheit als wichtig beschrieben.', highlights: ['Freiheit wurde konkret.'], development: 'Dein Bild wird greifbarer.', nextImpulse: 'Beobachte einen passenden Moment.', closing: 'Deine Aussagen bleiben die Grundlage.' }) };
      },
    },
  };
  const reflection = await generateWeekReflection({ participantId: 'abc', participantName: 'Test', week: 2, title: 'Fähigkeiten & Umfeld', state: { answers: { focus: { answer: 'Freiheit ist mir wichtig.' } } }, client, env: { OPENAI_API_KEY: 'test', CLARA_OPENAI_MODEL: 'test-model' } });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.match(request.input, /Freiheit ist mir wichtig/);
  assert.equal(reflection.generator, 'openai');
  assert.equal(reflection.responseId, 'resp_1');
});

test('reflection generation falls back when the model is unavailable', async () => {
  const client = {
    responses: {
      create: async () => { throw new Error('offline'); },
    },
  };
  const reflection = await generateWeekReflection({ participantId: 'abc', participantName: 'Test', week: 3, title: 'Motivatoren', state: { answer: 'Neugier' }, client, env: {} });
  assert.equal(reflection.generator, 'grounded_fallback');
  assert.match(reflection.summary, /Neugier/);
});
