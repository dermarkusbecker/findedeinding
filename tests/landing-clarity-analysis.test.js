import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Landingpage stellt die wöchentliche Klarheitsentwicklung professionell und transparent vor', async () => {
  const html = await file('index.html');

  assert.match(html, /id="klarheitsentwicklung"/);
  assert.match(html, /BEISPIEL AUS DEM KUNDENPORTAL/);
  assert.match(html, /ZIELBEREICH 7–10/);
  assert.equal((html.match(/data-clarity-week="[1-8]"/g) || []).length, 8);
  assert.match(html, /Kein Test\. Keine Diagnose/);
  assert.match(html, /id="clarityDetailsDialog"[^>]+aria-labelledby="clarityDetailsTitle"/);
  assert.match(html, /Was dein Klarheitsscore[\s\S]*?wirklich sichtbar macht/);
});

test('Messpunkte und Detailfenster sind interaktiv, fokussiert und schließen sauber', async () => {
  const script = await file('landing.js');

  assert.match(script, /const clarityStoryContent = \{/);
  assert.match(script, /data-clarity-week/);
  assert.match(script, /activateClarityWeek\(button\)/);
  assert.match(script, /clarityDetailsDialog\.showModal\(\)/);
  assert.match(script, /data-close-clarity-details/);
  assert.match(script, /clarityDetailsTrigger\?\.focus\(\)/);
  assert.match(script, /closeClarityDetails\(\{ restoreFocus: false \}\)/);
});

test('Klarheitskurve animiert responsiv und respektiert reduzierte Bewegung', async () => {
  const css = await file('landing-reference.css');

  assert.match(css, /\.clarity-story-board\.visible \.clarity-story-line[^}]*animation: clarityLandingDraw/);
  assert.match(css, /@keyframes clarityLandingPoint/);
  assert.match(css, /\.clarity-story-weeks button:focus-visible/);
  assert.match(css, /@media \(max-width: 1000px\)[^{]*\{[^}]*\.clarity-story-board \{ grid-template-columns: 1fr;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.clarity-story-board\.visible \.clarity-story-line/);
});
