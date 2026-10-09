import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../lib/auth.js';
import handler from '../api/participant-program.js';

const participantId = '11111111-1111-4111-8111-111111111111';
const profile = { id: participantId, name: 'Jörg Müller', email: 'joerg@example.de', city: 'München', role: 'user', status: 'active', permissions: ['clara_program'] };
const ok = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('Datenschutz und Commitment bestätigen trotz fehlerhafter Entwurfsbereinigung erfolgreich', async () => {
  const previous = { fetch: globalThis.fetch, auth: process.env.AUTH_SECRET, url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.AUTH_SECRET = 'onboarding-confirmation-test-secret-12345';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
  const progress = { user_profile_id: participantId, process_status: 'ONBOARDING', current_week: 0, program_status: 'active', access_mode: 'time_based', program_start_date: '2026-10-09', privacy_consent_at: null, start_commitment_at: null };
  const documents = [];
  let cleanupAttempts = 0;
  let cleanupFails = true;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url), method = options.method || 'GET';
    if (target.includes('/rest/v1/user_profiles?id=')) {
      if (method === 'PATCH') Object.assign(profile, JSON.parse(options.body));
      return ok([profile]);
    }
    if (target.includes('/rest/v1/participant_progress?')) {
      if (method === 'PATCH') Object.assign(progress, JSON.parse(options.body));
      return ok([progress]);
    }
    if (target.includes('/rest/v1/leads?') && method === 'PATCH') return ok([]);
    if (target.includes('/rest/v1/week_gates?') || target.includes('/rest/v1/process_entries?')) return ok([]);
    if (target.includes('/rest/v1/rpc/assign_program_version')) return ok(null);
    if (target.includes('/rest/v1/participant_documents?')) return ok(target.includes('document_type=in.(start_commitment,other)') ? documents.filter((document) => ['start_commitment', 'other'].includes(document.document_type)) : documents.filter((document) => document.document_type === 'privacy_consent'));
    if (target.endsWith('/rest/v1/participant_documents') && method === 'POST') {
      const document = { ...JSON.parse(options.body), id: `document-${documents.length + 1}`, created_at: '2026-10-09T10:00:00Z' };
      documents.unshift(document);
      return ok([document], 201);
    }
    if (target.includes('/rest/v1/participant_form_drafts?') && method === 'DELETE') { cleanupAttempts++; return cleanupFails ? ok({ message: 'cleanup unavailable' }, 503) : ok([]); }
    if (target.includes('/storage/v1/bucket/participant-documents')) return ok({});
    if (target.includes('/storage/v1/object/participant-documents/')) return ok({});
    throw new Error(`Unexpected request: ${method} ${new URL(target).pathname}`);
  };
  const token = createSession('joerg@example.de', 'user', { profileId: participantId, participantId, permissions: ['clara_program'] });
  const send = async (action, payload) => {
    const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'PATCH', query: {}, headers: { authorization: `Bearer ${token}` }, body: { action, ...payload } }, response);
    return response;
  };
  try {
    const privacy = await send('confirm_privacy', { consent: { specialCategories: true, privacyNotice: true, aiNotice: true, name: profile.name, place: profile.city, date: '2026-10-09' } });
    assert.equal(privacy.statusCode, 200, privacy.body?.error);
    assert.equal(privacy.body.documentId, 'document-1');
    assert.ok(progress.privacy_consent_at);
    const privacyRetry = await send('confirm_privacy', { consent: { name: profile.name } });
    assert.equal(privacyRetry.statusCode, 200);
    assert.equal(privacyRetry.body.documentId, privacy.body.documentId);
    assert.equal(privacyRetry.body.recovered, true);
    const commitment = await send('confirm_commitment', { commitment: { name: profile.name, startDate: '2026-10-09', why: 'Ich suche Klarheit.', change: 'Ich möchte eine Richtung finden.', costOfUnclarity: 'Es kostet mich Zeit.', place: profile.city, signatureDate: '2026-10-09', accepted: true } });
    assert.equal(commitment.statusCode, 200, commitment.body?.error);
    assert.equal(commitment.body.documentId, 'document-2');
    assert.equal(cleanupAttempts, 3);
    documents[0].document_type = 'other';
    progress.privacy_consent_at = null;
    cleanupFails = false;
    const start = await send('start', { profile: { name: profile.name, email: profile.email, birthDate: '1990-01-01', street: 'Musterstraße 1', postalCode: '80331', city: profile.city, country: 'Deutschland', mobilePhone: '01511234567' } });
    assert.equal(start.statusCode, 200, start.body?.error);
    assert.ok(progress.privacy_consent_at);
    assert.ok(progress.start_commitment_at);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['AUTH_SECRET', previous.auth], ['SUPABASE_URL', previous.url], ['SUPABASE_ANON_KEY', previous.anon], ['SUPABASE_SERVICE_ROLE_KEY', previous.service]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
