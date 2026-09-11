import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../portal.html', import.meta.url);
const scriptUrl = new URL('../portal.js', import.meta.url);
const stylesUrl = new URL('../portal-journey.css', import.meta.url);

test('jede geöffnete Woche beginnt sichtbar mit Claras Tippindikator', async () => {
  const [html, script] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
  ]);

  assert.match(html, /id="claraEntryTyping"[^>]*aria-label="Clara schreibt"/);
  assert.match(html, /id="claraEntryTyping"[\s\S]*?<i><\/i><i><\/i><i><\/i>/);
  assert.match(script, /const CLARA_TYPING_MINIMUM_MS = 850/);
  assert.match(script, /async function openWeek\(week\)[\s\S]*?weekNeedsClarityCheckin\(currentWeek\)[\s\S]*?openClarityCheckin\(currentWeek\)[\s\S]*?revealOpenedWeekWithClara\(\)/);
  assert.match(script, /async function revealOpenedWeekWithClara\(\)[\s\S]*?beginClaraTurn\(\)[\s\S]*?waitForClaraTyping\(\)[\s\S]*?finishClaraTurn\(\)/);
});

test('Claras Antworten ersetzen die drei Punkte erst nach einer wahrnehmbaren Tippzeit', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /journeyLoading \|\| claraEntranceLoading/);
  assert.match(script, /aria-label="Clara schreibt"/);
  assert.match(script, /await waitForClaraTyping\(typingStartedAt\);[\s\S]*?journeyMessages\.push\(result\.message\)/);
  assert.match(script, /updateWeekOne[\s\S]*?beginClaraTurn\(\)[\s\S]*?finishClaraTurn\(\)/);
  assert.match(script, /updateGuidedWeek[\s\S]*?beginClaraTurn\(\)[\s\S]*?finishClaraTurn\(\)/);
  assert.match(script, /const weekOneUsesStructuredInput = currentWeek === 1/);
  assert.match(script, /showOnlyCurrentPrompt = clarityCheckinPending \|\| usesStructuredPanel \|\| weekOneUsesStructuredInput/);
  assert.match(script, /claraJourneyForm'\)\.hidden = Boolean\(readOnly \|\| clarityCheckinPending \|\| usesStructuredPanel \|\| weekOneUsesStructuredInput\)/);
});

test('Nächster Schritt bleibt bis zum validierten Clara-Übergang gesperrt und läuft danach automatisch', async () => {
  const [html, script, css] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(html, /id="claraNextStep"[^>]*disabled>Nächster Schritt →/);
  assert.match(script, /const stepReady = Boolean\(\(transitionReady \|\| pendingConfirmation\)/);
  assert.match(script, /claraStepTransitionTimer = setTimeout\(\(\) => revealNextClaraStep\(\), 1600\)/);
  assert.match(script, /claraNextStep'\)\?\.addEventListener\('click', \(event\) =>/);
  assert.match(script, /if \(token\) confirmClaraResult\(token, event\.currentTarget\)/);
  assert.match(css, /#activeWeek #claraNextStep:disabled/);
});

test('Kundenportal und Wochenchat verwenden die dunkle Clara-Bühne mit Portrait und Animation', async () => {
  const [html, css] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(html, /class="clara-presence"[\s\S]*?clara-progress-guide-v1\.png/);
  assert.match(css, /Clara Portal 2026/);
  assert.match(css, /#activeWeek \.clara-card[\s\S]*?linear-gradient\(145deg, #103a52, #082638/);
  assert.match(css, /@keyframes claraTypingPulse/);
  assert.match(css, /@keyframes claraMessageArrival/);
  assert.match(css, /\.clara-entry-typing p i,[\s\S]*?width: 8px/);
  assert.match(css, /#activeWeek \.clara-journey \{ order: 3; \}[\s\S]*?#activeWeek #weekOneFlow,[\s\S]*?order: 4/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
