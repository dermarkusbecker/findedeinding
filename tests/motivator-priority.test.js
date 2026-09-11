import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Woche 3 besitzt ein großes Auswahlfeld und eine rechts angeordnete Top-5-Priorisierung', async () => {
  const [portal, styles, api] = await Promise.all([
    file('portal.js'),
    file('portal.css'),
    file('api/participant-program.js'),
  ]);
  assert.match(portal, /function renderMotivatorPrioritySelection/);
  assert.match(portal, /motivator-choice-grid/);
  assert.match(portal, /motivator-ranking-panel/);
  assert.match(portal, /data-rank-up/);
  assert.match(portal, /data-rank-down/);
  assert.match(portal, /draggable="true"/);
  assert.match(portal, /selected\.length < minimum \|\| selected\.length > limit/);
  assert.match(portal, /queueDraftValue\(draftKey, JSON\.stringify\(selected\)\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1\.45fr\) minmax\(280px, 0\.75fr\)/);
  assert.match(styles, /\.motivator-choice-grid/);
  assert.match(styles, /#motivatorRanking/);
  assert.match(api, /programInsights = \{ motivators:/);
});
