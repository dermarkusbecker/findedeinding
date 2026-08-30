import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrivacyConsentText, buildStartCommitmentDocument } from '../lib/onboarding-documents.js';

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
