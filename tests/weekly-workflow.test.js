import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const portal = fs.readFileSync(new URL('../portal.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/participant-program.js', import.meta.url), 'utf8');
const adminApi = fs.readFileSync(new URL('../api/program-control.js', import.meta.url), 'utf8');

test('dashboard opens the canonical process week', () => {
  assert.match(portal, /openWeek\(activeProcessWeek\(program\?\.access\)\)/);
  assert.match(portal, /currentWeek = safeSelectedWeek\(program\)/);
  assert.match(portal, /sidePhase.*canonicalWeek.*canonicalSummary/s);
  assert.doesNotMatch(portal, /program\?\.access\?\.currentWeek/);
});

test('running-week drafts are autosaved and finalized weeks remain read-only', () => {
  assert.match(portal, /action: 'save_week_draft'/);
  assert.match(api, /ensureRunningWeek\(result, week\)/);
  assert.match(api, /Woche \$\{week\} ist abgeschlossen und schreibgeschützt/);
  assert.match(html, /Dein Arbeitsstand wird automatisch gespeichert/);
});

test('reset and final completion use designed confirmation dialogs', () => {
  assert.doesNotMatch(portal, /Bist du sicher, dass du Woche.*window\.confirm/);
  assert.match(portal, /openWeekActionDialog\('reset'\)/);
  assert.match(portal, /openWeekActionDialog\('complete'\)/);
  assert.match(html, /Woche abschließend beenden/);
});

test('final completion creates and publishes a weekly reflection', () => {
  assert.match(api, /generateWeekReflection/);
  assert.match(api, /backfillCompletedWeekReflections/);
  assert.match(api, /Wochenreflexion nachgetragen/);
  assert.match(adminApi, /backfillCompletedWeekReflections/);
  assert.match(adminApi, /if \(await backfillCompletedWeekReflections\(result, participantId\)\) result = await getParticipantProgramAccess\(participantId\)/);
  assert.match(api, /week_reflection/);
  assert.match(api, /weekReflections/);
  assert.match(html, /Deine (acht )?Wochenreflexionen/);
});

test('Erkenntnisse zeigt eine dauerhaft gespeicherte Reflexionsbibliothek für alle acht Wochen', () => {
  const insights = html.match(/<section class="screen" data-panel="insights">[\s\S]*?<section class="evidence">/)?.[0] || '';
  const journey = html.match(/<section class="screen" data-panel="journey">[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(insights, /id="weekReflectionList"/);
  assert.match(insights, /id="weekReflectionCount"/);
  assert.doesNotMatch(journey, /id="weekReflectionList"/);
  assert.match(portal, /Array\.from\(\{ length: 8 \}/);
  assert.match(portal, /reflectionByWeek/);
  assert.match(portal, /data-reflection-week/);
});
