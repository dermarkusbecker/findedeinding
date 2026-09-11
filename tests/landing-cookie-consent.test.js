import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('landing page provides an accessible cookie consent banner and persistent settings entry', async () => {
  const html = await file('index.html');
  assert.match(html, /id="cookieConsent"[^>]*role="dialog"[^>]*aria-labelledby="cookieConsentTitle"/);
  assert.match(html, /data-cookie-choice="necessary"[^>]*>Nur notwendige/);
  assert.match(html, /data-cookie-choice="all"[^>]*>Alle akzeptieren/);
  assert.match(html, /data-cookie-choice="selection"[^>]*>Auswahl speichern/);
  assert.match(html, /id="cookieAnalytics"/);
  assert.match(html, /id="cookieMarketing"/);
  assert.match(html, /data-open-cookie-settings>Cookie-Einstellungen/);
});

test('optional cookie categories are off by default and necessary storage cannot be disabled', async () => {
  const html = await file('index.html');
  assert.match(html, /Technisch notwendig[\s\S]*?<input type="checkbox" checked disabled>/);
  assert.doesNotMatch(html, /id="cookieAnalytics"[^>]*checked/);
  assert.doesNotMatch(html, /id="cookieMarketing"[^>]*checked/);
});

test('consent is versioned, stored and broadcast for optional integrations', async () => {
  const script = await file('landing.js');
  assert.match(script, /COOKIE_CONSENT_KEY = 'fdd-cookie-consent-v1'/);
  assert.match(script, /localStorage\.setItem\(COOKIE_CONSENT_KEY/);
  assert.match(script, /new CustomEvent\('fdd:cookie-consent'/);
  assert.match(script, /dataset\.analyticsConsent = preference\.analytics \? 'granted' : 'denied'/);
  assert.match(script, /dataset\.marketingConsent = preference\.marketing \? 'granted' : 'denied'/);
});

test('lead marketing tracking remains blocked until marketing consent is granted', async () => {
  const script = await file('landing.js');
  assert.match(script, /cookieConsentAllows\('marketing'\)[\s\S]*?window\.fbq\('track', 'Lead'\)/);
  assert.match(script, /window\.fbq\('consent', preference\.marketing \? 'grant' : 'revoke'\)/);
});

test('cookie banner follows the branded responsive design', async () => {
  const css = await file('landing-reference.css');
  assert.match(css, /\.cookie-consent\{[^}]*position:fixed[^}]*z-index:9200/);
  assert.match(css, /\.cookie-consent-shell\{[^}]*linear-gradient[^}]*max-height:calc\(100dvh - 40px\)/);
  assert.match(css, /@media\(max-width:600px\)[^{]*\{[^}]*\.cookie-consent/s);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{[^}]*\.cookie-consent-shell/s);
});
