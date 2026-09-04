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

test('Wochenkarten verwenden die scharfe Landingpage-Typografie und einen gut lesbaren Kartenaufbau', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /-webkit-font-smoothing:\s*antialiased/);
  assert.match(styles, /\.dashboard-week-tile\s*\{[\s\S]*?min-height:\s*208px/);
  assert.match(styles, /\.dashboard-week-tile small\s*\{[\s\S]*?font-family:\s*Manrope/);
  assert.match(styles, /\.dashboard-week-tile b\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(styles, /\.dashboard-week-tile\.current\s*\{[\s\S]*?var\(--navy-2\)/);
  assert.doesNotMatch(styles, /\.dashboard-week-tile\.locked\s*\{[^}]*opacity:/);
});

test('auch gesperrte Wochen zeigen Inhalt und öffnen eine zentrale Detailvorschau', async () => {
  const [html, script, styles, api] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="weekPreviewDialog"/);
  assert.match(html, /id="weekPreviewTopics"/);
  assert.match(script, /function openWeekPreview/);
  assert.match(script, /data-preview-week/);
  assert.doesNotMatch(script, /summary \? summary\.title : 'Noch gesperrt'/);
  assert.match(styles, /\.week-preview-dialog::backdrop/);
  assert.match(styles, /\.week-preview-shell/);
  assert.match(api, /description:/);
  assert.match(api, /topics:/);
  for (let week = 1; week <= 8; week += 1) assert.match(api, new RegExp(`week: ${week}, title:`));
});

test('Freischaltungs-Auswahl ist entfernt und der Server akzeptiert keine Overrides mehr', async () => {
  const [adminHtml, adminScript, controlApi, participantApi, access, migration] = await Promise.all([
    readFile(new URL('../admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/program-control.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/program-access.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260904210000_enforce_timed_program_access.sql', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(adminHtml, /name="accessMode"|id="unlockAllWeeks"|id="weekOverrides"/);
  assert.doesNotMatch(adminScript, /data-week-override|manuallyUnlockedWeeks/);
  assert.match(controlApi, /fest zeitbasiert/);
  assert.match(access, /const accessMode = ACCESS_MODES\.TIME/);
  assert.doesNotMatch(participantApi, /protectedAccess|week_1_incomplete/);
  assert.match(migration, /check \(access_mode = 'time_based'\)/);
  assert.match(migration, /manually_unlocked_weeks = '\{\}'::integer\[\]/);
});

test('Wochenschluss kehrt zur Übersicht zurück statt ungefragt die nächste Woche zu öffnen', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /const completedWeek = currentWeek/);
  assert.match(script, /todayMode = 'dashboard'; await loadProgram\(\); showView\('today'\)/);
  assert.doesNotMatch(script, /await loadProgram\(currentWeek < 8 \? currentWeek \+ 1 : 8\)/);
});
