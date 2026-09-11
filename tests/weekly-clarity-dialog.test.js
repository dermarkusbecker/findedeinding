import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyWeekOneAction, createWeekOneState, WEEK_ONE_STEPS } from '../lib/week-one.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('jede Woche öffnet vor dem Inhalt den verbindlichen Clara-Klarheitsdialog', async () => {
  const [html, script, styles] = await Promise.all([file('portal.html'), file('portal.js'), file('portal-journey.css')]);

  assert.match(html, /id="clarityCheckinDialog"/);
  assert.equal((html.match(/data-clarity-dialog-score="(?:[1-9]|10)"/g) || []).length, 10);
  assert.match(html, /Klarheitsscore speichern (?:&amp;|&) Woche starten/);
  assert.match(script, /function weekNeedsClarityCheckin/);
  assert.match(script, /if \(weekNeedsClarityCheckin\(currentWeek\)\)[\s\S]*?openClarityCheckin\(currentWeek\)/);
  assert.match(script, /week === 1[\s\S]*?save_clarity[\s\S]*?save_clarity_checkin/);
  assert.match(styles, /\.clarity-checkin-dialog/);
  assert.match(styles, /#clarityCheckinScale button\.selected/);
});

test('Woche 1 speichert die Baseline vor dem Inhalt und fragt sie später nicht doppelt ab', () => {
  const initial = createWeekOneState();
  const withBaseline = applyWeekOneAction(initial, { type: 'save_clarity', score: 4 }).state;
  assert.equal(withBaseline.clarity_baseline.score, 4);
  assert.equal(withBaseline.current_step, WEEK_ONE_STEPS.ENTRY);

  withBaseline.current_step = WEEK_ONE_STEPS.TARGET;
  const afterTarget = applyWeekOneAction(withBaseline, { type: 'save_target', answer: 'Ich möchte zwei konkrete berufliche Richtungen erkennen und mich entscheiden.' }).state;
  assert.equal(afterTarget.current_step, WEEK_ONE_STEPS.CAREER_CHOICE);
});

test('fehlender Wochen-Score sperrt sowohl Formularaktionen als auch Clara serverseitig', async () => {
  const [api, clara] = await Promise.all([file('api/participant-program.js'), file('lib/clara/api-handler.js')]);

  assert.match(api, /CLARITY_CHECKIN_REQUIRED/);
  assert.match(api, /CLARITY_CHECKIN_ALREADY_COMPLETED/);
  assert.match(api, /stepAction\.type !== 'save_clarity'/);
  assert.match(clara, /const clarityCheckinComplete = week === 1/);
  assert.match(clara, /Bitte speichere zuerst deinen Klarheitsscore für diese Woche/);
});

test('eine echte Verbesserung startet die gewählte Woche und öffnet den Glückwunsch-Moment darüber', async () => {
  const [html, script, styles] = await Promise.all([file('portal.html'), file('portal.js'), file('portal-journey.css')]);

  assert.match(html, /id="clarityImprovementDialog"/);
  assert.match(html, /Glückwunsch, deine Klarheit ist gewachsen/);
  assert.match(script, /score > previousScore/);
  assert.match(script, /todayMode = 'week';[\s\S]*?await loadProgram\(week\);[\s\S]*?showView\('today'\);[\s\S]*?await revealOpenedWeekWithClara\(\);[\s\S]*?openClarityImprovement/);
  assert.doesNotMatch(saveWeeklyClaritySource(script), /todayMode = 'dashboard'/);
  assert.match(script, /continueAfterClarityImprovement[\s\S]*?todayMode = 'week';[\s\S]*?showView\('today'\)/);
  assert.match(script, /Klarheitsdiagramm sichtbar/);
  assert.match(styles, /@keyframes clarityScoreCelebrate/);
});

test('Demo-Vollzugriff gilt auch für die Datenbank-Sperre und Speicherfehler bleiben im Dialog sichtbar', async () => {
  const [html, script, api, migration] = await Promise.all([
    file('portal.html'),
    file('portal.js'),
    file('api/participant-program.js'),
    file('supabase/migrations/20260911190000_demo_full_access_week_writes.sql'),
  ]);

  assert.match(migration, /'demo_full_access' = any\(profile\.permissions\)/);
  assert.match(migration, /profile\.status = 'active'/);
  assert.match(migration, /progress\.program_status = 'active'/);
  assert.match(migration, /progress\.program_start_date \+ \(\(target_week - 1\) \* 7\)/);
  assert.match(html, /id="clarityCheckinError"[^>]+role="alert"[^>]+hidden/);
  assert.match(script, /clarityCheckinError[\s\S]*?error\.message/);
  assert.match(api, /releaseBlocked[\s\S]*?laut Datenbank noch nicht freigeschaltet/);
});

function saveWeeklyClaritySource(script) {
  return script.match(/async function saveWeeklyClarityCheckin\(\) \{[\s\S]*?\n\}/)?.[0] || '';
}
