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
  assert.match(html, /Klarheitsgespräch vereinbaren/);
});

test('Landingpage führt Interessenten über drei Seiten bis zur echten Terminbuchung', async () => {
  const [html, script, styles, api] = await Promise.all([file('index.html'), file('landing.js'), file('landing.css'), file('api/leads.js')]);
  for (const step of ['1', '2', '3']) assert.match(html, new RegExp(`data-public-lead-step="${step}"`));
  assert.match(html, /<small>Kontakt<\/small>/);
  assert.match(html, /Anliegen/);
  assert.match(html, /Freie Termine/);
  assert.match(html, /name="appointmentStart"/);
  assert.match(html, /id="publicAvailableSlots"/);
  assert.match(html, /Klarheitsgespräch vereinbaren/);
  assert.match(script, /function setPublicLeadStep/);
  assert.match(script, /function loadPublicSlots/);
  assert.match(script, /action=public-available-slots/);
  assert.match(styles, /\.public-lead-progress/);
  assert.match(styles, /\.public-available-slots/);
  assert.match(api, /request\.method === 'GET' && action === 'public-available-slots'/);
  assert.match(api, /assertCalendarAvailable/);
  assert.match(api, /saveCalendarEvent/);
  assert.match(api, /status: 'scheduled'/);
});

test('Termin-Einstellungen erklären und verlinken die Landingpage-Buchungsstrecke', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css')]);
  assert.match(html, /Landingpage-Buchungsstrecke/);
  assert.match(html, /id="bookingLandingStatus"/);
  assert.match(html, /href="\/#start"/);
  assert.match(script, /Buchung aktiv/);
  assert.match(script, /name==='appointments'\)loadBookingSettings/);
  assert.match(styles, /\.booking-landing-flow/);
});
