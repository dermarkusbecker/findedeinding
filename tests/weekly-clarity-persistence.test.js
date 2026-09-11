import test from 'node:test';
import assert from 'node:assert/strict';
import { clarityFeedback, assertClarityPersisted, persistWeeklyClarity } from '../lib/weekly-clarity.js';

test('feedback distinguishes honest baseline, growth, plateau and decline in every week', () => {
  assert.equal(clarityFeedback(1, null, 3).kind, 'baseline');
  const titles = new Set();
  for (let week = 2; week <= 8; week++) {
    const feedback = clarityFeedback(week, 3, 5);
    assert.equal(feedback.kind, 'improvement');
    assert.equal(feedback.delta, 2);
    titles.add(feedback.title);
    assert.equal(clarityFeedback(week, 5, 5).kind, 'steady');
    assert.equal(clarityFeedback(week, 5, 4).kind, 'decline');
  }
  assert.equal(titles.size, 7);
});

test('week opening requires a matching persisted check-in and chart history', () => {
  const program = { selectedWeek: 2, weekState: { clarity_checkin: { score: 5, completed: true } }, clarityHistory: [{ week: 1, score: 3 }, { week: 2, score: 5 }] };
  assert.doesNotThrow(() => assertClarityPersisted(program, 2, 5));
  for (const broken of [ {}, { ...program, selectedWeek: 1 }, { ...program, clarityHistory: [] }, { ...program, weekState: { clarity_checkin: { score: 5, completed: false } } } ]) {
    assert.throws(() => assertClarityPersisted(broken, 2, 5), /nicht bestätigt/);
  }
  assert.throws(() => assertClarityPersisted(program, 2, 6));
  assert.doesNotThrow(() => assertClarityPersisted({ selectedWeek: 1, weekOne: { clarity_baseline: { score: 3, completed: true } }, clarityHistory: [{ week: 1, score: 3 }] }, 1, 3));
});

test('persistence requires a valid RPC response and reports missing migration', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ state: { clarity_checkin: { score: 4, completed: true } } }) };
  });
  const service = { url: 'https://example.invalid', key: 'test-only' };
  const result = await persistWeeklyClarity(service, 'participant', 2, 4, ' Neue Fragen ', {});
  assert.equal(request.p_note, 'Neue Fragen');
  assert.equal(result.state.clarity_checkin.score, 4);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(persistWeeklyClarity(service, 'participant', 2, 4, '', {}), /nicht verbindlich/);
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ code: 'PGRST202' }) });
  await assert.rejects(persistWeeklyClarity(service, 'participant', 2, 4, '', {}), /noch nicht eingerichtet/);
});
