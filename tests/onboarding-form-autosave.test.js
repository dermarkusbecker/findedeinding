import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { saveOnboardingFormDraft } from '../lib/onboarding-form-drafts.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Onboarding-Entwurf wird teilnehmergebunden und ohne rechtliche Finalisierung gespeichert', async () => {
  const originalFetch = global.fetch;
  const participantId = '11111111-1111-4111-8111-111111111111';
  let storedPayload;
  global.fetch = async (_url, options = {}) => {
    storedPayload = JSON.parse(options.body);
    return new Response(JSON.stringify([{ ...storedPayload, updated_at: '2026-09-07T20:30:00Z' }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await saveOnboardingFormDraft({ url: 'https://example.supabase.co', key: 'service-key' }, participantId, 'start_commitment', { name: 'Anna Muster', why: 'Mein Warum', accepted: true, wizardStep: 2 });
    assert.equal(storedPayload.user_profile_id, participantId);
    assert.equal(storedPayload.form_key, 'start_commitment');
    assert.equal(storedPayload.draft_data.why, 'Mein Warum');
    assert.equal(storedPayload.draft_data.wizardStep, 2);
    assert.equal(result.savedAt, '2026-09-07T20:30:00Z');
    assert.equal('participant_confirmed_at' in storedPayload, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Datenschutz und Commitment laden Entwürfe und schließen nach finaler Bestätigung automatisch', async () => {
  const [client, api, migration] = await Promise.all([file('portal.js'), file('api/participant-program.js'), file('supabase/migrations/20260907190000_onboarding_form_drafts.sql')]);
  assert.match(client, /action: 'save_onboarding_form_draft'/);
  assert.match(client, /formDrafts\?\.start_commitment/);
  assert.match(client, /closeCommitmentDialog\('confirmed'\)/);
  assert.match(client, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(api, /readOnboardingFormDrafts/);
  assert.match(api, /deleteOnboardingFormDraft/);
  assert.match(migration, /create table if not exists public\.participant_form_drafts/);
  assert.match(migration, /Entwürfe stellen keine rechtliche Bestätigung dar/);
});
