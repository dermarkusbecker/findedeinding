import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalPath = new URL('../portal.html', import.meta.url);

test('Mein Weg enthält nur den zentralen Clara-Journey-Dialog', async () => {
  const html = await readFile(portalPath, 'utf8');
  assert.equal(html.includes('Mit Clara sprechen'), false);
  assert.equal(html.includes('id="claraChat"'), false);
  assert.equal(html.includes('id="claraChatForm"'), false);
  assert.equal((html.match(/id="claraJourney"/g) || []).length, 1);
  assert.equal((html.match(/id="claraJourneyForm"/g) || []).length, 1);
});

test('Spracheingabe wird vom zentralen Journey-Eingabefeld weiterverwendet', async () => {
  const html = await readFile(portalPath, 'utf8');
  assert.match(html, /id="claraJourneyInput"[^>]*>/);
  assert.match(html, /data-target="claraJourneyInput"/);
  assert.match(html, /id="sendJourneyMessage"/);
});
