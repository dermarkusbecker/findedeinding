import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Impressum ist von der öffentlichen Website eindeutig und direkt verlinkt', async () => {
  const [landing, config] = await Promise.all([file('index.html'), file('vercel.json')]);
  assert.match(landing, /href="\/impressum">Impressum<\/a>/);
  assert.match(config, /"source": "\/impressum", "destination": "\/impressum\.html"/);
});

test('Impressum enthält die bereitgestellten Pflichtangaben nach DDG und MStV', async () => {
  const html = await file('impressum.html');
  assert.match(html, /Angaben gemäß § 5 DDG/);
  assert.match(html, /Markus Becker[\s\S]*?Einzelunternehmer[\s\S]*?Amorbacher Str\. 39[\s\S]*?74177 Bad Friedrichshall/);
  assert.match(html, /mailto:markus@dermarkusbecker\.de/);
  assert.match(html, /https:\/\/www\.dermarkusbecker\.de/);
  assert.match(html, /DE311109135/);
  assert.match(html, /§ 18 Abs\. 2 MStV/);
  assert.match(html, /nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen/);
});

test('Impressum enthält keinen überholten Link zur eingestellten EU-OS-Plattform', async () => {
  const html = await file('impressum.html');
  assert.doesNotMatch(html, /ec\.europa\.eu\/consumers\/odr|Online-Streitbeilegungsplattform|OS-Plattform/i);
});

test('Impressum ist responsiv und im FDD-Design umgesetzt', async () => {
  const [html, css] = await Promise.all([file('impressum.html'), file('legal.css')]);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /class="legal-main page-shell"/);
  assert.match(css, /\.legal-layout\{[^}]*grid-template-columns:1fr 1fr/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.legal-page\{[^}]*#061923/);
});

test('Cookie-Einstellungen bleiben auch vom Impressum erreichbar', async () => {
  const [html, script] = await Promise.all([file('impressum.html'), file('landing.js')]);
  assert.match(html, /href="\/\?cookie-settings=1">Cookie-Einstellungen<\/a>/);
  assert.match(script, /searchParams\.get\('cookie-settings'\) === '1'/);
  assert.match(script, /history\.replaceState/);
});
