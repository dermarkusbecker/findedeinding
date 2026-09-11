import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Landingpage startet mit einem gebrandeten und zugänglichen Ladebildschirm', async () => {
  const html = await file('index.html');

  assert.match(html, /<body class="site-loading">/);
  assert.match(html, /id="siteLoader"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /site-loader-logo[\s\S]*?assets\/fdd-logo\.svg/);
  assert.match(html, /setTimeout\(\(\)=>\{[\s\S]*?classList\.add\('is-slow'\)[\s\S]*?\},300\)/);
  assert.match(html, /__fddLoaderFailSafe/);
});

test('Loader wartet auf die Seite, schließt weich und gibt die Bedienung sicher frei', async () => {
  const script = await file('landing.js');

  assert.match(script, /window\.addEventListener\('load', finishSiteLoader, \{ once: true \}\)/);
  assert.match(script, /Math\.max\(0, 300 - elapsed\)/);
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

test('Instagram-Profil ist mit einem kleinen Vektorlogo in Navigation und Footer verlinkt', async () => {
  const html = await file('index.html');
  const links = html.match(/href="https:\/\/www\.instagram\.com\/der\.markusbecker\/"/g) || [];

  assert.equal(links.length, 2);
  assert.match(html, /class="instagram-link"[\s\S]*?<svg viewBox="0 0 24 24"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Markus Becker auf Instagram öffnen"/);
});
