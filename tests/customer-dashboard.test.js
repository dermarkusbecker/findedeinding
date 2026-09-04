import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../portal.html', import.meta.url);
const scriptUrl = new URL('../portal.js', import.meta.url);
const stylesUrl = new URL('../portal.css', import.meta.url);

test('Kundenlogin landet zuerst auf dem Acht-Wochen-Dashboard', async () => {
  const [html, script] = await Promise.all([readFile(htmlUrl, 'utf8'), readFile(scriptUrl, 'utf8')]);
  assert.match(html, /id="programDashboard"/);
  assert.match(html, /id="dashboardWeekGrid"/);
  assert.match(html, /id="dashboardCurrentTitle"/);
  assert.match(html, /id="dashboardStartDate"/);
  assert.match(html, /id="dashboardEndDate"/);
  assert.match(script, /let todayMode = 'dashboard'/);
  assert.match(script, /showDashboard/);
  assert.match(script, /todayMode = 'week'/);
  assert.match(script, /backToDashboard/);
});

test('Dashboard rendert acht Wochen mit Titel, Status und Freischaltungsdatum', async () => {
  const [script, styles, api] = await Promise.all([
    readFile(scriptUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
  ]);
  assert.match(script, /dashboard-week-tile/);
  assert.match(script, /state\.unlocksAt/);
  assert.match(script, /program\.access\.programEndDate/);
  assert.match(styles, /grid-template-columns:\s*repeat\(8/);
  assert.match(styles, /\.dashboard-week-tile\.current/);
  assert.match(styles, /\.dashboard-week-tile\.completed/);
  assert.match(api, /programWeeks:/);
  assert.match(api, /access_mode: 'time_based'/);
});

test('Wochenschluss kehrt zur Übersicht zurück statt ungefragt die nächste Woche zu öffnen', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /const completedWeek = currentWeek/);
  assert.match(script, /todayMode = 'dashboard'; await loadProgram\(\); showView\('today'\)/);
  assert.doesNotMatch(script, /await loadProgram\(currentWeek < 8 \? currentWeek \+ 1 : 8\)/);
});
