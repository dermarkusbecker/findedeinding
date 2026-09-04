import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, css] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('landing-reference.css', root), 'utf8'),
]);

test('landing hero uses modern, differentiated status badges without brown fills', () => {
  assert.match(html, /class="hero-float hero-float-step"/);
  assert.match(html, /class="hero-float hero-float-clara"/);
  assert.match(html, /class="hero-float hero-float-pace"/);
  assert.match(html, /class="trust-line"/);

  assert.match(css, /\.trust-line span>b\{[^}]*linear-gradient\(145deg,#174760,#0b2f45\)[^}]*border-radius:8px/);
  assert.match(css, /\.hero-float\{[^}]*linear-gradient\(145deg,rgba\(14,48,68,.96\),rgba\(7,27,42,.94\)\)/);
  assert.match(css, /\.hero-float-step>span\{/);
  assert.match(css, /\.hero-float-clara>span\{[^}]*border-radius:50%/);
  assert.match(css, /\.hero-float-pace>span\{/);
  assert.match(css, /@keyframes heroStatusPulse/);
  assert.match(css, /prefers-reduced-motion:reduce[^}]*\.hero-float>span:after/);

  assert.doesNotMatch(css, /\.trust-line span>b\{[^}]*background:#a96543/);
  assert.doesNotMatch(css, /\.hero-float\{[^}]*background:rgba\(55,38,31,.91\)/);
});
