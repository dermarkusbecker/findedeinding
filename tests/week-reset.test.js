import test from 'node:test';
import assert from 'node:assert/strict';
import { weekResetScope } from '../lib/week-reset.js';

test('Neustart setzt den Prozess auf den Anfang der ausgewählten Woche', () => {
  assert.deepEqual(weekResetScope(3), { week: 3, processStatus: 'WEEK_3', clarityPhases: [] });
});

test('Neustart entfernt die zur Woche gehörende Klarheitsmessung', () => {
  assert.deepEqual(weekResetScope(1).clarityPhases, ['start']);
  assert.deepEqual(weekResetScope(4).clarityPhases, ['midpoint']);
  assert.deepEqual(weekResetScope(8).clarityPhases, ['end']);
});

test('ungültige Wochen können nicht destruktiv zurückgesetzt werden', () => {
  assert.throws(() => weekResetScope(0), /Ungültige Woche/);
  assert.throws(() => weekResetScope(9), /Ungültige Woche/);
});
