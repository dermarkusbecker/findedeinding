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

test('eine echte Verbesserung aktualisiert das Dashboard und öffnet den Glückwunsch-Moment', async () => {
  const [html, script, styles] = await Promise.all([file('portal.html'), file('portal.js'), file('portal-journey.css')]);

  assert.match(html, /id="clarityImprovementDialog"/);
  assert.match(html, /Glückwunsch, deine Klarheit ist gewachsen/);
  assert.match(script, /score > previousScore/);
  assert.match(script, /todayMode = 'dashboard';[\s\S]*?showView\('today'\);[\s\S]*?openClarityImprovement/);
  assert.match(script, /Klarheitsdiagramm sichtbar/);
  assert.match(styles, /@keyframes clarityScoreCelebrate/);
});
