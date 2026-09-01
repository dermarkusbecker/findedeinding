import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalUrl = new URL('../portal.html', import.meta.url);
const stylesUrl = new URL('../portal.css', import.meta.url);

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
