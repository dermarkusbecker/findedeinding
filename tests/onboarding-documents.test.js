import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildPrivacyConsentText, buildStartCommitmentDocument } from '../lib/onboarding-documents.js';
import { buildCompletedPrivacyPdf, buildDraftPrivacyPreviewPdf, buildReadonlyPrivacyPreviewPdf, missingOnboardingFields, normalizeOnboardingProfile, normalizePrivacyConsent } from '../lib/privacy-consent.js';
import { buildCompletedStartCommitmentPdf, buildDraftStartCommitmentPreviewPdf, buildReadonlyStartCommitmentPreviewPdf, normalizeStartCommitment } from '../lib/start-commitment.js';

const signatureWidgetCount = (pdf) => pdf.getPages().reduce((count, page) => count + (page.node.Annots()?.asArray() || []).filter((reference) => String(pdf.context.lookup(reference)?.get?.(PDFName.of('FT'))) === '/Sig').length, 0);

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
  const browserCompatible = normalizePrivacyConsent({ special_categories: 'on', privacyAccepted: 'true', aiAccepted: 1, name: 'Anna Muster', place: 'Berlin', date: '07.09.2026' }, { email: 'anna@example.de' });
  assert.deepEqual(browserCompatible.missing, []);
  assert.equal(browserCompatible.consent.date, '2026-09-07');
});

test('Onboarding kann erst mit vollständigen Stammdaten abgeschlossen werden', () => {
  assert.deepEqual(missingOnboardingFields({ name: 'Anna Muster', birth_date: '1990-01-02', street: 'Musterweg 1', postal_code: '10115', city: 'Berlin', country: 'Deutschland', mobile_phone: '01701234567' }, 'anna@example.de'), []);
  assert.deepEqual(missingOnboardingFields({ name: 'Anna Muster' }, 'anna@example.de'), ['Geburtsdatum', 'Straße und Hausnummer', 'Postleitzahl', 'Ort', 'Land', 'Mobilnummer']);
  assert.deepEqual(missingOnboardingFields({ name: 'Anna Muster', birth_date: '1990-01-02', street: 'Musterweg 1', postal_code: '10115', city: 'Berlin', country: 'Deutschland', phone: '0711 123456' }, 'keine-mail'), ['gültige E-Mail-Adresse', 'Mobilnummer']);
  const changedEmail = normalizeOnboardingProfile({ email: 'NEU@EXAMPLE.DE', mobilePhone: '01701234567' }, { email: 'alt@example.de' });
  assert.equal(changedEmail.profile.email, 'neu@example.de');
});

test('aus dem Originalformular entsteht ein ausgefülltes, abgeflachtes PDF', async () => {
  const pdf = await buildCompletedPrivacyPdf({ specialCategories: true, privacyNotice: true, aiNotice: true, name: 'Anna Muster', email: 'anna@example.de', place: 'Berlin', date: '2026-09-07' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 80000);
});

test('Datenschutzvorschau ist schreibgeschützt und enthält keine ausfüllbaren PDF-Felder', async () => {
  const preview = await buildReadonlyPrivacyPreviewPdf();
  const pdf = await PDFDocument.load(preview);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getForm().getFields().length, 0);
  assert.equal(signatureWidgetCount(pdf), 0);
});

test('Datenschutz-Live-Vorschau übernimmt den aktuellen Formularstand ohne ihn final zu bestätigen', async () => {
  const blank = await buildDraftPrivacyPreviewPdf({ email: 'anna@example.de' });
  const filled = await buildDraftPrivacyPreviewPdf({ specialCategories: true, privacyNotice: true, aiNotice: false, name: 'Anna Muster', email: 'anna@example.de', place: 'Berlin', date: '2026-09-07' });
  const preview = await PDFDocument.load(filled);
  assert.equal(preview.getPageCount(), 2);
  assert.equal(preview.getForm().getFields().length, 0);
  assert.equal(signatureWidgetCount(preview), 0);
  assert.notDeepEqual(blank, filled);
});

test('persönliches Commitment verlangt alle Antworten und eine bewusste Klickbestätigung', () => {
  const incomplete = normalizeStartCommitment({ name: 'Anna Muster', startDate: '2026-09-07', why: 'Ich suche Klarheit.' }, { city: 'Berlin' });
  assert.deepEqual(incomplete.missing, ['was du für dich verändern möchtest', 'was weitere Unklarheit dich kostet', 'gültiges Bestätigungsdatum', 'verbindliche Klickbestätigung']);
  const complete = normalizeStartCommitment({ name: 'Anna Muster', startDate: '2026-09-07', why: 'Ich suche Klarheit.', change: 'Ich möchte eine klare berufliche Richtung finden.', costOfUnclarity: 'Weitere Energie und Zeit.', place: 'Berlin', signatureDate: '2026-09-07', accepted: true });
  assert.deepEqual(complete.missing, []);
  const browserCompatible = normalizeStartCommitment({ name: 'Anna Muster', start_date: '07.09.2026', reason: 'Ich suche Klarheit.', desiredChange: 'Ich möchte eine klare Richtung finden.', cost_of_unclarity: 'Weitere Energie und Zeit.', place: 'Berlin', date: '07.09.2026', confirmed: 'on' });
  assert.deepEqual(browserCompatible.missing, []);
  assert.equal(browserCompatible.commitment.signatureDate, '2026-09-07');
});

test('aus dem Original-Commitment entsteht ein digital ausgefülltes, abgeflachtes PDF', async () => {
  const pdf = await buildCompletedStartCommitmentPdf({ name: 'Anna Muster', startDate: '2026-09-07', why: 'Ich suche Klarheit und eine tragfähige Richtung.', change: 'Ich möchte mich klar entscheiden und ins Handeln kommen 🚀.', costOfUnclarity: 'Weitere Zeit, Energie und Lebensqualität.', place: 'Berlin', signatureDate: '2026-09-07', accepted: true });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 50000);
  const completed = await PDFDocument.load(pdf);
  assert.equal(completed.getPageCount(), 2);
  assert.equal(completed.getForm().getFields().length, 0);
  assert.equal(signatureWidgetCount(completed), 0);
});

test('Commitment-Vorlage und Live-Vorschau sind schreibgeschützt und übernehmen laufende Eingaben', async () => {
  const readonly = await buildReadonlyStartCommitmentPreviewPdf();
  const blank = await buildDraftStartCommitmentPreviewPdf({});
  const longAnswer = 'Diese ausführliche persönliche Antwort soll vollständig in das Originalformular übernommen werden. '.repeat(5);
  const commitment = { name: 'Anna Muster', startDate: '2026-09-10', why: longAnswer, change: longAnswer, costOfUnclarity: longAnswer, place: 'Berlin', signatureDate: '2026-09-10', accepted: true };
  const filled = await buildDraftStartCommitmentPreviewPdf(commitment);
  const completed = await buildCompletedStartCommitmentPdf(commitment);
  for (const buffer of [readonly, filled, completed]) {
    const pdf = await PDFDocument.load(buffer);
    assert.equal(pdf.getForm().getFields().length, 0);
    assert.equal(signatureWidgetCount(pdf), 0);
  }
  assert.notDeepEqual(blank, filled);
});

test('Portal verknüpft Stammdaten, Original-PDF, drei Bestätigungen und digitales Commitment', async () => {
  const [html, script, api, migration] = await Promise.all([
    readFile(new URL('../portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../portal.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260907130000_privacy_consent_document.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="onboardingProfileForm"/);
  assert.match(html, /id="onboardingEmail"[^>]*required/);
  assert.doesNotMatch(html, /id="onboardingEmail"[^>]*readonly/);
  assert.match(html, /id="onboardingCountry"[^>]*>\s*<option value="Deutschland">Deutschland<\/option>/);
  for (const id of ['onboardingBirthDay', 'onboardingBirthMonth', 'onboardingBirthYear']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="onboardingMobilePhone"[^>]*required/);
  assert.match(html, /id="privacyPdfPreview"/);
  assert.match(html, /feature=privacy-template/);
  assert.match(html, /id="privacySpecialCategories"/);
  assert.match(html, /id="privacyNoticeAccepted"/);
  assert.match(html, /id="privacyAiAccepted"/);
  assert.match(html, /id="privacyPreviewStatus"/);
  assert.match(html, /id="commitmentDialog"/);
  assert.match(html, /id="commitmentPdfPreview"/);
  assert.match(html, /feature=commitment-template/);
  assert.doesNotMatch(html, /commitmentPdfPreview[^>]+assets\/forms\/FDD-FRM-001/);
  assert.match(html, /data-commitment-step="4"/);
  assert.match(html, /id="commitmentAccepted"/);
  assert.match(script, /action: 'confirm_privacy'/);
  assert.match(script, /feature=privacy-preview/);
  assert.match(script, /confirmation\.documentId/);
  assert.match(script, /closePrivacyConsentDialog\('confirmed'\)/);
  assert.match(script, /downloadCustomerDocument\(confirmation\.documentId/);
  assert.match(script, /onboardingBirthParts/);
  assert.match(script, /onboardingBirthParts\[index \+ 1\]\.focus\(\)/);
  assert.match(script, /Bitte ergänze noch:/);
  assert.match(script, /function closePrivacyConsentDialog/);
  assert.match(script, /action: 'confirm_commitment'/);
  assert.match(script, /feature=commitment-preview/);
  assert.match(script, /scheduleCommitmentPdfPreview/);
  assert.match(script, /downloadCustomerDocument\(confirmation\.documentId, confirmation\.document\?\.original_file_name \|\| 'FDD-Mein-persoenliches-Commitment\.pdf'/);
  assert.match(script, /currentCommitmentInput/);
  assert.match(script, /function closeCommitmentDialog/);
  assert.match(script, /queueOnboardingFormDraft/);
  assert.match(script, /action: 'save_onboarding_profile'/);
  assert.match(api, /storePrivacyConsentDocument/);
  assert.match(api, /buildReadonlyPrivacyPreviewPdf/);
  assert.match(api, /buildDraftPrivacyPreviewPdf/);
  assert.match(api, /document: \{ id: document\.id/);
  assert.match(api, /storeStartCommitmentDocument/);
  assert.match(api, /buildDraftStartCommitmentPreviewPdf/);
  assert.match(api, /feature === 'commitment-template'/);
  assert.match(api, /currentDocument\.participant_confirmed_at/);
  assert.match(api, /auth\/v1\/admin\/users/);
  assert.match(await readFile(new URL('../lib/privacy-consent.js', import.meta.url), 'utf8'), /checkedWidgets/);
  assert.match(migration, /privacy_consent/);
});
