import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, createOAuthState, decryptCredential, encryptCredential, verifyOAuthState } from '../lib/google-calendar.js';

process.env.AUTH_SECRET = 'test-secret-with-at-least-thirty-two-characters';
process.env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'client-secret';

test('Google OAuth-State ist an das Adminprofil gebunden und signiert', () => {
  const state = createOAuthState('profile-1');
  assert.equal(verifyOAuthState(state, 'profile-1'), true);
  assert.equal(verifyOAuthState(state, 'profile-2'), false);
  assert.equal(verifyOAuthState(`${state}x`, 'profile-1'), false);
});

test('Google Refresh-Token wird verschlüsselt gespeichert', () => {
  const encrypted = encryptCredential('refresh-token-value');
  assert.notEqual(encrypted, 'refresh-token-value');
  assert.equal(decryptCredential(encrypted), 'refresh-token-value');
});

test('OAuth-URL fordert nur Kalendertermine und Verfügbarkeit mit Offline-Zugriff an', () => {
  const url = new URL(authorizationUrl('profile-1'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope'), /calendar\.events/);
  assert.match(url.searchParams.get('scope'), /calendar\.freebusy/);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://findedeinding.vercel.app/api/google/callback');
});
