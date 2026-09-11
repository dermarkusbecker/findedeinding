import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('Datenschutz ist auf Landingpage, Impressum und im Cookie-Banner direkt erreichbar', async () => {
  const [landing, imprint] = await Promise.all([read('index.html'), read('impressum.html')]);
  assert.match(landing, /href="\/datenschutz">Datenschutz<\/a>/);
  assert.match(landing, /id="cookieConsentText"[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)*.*href="\/datenschutz"/s);
  assert.match(imprint, /href="\/datenschutz">Datenschutz<\/a>/);
});

test('Datenschutzseite deckt die real eingebauten Verarbeitungssituationen ab', async () => {
  const page = await read('datenschutz.html');
  for (const value of ['Markus Becker', 'Amorbacher Str. 39', 'Kontakt & Termine', 'KUNDENPORTAL & CRM', 'CLARA & KÜNSTLICHE INTELLIGENZ', 'OpenAI Ireland', 'Supabase', 'Vercel', 'Google Meet', 'WhatsApp', 'fdd_session', 'fdd-public-lead-draft-v1']) assert.match(page, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('Datenschutzseite nennt Rechtsgrundlagen, Betroffenenrechte, Speicherdauer und Drittlandtransfer', async () => {
  const page = await read('datenschutz.html');
  assert.match(page, /Art\. 6 Abs\. 1 lit\. b DSGVO/);
  assert.match(page, /Art\. 9 Abs\. 2 lit\. a DSGVO/);
  assert.match(page, /Art\. 44 ff\. DSGVO/);
  assert.match(page, /SPEICHERDAUER/);
  assert.match(page, /Art\. 15/);
  assert.match(page, /Art\. 21/);
  assert.match(page, /Landesbeauftragten für den Datenschutz und die Informationsfreiheit Baden-Württemberg/);
});

test('Datenschutzroute und responsive Darstellung sind vorhanden', async () => {
  const [config, css] = await Promise.all([read('vercel.json'), read('legal.css')]);
  assert.deepEqual(JSON.parse(config).rewrites.find((entry) => entry.source === '/datenschutz'), { source: '/datenschutz', destination: '/datenschutz.html' });
  assert.match(css, /\.privacy-toc/);
  assert.match(css, /\.privacy-table-wrap/);
  assert.match(css, /@media\(max-width:760px\)[^{]*\{[^}]*\.privacy-hero/s);
});
