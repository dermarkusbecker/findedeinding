import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProgressCelebration } from '../lib/progress-celebration.js';

const file = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Fortschrittslob priorisiert den echten Klarheitszuwachs', () => {
  const result = buildProgressCelebration({
    activeWeek: 4,
    completedWeeks: [1, 2, 3],
    clarityHistory: [{ week: 1, score: 3 }, { week: 2, score: 4 }, { week: 3, score: 6 }],
    completedSteps: 1,
    totalSteps: 5,
    currentWeekTitle: 'Halbzeit',
    onboardingComplete: true,
  });
  assert.equal(result.percent, 38);
  assert.match(result.praise, /bei 3 gestartet.*jetzt bei 6.*Plus von 3 Punkten/);
  assert.match(result.claraCopy, /Halbzeit/);
  assert.equal(result.ctaLabel, 'In Woche 4 weitermachen →');
});

test('Fortschrittslob nennt tatsächlich erledigte Schritte der laufenden Woche', () => {
  const result = buildProgressCelebration({ activeWeek: 3, completedSteps: 2, totalSteps: 6, currentWeekTitle: 'Motivatoren', onboardingComplete: true });
  assert.match(result.praise, /2 von 6 Schritten/);
  assert.match(result.claraTitle, /Dranbleiben/);
});

test('abgeschlossener Prozess erhält einen eigenen Abschlussmoment', () => {
  const result = buildProgressCelebration({ activeWeek: 8, completedWeeks: [1, 2, 3, 4, 5, 6, 7, 8], clarityHistory: [{ week: 1, score: 3 }, { week: 8, score: 8 }] });
  assert.equal(result.isComplete, true);
  assert.equal(result.percent, 100);
  assert.match(result.title, /Geschafft/);
  assert.equal(result.ctaLabel, 'Meine Entwicklung ansehen →');
});

test('Prozesskarte öffnet ein zugängliches, schließbares Clara-Fortschrittsfenster', async () => {
  const [html, script, styles] = await Promise.all([file('portal.html'), file('portal.js'), file('portal.css')]);
  assert.match(html, /id="openProgressCelebration"[^>]+role="button"[^>]+aria-haspopup="dialog"/);
  assert.match(html, /id="progressCelebrationDialog"[^>]+aria-labelledby="progressCelebrationTitle"/);
  assert.match(html, /id="closeProgressCelebration"[^>]+aria-label="Fortschrittsfenster schließen"/);
  assert.match(html, /assets\/clara-progress-guide-v1\.png/);
  assert.match(script, /function renderProgressCelebration/);
  assert.match(script, /progressCelebrationDialog.*showModal/s);
  assert.match(script, /event\.key === 'Enter'.*event\.key === ' '/s);
  assert.match(styles, /\.progress-celebration-dialog::backdrop/);
  assert.match(styles, /@keyframes claraFloat/);
  assert.match(styles, /prefers-reduced-motion/);
});
