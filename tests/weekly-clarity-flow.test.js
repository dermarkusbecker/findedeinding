import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertClarityPersisted, clarityFeedback } from '../lib/weekly-clarity.js';
const source = await readFile(new URL('../portal.js', import.meta.url), 'utf8');
const saveSource = source.slice(source.indexOf('let claritySaveInFlight = false;'), source.indexOf('\nasync function openWeek('));

function harness({ score = 5, stale = false, note = '', response = { ok: true }, failReloadOnce = false } = {}) {
  const events = [];
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { value: id === '#clarityDeclineNote' ? note : '', hidden: true, disabled: false, dataset: {}, close: () => events.push('close'), focus: () => events.push('focus-reason') });
    return elements.get(id);
  };
  const context = vm.createContext({
    pendingClarityWeek: 2, selectedClarityScore: score, program: {}, todayMode: 'dashboard',
    $: get, $$: () => [], clarityScoreBeforeWeek: () => 3, assertClarityPersisted, clarityFeedback,
    document: { body: { classList: { remove() {} } } },
    request: async (url, options) => { events.push('save'); context.payload = JSON.parse(options.body); return response; },
    loadProgram: async () => {
      events.push('reload');
      if (failReloadOnce) { failReloadOnce = false; throw new Error('Verbindung unterbrochen'); }
      context.program = { selectedWeek: 2, weekState: { clarity_checkin: { completed: !stale, score: stale ? null : score } }, clarityHistory: stale ? [] : [{ week: 2, score }] };
    },
    showView: () => events.push('week-open'), revealOpenedWeekWithClara: async () => events.push('clara'),
    openClarityImprovement: () => events.push('praise'), toast: (text) => events.push(text),
  });
  vm.runInContext(saveSource, context);
  return { context, events, get, save: () => context.saveWeeklyClarityCheckin() };
}

test('successful save reloads the score before opening the week and praising progress', async () => {
  const h = harness();
  await h.save();
  assert.deepEqual(h.events, ['save', 'reload', 'close', 'week-open', 'clara', 'praise']);
  assert.equal(h.context.todayMode, 'week');
  assert.equal(h.context.pendingClarityWeek, null);
});

test('stale dashboard or missing acknowledgement never closes the check-in or praises', async () => {
  for (const options of [{ stale: true }, { response: {} }]) {
    const h = harness(options);
    await h.save();
    assert.equal(h.events.includes('close'), false);
    assert.equal(h.events.includes('week-open'), false);
    assert.equal(h.events.includes('praise'), false);
    assert.equal(h.get('#clarityCheckinError').hidden, false);
    assert.equal(h.get('#saveClarityCheckin').disabled, false);
  }
});

test('decline asks for a reason, sends it to the server and never celebrates it', async () => {
  const empty = harness({ score: 2 });
  await empty.save();
  assert.deepEqual(empty.events, ['focus-reason']);
  const h = harness({ score: 2, note: 'Neue Zweifel' });
  await h.save();
  assert.equal(h.context.payload.stepAction.note, 'Neue Zweifel');
  assert.equal(h.events.includes('praise'), false);
  assert.equal(h.events.includes('week-open'), true);
});

test('plateau continues quietly; double clicks result in a single save', async () => {
  const h = harness({ score: 3 });
  await Promise.all([h.save(), h.save()]);
  assert.equal(h.events.filter((event) => event === 'save').length, 1);
  assert.equal(h.events.includes('praise'), false);
  assert.ok(h.events.some((event) => event.startsWith('Okay, dann arbeiten wir weiter.')));
});

test('retry after a successful write and failed reload can finish the same week', async () => {
  const h = harness({ failReloadOnce: true });
  await h.save();
  assert.equal(h.context.pendingClarityWeek, 2);
  assert.equal(h.events.includes('close'), false);
  await h.save();
  assert.equal(h.events.filter((event) => event === 'praise').length, 1);
  assert.equal(h.context.pendingClarityWeek, null);
});
