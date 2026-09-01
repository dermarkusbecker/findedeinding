import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Admin-Programmsteuerung zeigt den auditierbaren technischen Bestätigungsprozess', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../admin.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="technicalConfirmationList"/);
  assert.match(script, /technicalConfirmation/);
  assert.match(script, /Prüfvermerk/);
  assert.match(script, /data-confirm-technical/);
});
