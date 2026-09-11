import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Hero-Vorteile erscheinen als einheitliches Premium-Deck mit drei klaren Karten', async () => {
  const [html, css] = await Promise.all([read('index.html'), read('landing-reference.css')]);
  assert.match(html, /class="trust-track"/);
  assert.equal((html.match(/class="trust-card"/g) || []).length, 3);
  assert.match(css, /Premium benefit deck/);
  assert.match(css, /\.hero \.trust-line\{[^}]*border-radius:24px[^}]*overflow:hidden/s);
  assert.match(css, /\.hero \.trust-card\{[^}]*radial-gradient\(circle at var\(--trust-x\) var\(--trust-y\)/s);
});

test('Vorteilsleiste reagiert auf Mausbewegung und bleibt mobil ohne horizontales Scrollen nutzbar', async () => {
  const [script, css] = await Promise.all([read('landing.js'), read('landing-reference.css')]);
  assert.match(script, /querySelectorAll\('\.trust-card'\)/);
  assert.match(script, /addEventListener\('pointermove'/);
  assert.match(script, /--trust-x/);
  assert.match(css, /@media\(max-width:820px\)[\s\S]*?\.hero \.trust-track\{grid-template-columns:1fr 1fr\}/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*?\.hero \.trust-track\{gap:8px;grid-template-columns:1fr\}/);
});

test('Animationen respektieren reduzierte Bewegung', async () => {
  const css = await read('landing-reference.css');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{[^}]*\.hero \.trust-line::after[^}]*animation:none!important/s);
});
