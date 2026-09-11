import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, css, script] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('landing-reference.css', root), 'utf8'),
  readFile(new URL('landing.js', root), 'utf8'),
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

test('landing page introduces Clara as a personal guide with a live chat and detailed explanation', () => {
  assert.match(html, /id="clara"/);
  assert.match(html, /assets\/clara-progress-guide-v1\.png/);
  assert.match(html, /class="typing" role="status" aria-label="Clara schreibt gerade"/);
  assert.match(html, /Sie erinnert sich\./);
  assert.match(html, /Sie erkennt Zusammenhänge\./);
  assert.match(html, /Sie bringt dich ins Handeln\./);
  assert.match(html, /Clara entscheidet nie für dich\./);
  assert.match(html, /data-open-clara-details>Mehr zu Clara/);
  assert.match(html, /<dialog class="clara-details-dialog" id="claraDetailsDialog"/);
  assert.match(html, /Was Clara nicht ist:/);
  assert.match(html, /data-clara="decision"/);
  assert.match(script, /decision: \['Welche kleine Handlung/);
  assert.match(script, /claraDetailsDialog\.showModal\(\)/);
  assert.match(script, /event\.target === claraDetailsDialog/);
  assert.match(css, /\.clara-portrait-stage\{/);
  assert.match(css, /\.clara-details-grid\{/);
  assert.match(css, /\.clara-live-card \.typing i\{/);
  assert.match(css, /@keyframes landingClaraFloat/);
});

test('landing navigation is crisp and orange calls to action glow accessibly', () => {
  assert.match(css, /\.site-header nav\{[^}]*font-size:13px[^}]*font-weight:750[^}]*text-rendering:geometricPrecision/s);
  assert.match(css, /\.nav-cta,\.button-orange\{[^}]*animation:fddCtaAura[^}]*font-size:13px/s);
  assert.match(css, /@keyframes fddCtaAura/);
  assert.match(css, /@keyframes fddCtaSheen/);
  assert.match(css, /@keyframes fddCtaArrow/);
  assert.match(css, /\.nav-cta:focus-visible,\.button-orange:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce[^}]*\.nav-cta,\.button-orange/s);
});

test('program signals below the hero remain large and high-contrast', () => {
  assert.match(html, /class="signal-strip[\s\S]*?<b>8 Wochen<\/b>[\s\S]*?<b>Dein Plan<\/b>/);
  assert.match(css, /\.signal-strip>div\{[^}]*min-height:116px[^}]*padding:0 clamp\(22px,2\.2vw,34px\)/s);
  assert.match(css, /\.signal-strip span\{[^}]*color:#b8c7d3[^}]*font-size:13px/s);
  assert.match(css, /\.signal-strip b\{[^}]*color:#fff[^}]*font-size:16px[^}]*font-weight:800/s);
});

test('Landingpage verwendet durchgängig die dunkle Clara-Farbwelt des Kundenportals', () => {
  assert.match(html, /<meta name="theme-color" content="#071b2a">/);
  assert.match(css, /Clara Night: dieselbe Farbwelt wie im Kundenportal/);
  assert.match(css, /body \{[\s\S]*?background: #071b2a;[\s\S]*?color: #eef7fb;/);
  assert.match(css, /\.site-header \{[\s\S]*?rgba\(10, 36, 53, \.9\)[\s\S]*?rgba\(13, 48, 67, \.88\)/);
  assert.match(css, /\.hero::before \{[\s\S]*?linear-gradient\(135deg, #071b2a 0%, #0a2b3f 54%, #061724 100%\)/);
  assert.match(css, /\.hero h1 \{ color: #f6fbfd;/);
  assert.match(css, /\.trust-line span \{[\s\S]*?rgba\(18, 54, 73, \.88\)[\s\S]*?color: #e8f4f8;/);
  assert.match(css, /@media \(max-width: 820px\) \{[\s\S]*?\.site-header nav \{[\s\S]*?rgba\(8, 31, 47, \.99\)/);
});
