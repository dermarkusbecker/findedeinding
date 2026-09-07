import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPrivacyConsentText, buildStartCommitmentDocument } from '../lib/onboarding-documents.js';
import { buildCompletedPrivacyPdf, missingOnboardingFields, normalizePrivacyConsent } from '../lib/privacy-consent.js';

test('Datenschutz-Text erklärt Zweck, Verarbeitung und Widerruf klar und eindeutig', () => {
  const consent = buildPrivacyConsentText({ name: 'Anna Muster' });
  assert.match(consent.title, /Datenschutz/i);
  assert.match(consent.content, /Zweck/i);
  assert.match(consent.content, /Widerruf/i);
  assert.match(consent.content, /Verarbeitung/i);
});

test('Start-Commitment enthält den vollständigen Namen und die bestätigende Selbstverpflichtung', () => {
  const commitment = buildStartCommitmentDocument({ name: 'Anna Muster' });
  assert.match(commitment.title, /Start-Commitment/i);
  assert.match(commitment.content, /Anna Muster/i);
  assert.match(commitment.content, /Ich nehme den achtwöchigen Prozess ernsthaft/i);
  assert.match(commitment.content, /Unterschrift/i);
});

test('Datenschutzeinwilligung verlangt drei bewusste Bestätigungen, Name, Ort und Datum', () => {
  const incomplete = normalizePrivacyConsent({ privacyNotice: true, name: 'Anna Muster' }, { email: 'anna@example.de' });
  assert.deepEqual(incomplete.missing, [
    'Einwilligung zu freiwillig angegebenen sensiblen Daten',
    'Kenntnisnahme der KI-gestützten Verarbeitung',
    'Ort',
    'gültiges Datum',
  ]);
  const complete = normalizePrivacyConsent({ specialCategories: true, privacyNotice: true, aiNotice: true, name: 'Anna Muster', place: 'Berlin', date: '2026-09-07' }, { email: 'anna@example.de' });
  assert.deepEqual(complete.missing, []);
});

test('Onboarding kann erst mit vollständigen Stammdaten abgeschlossen werden', () => {
  assert.deepEqual(missingOnboardingFields({ name: 'Anna Muster', birth_date: '1990-01-02', street: 'Musterweg 1', postal_code: '10115', city: 'Berlin', country: 'Deutschland', mobile_phone: '01701234567' }, 'anna@example.de'), []);
  assert.deepEqual(missingOnboardingFields({ name: 'Anna Muster' }, 'anna@example.de'), ['Geburtsdatum', 'Straße und Hausnummer', 'Postleitzahl', 'Ort', 'Land', 'Telefon- oder Mobilnummer']);
});

test('aus dem Originalformular entsteht ein ausgefülltes, abgeflachtes PDF', async () => {
  const pdf = await buildCompletedPrivacyPdf({ specialCategories: true, privacyNotice: true, aiNotice: true, name: 'Anna Muster', email: 'anna@example.de', place: 'Berlin', date: '2026-09-07' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 80000);
});

test('Portal verknüpft Stammdaten, Original-PDF, drei Bestätigungen und Commitment-Vorschau', async () => {
  const [html, script, api, migration] = await Promise.all([
    readFile(new URL('../portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../portal.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260907130000_privacy_consent_document.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="onboardingProfileForm"/);
  assert.match(html, /id="privacyPdfPreview"/);
  assert.match(html, /id="privacySpecialCategories"/);
  assert.match(html, /id="privacyNoticeAccepted"/);
  assert.match(html, /id="privacyAiAccepted"/);
  assert.match(html, /id="commitmentPreviewDialog"/);
  assert.match(script, /action: 'confirm_privacy'/);
  assert.match(script, /action: 'save_onboarding_profile'/);
  assert.match(api, /storePrivacyConsentDocument/);
  assert.match(migration, /privacy_consent/);
});
