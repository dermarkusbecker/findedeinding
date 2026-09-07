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

test('Verkaufsgespräch hat klickbare Phasen, Demo-Termine und Ja-Nein-Auswahl', async () => {
  const [html, js] = await Promise.all([read('admin.html'), read('admin.js')]);
  for (const step of ['1', '2', '3', '4']) assert.match(html, new RegExp(`data-open-lead-step="${step}"`));
  assert.match(html, /id="demoAppointmentSlots"/);
  assert.match(html, /data-yes-no="q1"/);
  assert.match(html, /data-yes-no="q6"/);
  assert.match(js, /renderDemoAppointmentSlots/);
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

test('Aufzeichnung startet nur über sichtbare Browserfreigabe und wird privat verknüpft', async () => {
  const [html, js, api, storage, migration] = await Promise.all([read('admin.html'), read('admin.js'), read('api/leads.js'), read('lib/customer-storage.js'), read('supabase/migrations/20260907180000_video_contract_workflow.sql')]);
  assert.match(html, /id="startVideoContractRecording"/);
  assert.match(js, /getDisplayMedia/);
  assert.match(js, /new MediaRecorder/);
  assert.match(js, /action=begin-video-recording/);
  assert.match(api, /action === 'video-recording-upload'/);
  assert.match(storage, /contract-recordings/);
  assert.match(migration, /video_recording_consent_at/);
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
