import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Landingpage startet mit einem gebrandeten und zugänglichen Ladebildschirm', async () => {
  const html = await file('index.html');

  assert.match(html, /<body class="site-loading">/);
  assert.match(html, /id="siteLoader"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /site-loader-logo[\s\S]*?assets\/fdd-logo\.svg/);
  assert.match(html, /setTimeout\(\(\)=>\{[\s\S]*?classList\.add\('is-slow'\)[\s\S]*?\},4500\)/);
  assert.match(html, /__fddLoaderFailSafe/);
});

test('Loader wartet auf die Seite, schließt weich und gibt die Bedienung sicher frei', async () => {
  const script = await file('landing.js');

  assert.match(script, /window\.addEventListener\('load', finishSiteLoader, \{ once: true \}\)/);
  assert.match(script, /Math\.max\(0, 3000 - elapsed\)/);
  assert.match(script, /siteLoader\.classList\.add\('is-finishing'\)/);
  assert.match(script, /document\.body\.classList\.remove\('site-loading'\)/);
  assert.match(script, /siteLoader\.remove\(\)/);
});

test('Loader ist animiert, responsiv und respektiert reduzierte Bewegung', async () => {
  const css = await file('landing-reference.css');

  assert.match(css, /\.site-loader\{[^}]*position:fixed[^}]*z-index:10000/);
  assert.match(css, /@keyframes fdd-loader-travel/);
  assert.match(css, /@keyframes fdd-loader-complete/);
  assert.match(css, /@media\(max-width:560px\)[^{]*\{[^}]*\.site-loader-logo/s);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{[^}]*\.site-loader-orbit i/s);
});

test('Landingpage enthält kein Instagram-Logo und keinen Instagram-Link', async () => {
  const [html, css] = await Promise.all([file('index.html'), file('landing-reference.css')]);
  assert.doesNotMatch(html, /instagram\.com|instagram-link|footer-instagram/i);
  assert.doesNotMatch(css, /instagram-link|footer-instagram/i);
});
