import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { storeGeneratedParticipantDocument } from '../lib/generated-document-storage.js';

test('erzeugte Onboarding-PDF wird in Storage und mit derselben Kunden-ID in der Dokumentenakte abgelegt', async () => {
  const originalFetch = global.fetch;
  const participantId = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/storage/v1/bucket/participant-documents')) return new Response('{}', { status: 200 });
    if (String(url).includes('/storage/v1/object/participant-documents/')) return new Response('{}', { status: 200 });
    if (String(url).includes('/rest/v1/participant_documents')) {
      const payload = JSON.parse(options.body);
      return new Response(JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-07T20:00:00Z', ...payload }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const document = await storeGeneratedParticipantDocument({
      service: { url: 'https://example.supabase.co', key: 'service-key' }, participantId,
      buffer: Buffer.from('%PDF-test'), fileName: 'onboarding.pdf', documentType: 'start_commitment',
      title: 'Mein persönliches Commitment', extractedData: { artifactType: 'start_commitment' },
      extractionVersion: 'test-v1', confirmedAt: '2026-09-07T20:00:00Z',
    });
    assert.equal(document.user_profile_id, participantId);
    assert.equal(document.document_type, 'start_commitment');
    assert.equal(document.visibility, 'customer');
    assert.equal(document.processing_status, 'ready');
    const databaseCall = calls.find((call) => call.url.includes('/rest/v1/participant_documents'));
    assert.ok(databaseCall);
    const payload = JSON.parse(databaseCall.options.body);
    assert.equal(payload.storage_bucket, 'participant-documents');
    assert.equal(payload.extraction_method, 'pdf_form_fill');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Supabase erlaubt die Verarbeitungsart systemseitig befüllter PDFs', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260910193000_generated_pdf_extraction_method.sql', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(migration, /drop constraint if exists participant_documents_extraction_method_check/);
  assert.match(migration, /'pdf_form_fill'/);
  assert.match(schema, /extraction_method text check \(extraction_method in \([^)]*'pdf_form_fill'/);
});

test('PDF-Ablage bleibt mit älteren Dokument-Constraints für Datenschutz und Commitment funktionsfähig', async () => {
  const originalFetch = global.fetch;
  const participantId = '11111111-1111-4111-8111-111111111111';
  const accepted = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/storage/v1/bucket/participant-documents')) return new Response('{}', { status: 200 });
    if (target.includes('/storage/v1/object/participant-documents/')) return new Response('{}', { status: 200 });
    if (target.includes('/rest/v1/participant_documents')) {
      const payload = JSON.parse(options.body);
      if (payload.extraction_method === 'pdf_form_fill') {
        return new Response(JSON.stringify({ code: '23514', message: 'new row violates check constraint participant_documents_extraction_method_check' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (payload.document_type === 'privacy_consent') {
        return new Response(JSON.stringify({ code: '23514', message: 'new row violates check constraint participant_documents_document_type_check' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      accepted.push(payload);
      return new Response(JSON.stringify([{ id: `document-${accepted.length}`, created_at: '2026-09-11T12:00:00Z', ...payload }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const privacy = await storeGeneratedParticipantDocument({
      service: { url: 'https://example.supabase.co', key: 'service-key' }, participantId,
      buffer: Buffer.from('%PDF-privacy'), fileName: 'datenschutz.pdf', documentType: 'privacy_consent', fallbackDocumentType: 'other',
      title: 'Datenschutzinformation & Einwilligung', extractedData: { artifactType: 'privacy_consent' }, extractionVersion: 'privacy-v1',
    });
    const commitment = await storeGeneratedParticipantDocument({
      service: { url: 'https://example.supabase.co', key: 'service-key' }, participantId,
      buffer: Buffer.from('%PDF-commitment'), fileName: 'commitment.pdf', documentType: 'start_commitment',
      title: 'Mein persönliches Commitment', extractedData: { artifactType: 'start_commitment' }, extractionVersion: 'commitment-v1',
    });
    assert.equal(privacy.document_type, 'other');
    assert.equal(privacy.extraction_method, 'manual');
    assert.equal(privacy.extracted_data.artifactType, 'privacy_consent');
    assert.equal(commitment.document_type, 'start_commitment');
    assert.equal(commitment.extraction_method, 'manual');
    assert.equal(commitment.extracted_data.artifactType, 'start_commitment');
    assert.equal(accepted.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
