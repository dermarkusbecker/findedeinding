import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Gesprächsformular erscheint ausschließlich in einem zentralen Dialog', async () => {
  const [html, script, styles] = await Promise.all([file('index.html'), file('landing.js'), file('landing.css')]);
  assert.doesNotMatch(html, /<section class="lead-section"/);
  assert.match(html, /<dialog class="lead-dialog" id="leadDialog"/);
  assert.match(html, /id="leadForm"/);
  assert.match(html, /data-open-lead-dialog/);
  assert.match(html, /data-close-lead-dialog/);
  assert.match(script, /leadDialog\.showModal\(\)/);
  assert.match(script, /event\.target === leadDialog/);
  assert.match(styles, /\.lead-dialog::backdrop/);
  assert.match(styles, /\.lead-dialog-shell\{[^}]*grid-template-columns:/s);
});

test('alle zentralen Landingpage-CTAs öffnen das Gesprächsfenster', async () => {
  const html = await file('index.html');
  const triggers = html.match(/data-open-lead-dialog/g) || [];
  assert.ok(triggers.length >= 4);
  assert.match(html, /Gespräch starten/);
  assert.match(html, /Klarheitsgespräch anfragen/);
});
