import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { buildVideoContractPdf, normalizeVideoContract, VIDEO_CONFIRMATION_KEYS } from '../lib/video-contract.js';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const completeInput = () => ({
  customerName: 'Max Mustermann', birthDate: '1990-01-01', street: 'Musterweg 1', postalCity: '12345 Musterstadt',
  customerEmail: 'max@example.com', customerPhone: '+4912345678', meetingAt: '2026-09-07T10:00:00.000Z',
  serviceStart: '2026-09-08', product: 'Finde dein Ding · 8-Wochen-Programm', duration: '8 Wochen', totalPrice: '2.490,00 €',
  paymentModel: 'Einmalzahlung', paymentDue: '7 Tage nach Abschluss', place: 'Online · Google Meet', contractDate: '2026-09-07',
  recordingConsent: true, recordingPurposeAccepted: true, recordingRevocationAccepted: true, consumerConfirmed: true,
  priorInformationConfirmed: true, emailConfirmed: true, immediateStart: true, serviceRevocationUnderstood: true,
  digitalContentImmediate: true, digitalContentRevocationUnderstood: true, finalContractConfirmed: true,
  answers: Object.fromEntries(VIDEO_CONFIRMATION_KEYS.map((key) => [key, true])),
});

test('Verkaufsgespräch hat klickbare Phasen, echte freie Termine und Ja-Nein-Auswahl', async () => {
  const [html, js] = await Promise.all([read('admin.html'), read('admin.js')]);
  for (const step of ['1', '2', '3', '4']) assert.match(html, new RegExp(`data-open-lead-step="${step}"`));
  assert.match(html, /id="availableDays"/);
  assert.match(html, /id="availableTimes"/);
  assert.match(html, /data-yes-no="q1"/);
  assert.match(html, /data-yes-no="q6"/);
  assert.match(js, /renderAvailableTimes/);
});

test('Videovertrag verlangt vollständige Vertragsdaten und elf einzelne Bestätigungen', () => {
  const valid = normalizeVideoContract(completeInput());
  assert.deepEqual(valid.missing, []);
  assert.equal(Object.values(valid.contract.answers).filter(Boolean).length, 11);
  const incomplete = normalizeVideoContract({ customerName: 'Max' });
  assert.ok(incomplete.missing.includes('Geburtsdatum'));
  assert.ok(incomplete.missing.includes('Gesamtpreis'));
});

test('Originalformular wird als ausgefülltes und abgeflachtes Vertrags-PDF erzeugt', async () => {
  const { contract } = normalizeVideoContract(completeInput());
  const bytes = await buildVideoContractPdf(contract, { videoConfirmed: true, customerSigned: true, providerConfirmed: true });
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 7);
  assert.equal(pdf.getForm().getFields().length, 0);
});

test('Bildschirmaufnahme ersetzt Meet als Pflichtweg; bisherige Meet-Dateien bleiben lesbar', async () => {
  const [html, js, api, meet, storage, migration] = await Promise.all([read('admin.html'), read('admin.js'), read('api/leads.js'), read('lib/google-meet.js'), read('lib/customer-storage.js'), read('supabase/migrations/20260910153000_google_meet_contract_recordings.sql')]);
  assert.match(html, /id="startVideoContractRecording"/);
  assert.match(html, /data-close-video-contract[^>]+aria-label="Videovertrag schließen und zum Abschluss zurückkehren"/);
  assert.match(html, /Bildschirmaufnahme starten/);
  assert.match(html, /contractRecordingFile/);
  assert.doesNotMatch(js, /getDisplayMedia/);
  assert.doesNotMatch(js, /new MediaRecorder/);
  assert.match(js, /browser-contract-recorder/);
  assert.doesNotMatch(js, /action=sync-google-meet-recording/);
  assert.match(js, /closeVideoContractToConclusion/);
  assert.match(js, /setLeadWizardStep\(4\)/);
  assert.match(api, /action === 'sync-google-meet-recording'/);
  assert.match(meet, /conferenceRecords/);
  assert.match(meet, /DRIVE_API.*\/files/s);
  assert.match(storage, /importCustomerObject/);
  assert.match(storage, /contract-recordings/);
  assert.match(migration, /google_meet_recording_name/);
});

test('Zusätzliche Kundensignatur nutzt einen ablaufenden Token und legt die finale PDF bei Dokumente ab', async () => {
  const [page, client, api, vercel, migration] = await Promise.all([read('contract-sign.html'), read('contract-sign.js'), read('lib/contract-sign-service.js'), read('vercel.json'), read('supabase/migrations/20260907180000_video_contract_workflow.sql')]);
  assert.match(page, /Jetzt ausdrücklich digital bestätigen/);
  assert.match(client, /contractAccepted/);
  assert.match(api, /customer_signed_at/);
  assert.match(api, /document_type: 'video_contract'/);
  assert.match(vercel, /\/api\/leads\?action=public-contract-sign/);
  assert.match(migration, /signing_expires_at/);
});
