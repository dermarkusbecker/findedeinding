import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeAdminNotification } from '../lib/intake-admin-notification.js';

const lead = {
  name: 'Alex Beispiel', email: 'alex@example.test', mobile_phone: '+49 171 1234567',
  appointment_start: '2026-10-12T08:00:00.000Z', appointment_timezone: 'Europe/Berlin',
  meet_url: 'https://meet.google.com/abc-defg-hij',
};

test('neue Intake-Buchung nennt den Kontakt und macht die Telefonnummer im Admin-Postfach anwählbar', () => {
  const mail = intakeAdminNotification(lead, { signature: { active: true, signer_name: 'Markus Becker' } });
  assert.match(mail.subject, /Alex Beispiel/);
  assert.match(mail.body, /alex@example\.test/);
  assert.match(mail.body, /\+49 171 1234567/);
  assert.match(mail.body, /12\. Oktober 2026 um 10:00 Uhr/);
  assert.match(mail.body, /meet\.google\.com\/abc-defg-hij/);
  assert.match(mail.body_html, /href="tel:\+491711234567"/);
  assert.match(mail.body_html, /Markus Becker/);
});

test('fehlende und unsichere Telefonnummern erzeugen keinen Telefonlink', () => {
  const missing = intakeAdminNotification({ ...lead, mobile_phone: null });
  assert.match(missing.body, /Telefon: Nicht angegeben/);
  assert.doesNotMatch(missing.body_html, /href="tel:/);
  const unsafe = intakeAdminNotification({ ...lead, mobile_phone: '<script>alert(1)</script>' });
  assert.doesNotMatch(unsafe.body_html, /<script>|href="tel:/);
  assert.match(unsafe.body_html, /&lt;script&gt;/);
});
