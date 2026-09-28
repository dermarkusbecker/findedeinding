import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, calendarEvent, createOAuthState, decryptCredential, deleteCalendarEvent, encryptCredential, saveCalendarEvent, verifyOAuthState } from '../lib/google-calendar.js';

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

test('Meet-Termin wird ohne Google-Einladungsmail angelegt und ohne Google-Absage entfernt', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(options.method === 'DELETE' ? null : JSON.stringify({ id: 'meeting-1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }), { status: options.method === 'DELETE' ? 204 : 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const lead = { name: 'Alex Beispiel', email: 'alex@example.test' };
    const event = await saveCalendarEvent('test-token', lead, '2026-10-06T10:00:00.000Z', '2026-10-06T10:45:00.000Z');
    assert.equal(event.hangoutLink, 'https://meet.google.com/abc-defg-hij');
    assert.match(calls[0].url, /sendUpdates=none/);
    assert.equal(JSON.parse(calls[0].options.body).attendees[0].email, lead.email);
    assert.equal(JSON.parse(calls[0].options.body).conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.deepEqual(JSON.parse(calls[0].options.body).reminders.overrides, [{ method: 'popup', minutes: 15 }]);
    await calendarEvent('test-token', event.id);
    assert.match(calls[1].url, /meeting-1\?conferenceDataVersion=1/);
    await deleteCalendarEvent('test-token', event.id);
    assert.match(calls[2].url, /sendUpdates=none/);
  } finally {
    global.fetch = originalFetch;
  }
});
