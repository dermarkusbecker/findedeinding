import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureDocumentBucket } from '../lib/documents/api-handler.js';

test('vorhandener privater Dokument-Bucket wird unverändert verwendet', async () => {
  const calls = [];
  await ensureDocumentBucket({ url: 'https://example.supabase.co', key: 'service-key' }, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /participant-documents$/);
});

test('fehlender Dokument-Bucket wird privat und mit Dateilimit angelegt', async () => {
  const calls = [];
  await ensureDocumentBucket({ url: 'https://example.supabase.co', key: 'service-key' }, async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200 };
  });
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.id, 'participant-documents');
  assert.equal(payload.public, false);
  assert.equal(payload.file_size_limit, 10 * 1024 * 1024);
  assert.ok(payload.allowed_mime_types.includes('application/pdf'));
});
