import test from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(JSON.parse(databaseCall.options.body).storage_bucket, 'participant-documents');
  } finally {
    global.fetch = originalFetch;
  }
});
