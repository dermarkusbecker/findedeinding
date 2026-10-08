import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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

test('Verkaufsgespräch beginnt mit dem im Intake gespeicherten Termin und direktem Meet-Link', async () => {
  const [html, js, api] = await Promise.all([read('admin.html'), read('admin.js'), read('api/leads.js')]);
  const appointment = html.slice(html.indexOf('<section class="lead-appointment lead-wizard-page"'), html.indexOf('<section class="lead-basics lead-wizard-page"'));
  assert.match(appointment, /data-lead-step="1"/);
  assert.match(appointment, /id="leadBookedAppointmentTime"/);
  assert.match(appointment, /id="openMeet"[^>]*>Google Meet öffnen/);
  assert.match(appointment, /id="leadAppointmentReschedule"/);
  assert.match(html, /<section class="lead-basics lead-wizard-page" data-lead-step="3" hidden>/);
  assert.match(js, /renderIntakeAppointment\(lead\)/);
  assert.match(js, /meet\.href=lead\.meet_url/);
  assert.match(api, /appointment_start: startDate\.toISOString\(\)/);
  assert.match(api, /meet_url: meetUrl/);
});

test('Abschluss zeigt zuerst den Meet-Termin und danach die verpflichtende Aufzeichnungseinwilligung', async () => {
  const [html, js, api] = await Promise.all([read('admin.html'), read('admin.js'), read('api/leads.js')]);
  assert.equal((html.match(/id="createContractDocument"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="createVideoContract"/);
  assert.match(html, /Vertragsdokument und Videovertrag erstellen/);
  const dialog = html.slice(html.indexOf('<dialog id="videoContractDialog"'), html.indexOf('<dialog id="contractEmailLockedDialog"'));
  const order = ['video-meet-section', 'video-consent-section', 'recording-control-section', 'video-contract-fields', 'video-confirmation-list', 'finalizeVideoContract'].map(marker => dialog.indexOf(marker));
  assert.ok(order.every((position, index) => position > -1 && (!index || position > order[index - 1])));
  assert.match(dialog, /video-meet-section[^]*?<header><span>1<\/span>/);
  assert.match(dialog, /video-consent-section[^]*?<header><span>2<\/span>/);
  assert.equal((dialog.match(/name="captureConsent"/g) || []).length, 1);
  assert.doesNotMatch(dialog, /name="recordingConsent"/);
  assert.doesNotMatch(js, /setVideoContractMode|createVideoContract'/);
  assert.doesNotMatch(api, /Nach Beginn von Schritt 2 kann das vorbereitete Vertragsdokument nicht mehr verändert werden/);
});

test('Videovertrag verlangt vollständige Vertragsdaten und elf einzelne Bestätigungen', () => {
  const valid = normalizeVideoContract(completeInput());
  assert.deepEqual(valid.missing, []);
  assert.equal(Object.values(valid.contract.answers).filter(Boolean).length, 11);
  const incomplete = normalizeVideoContract({ customerName: 'Max' });
  assert.ok(incomplete.missing.includes('Geburtsdatum'));
  assert.ok(incomplete.missing.includes('Gesamtpreis'));
});

test('manuelles Verkaufsgespräch kann ohne gebuchten Termin und Meet-Link abgeschlossen werden', async () => {
  const [api, client] = await Promise.all([read('api/leads.js'), read('admin.js')]);
  const completion = api.slice(api.indexOf("action === 'complete-sales-conversation'", api.indexOf('export default async function handler')), api.indexOf("action === 'cancel-appointment'", api.indexOf('export default async function handler')));
  assert.match(completion, /if \(!lead\.appointment_start \|\| !lead\.appointment_end\) \{[\s\S]*?sales_conversation_completed_at: now[\s\S]*?mailStatus: 'not_applicable'/);
  assert.match(completion, /if \(!lead\.meet_url\) \{[\s\S]*?sales_conversation_completed_at: now/);
  assert.doesNotMatch(completion, /Bitte plane zuerst einen freien Termin|Der Meet-Link fehlt noch/);
  assert.match(client, /meetingAt:activeLeadDashboard\?\.lead\?\.appointment_start\|\|latestVideoContract\(\)\?\.contract_data\?\.meetingAt\|\|new Date\(\)\.toISOString\(\)/);
  const { contract, missing } = normalizeVideoContract({ ...completeInput(), meetingAt: '', place: 'Online · Videogespräch' }, { appointment_start: null, meet_url: null });
  assert.deepEqual(missing, []);
  assert.equal(contract.meetingAt, '');
  const pdf = await buildVideoContractPdf(contract, { videoConfirmed: true, customerSigned: true, providerConfirmed: true });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('Originalformular wird als ausgefülltes und abgeflachtes Vertrags-PDF erzeugt', async () => {
  const { contract } = normalizeVideoContract(completeInput());
  const bytes = await buildVideoContractPdf(contract, { videoConfirmed: true, customerSigned: true, providerConfirmed: true });
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 7);
  assert.equal(pdf.getForm().getFields().length, 0);
});

test('abgeschlossener Videovertrag hat den neuen Titel und beide Signaturhinweise', async () => {
  const { contract } = normalizeVideoContract(completeInput());
  const bytes = await buildVideoContractPdf(contract, { videoConfirmed: true, providerConfirmed: true });
  const rendered = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const first = (await (await rendered.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  const last = (await (await rendered.getPage(7)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(first, /Videovertrag/);
  assert.doesNotMatch(first, /B2C-Videovertrag/);
  assert.equal((last.match(/digitale Signatur über beiliegenden Videovertrag/g) || []).length, 2);
  const draft = await buildVideoContractPdf(contract, { draft: true });
  const draftPdf = await getDocument({ data: new Uint8Array(draft), useSystemFonts: true }).promise;
  const draftLast = (await (await draftPdf.getPage(7)).getTextContent()).items.map(item => item.str).join(' ');
  assert.doesNotMatch(draftLast, /digitale Signatur über beiliegenden Videovertrag/);
});

test('PDF speichert längere CRM-Eingaben trotz 100-Zeichen-Limit der Vorlage', async () => {
  const additionalServices = 'Individuelle Leistung '.repeat(12);
  const additionalAgreements = 'Besondere Vereinbarung '.repeat(12);
  const { contract } = normalizeVideoContract({ ...completeInput(), additionalServices, additionalAgreements });
  const bytes = await buildVideoContractPdf(contract, { draft: true });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 7);
  assert.equal(pdf.getForm().getFields().length, 0);
  const rendered = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let text = '';
  for (let page = 1; page <= rendered.numPages; page++) text += (await (await rendered.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
  assert.equal((text.match(/Individuelle Leistung/g) || []).length, 12);
  assert.equal((text.match(/Besondere Vereinbarung/g) || []).length, 12);
});

test('Bildschirmaufnahme ersetzt Meet als Pflichtweg; bisherige Meet-Dateien bleiben lesbar', async () => {
  const [html, js, api, meet, storage, migration] = await Promise.all([read('admin.html'), read('admin.js'), read('api/leads.js'), read('lib/google-meet.js'), read('lib/customer-storage.js'), read('supabase/migrations/20260910153000_google_meet_contract_recordings.sql')]);
  assert.match(html, /id="startVideoContractRecording"/);
  assert.match(html, /data-close-video-contract[^>]+aria-label="Abschluss schließen und zum Verkaufsgespräch zurückkehren"/);
  assert.match(html, /id="startVideoContractRecording"[^>]*>Aufnahme starten<\/button>/);
  assert.doesNotMatch(html, /id="selectVideoContractSource"/);
  assert.match(html, /contractRecordingFile/);
  assert.doesNotMatch(js, /getDisplayMedia/);
  assert.doesNotMatch(js, /new MediaRecorder/);
  assert.match(js, /device-contract-recorder/);
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
