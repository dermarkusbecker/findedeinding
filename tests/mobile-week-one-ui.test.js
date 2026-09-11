import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalUrl = new URL('../portal.html', import.meta.url);
const stylesUrl = new URL('../portal.css', import.meta.url);
const scriptUrl = new URL('../portal.js', import.meta.url);

test('mobile Begrüßung steht im Markup vor Wochen-Hero und Schritten', async () => {
  const html = await readFile(portalUrl, 'utf8');
  const greeting = html.indexOf('id="mobileWeekGreeting"');
  const hero = html.indexOf('class="welcome"');
  const steps = html.indexOf('class="task-card"');
  assert.ok(greeting >= 0 && greeting < hero && hero < steps);
});

test('Lebenslauf-Upload nutzt genau eine eigene, zugängliche Dateiauswahl', async () => {
  const [html, css] = await Promise.all([readFile(portalUrl, 'utf8'), readFile(stylesUrl, 'utf8')]);
  assert.equal((html.match(/id="fileInput"/g) || []).length, 1);
  assert.match(html, /for="fileInput"/);
  assert.match(html, /class="file-input-hidden"[^>]*type="file"/);
  assert.match(css, /\.file-input-hidden\s*\{/);
  assert.match(css, /\.custom-file-upload:focus-within/);
});

test('Clara steht auf Mobile vor der Diese-Woche-Card', async () => {
  const css = await readFile(stylesUrl, 'utf8');
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.active-week \.clara-card\s*\{\s*order:\s*1;/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.active-week \.task-card\s*\{\s*order:\s*2;/);
});

test('Mobile zeigt den Prozessstand beim Eintritt in Mein Bereich als schließbares Fenster', async () => {
  const [html, css, script] = await Promise.all([
    readFile(portalUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
    readFile(scriptUrl, 'utf8'),
  ]);
  assert.match(html, /<dialog id="mobileProcessDialog"[^>]*aria-labelledby="mobileProcessPhase"/);
  assert.match(html, /id="closeMobileProcess"[^>]*aria-label="Prozessübersicht schließen"/);
  assert.match(html, /id="mobileProcessProgress"/);
  assert.match(html, /id="mobileProcessClarity"/);
  assert.match(css, /\.mobile-process-dialog::backdrop/);
  assert.match(css, /\.mobile-process-close \{/);
  assert.match(script, /showView\(initialView, \{ openMobileProcess: initialView === 'today' \}\)/);
  assert.match(script, /showView\(button\.dataset\.view, \{ openMobileProcess: button\.dataset\.view === 'today' \}\)/);
  assert.match(script, /function openMobileProcessDialog\(\)[\s\S]*?mobilePortalViewport\(\)[\s\S]*?dialog\.showModal\(\)/);
  assert.match(script, /#mobileProcessProgress[\s\S]*?#mobileProcessPercent[\s\S]*?#mobileProcessPhase[\s\S]*?#mobileProcessClarity/);
});
