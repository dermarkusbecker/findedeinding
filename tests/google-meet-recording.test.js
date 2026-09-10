import test from 'node:test';
import assert from 'node:assert/strict';
import { findGoogleMeetRecording, meetingCodeFromUrl } from '../lib/google-meet.js';

test('Meet-Code wird ausschließlich aus gültigen Google-Meet-Links gelesen', () => {
  assert.equal(meetingCodeFromUrl('https://meet.google.com/abc-defg-hij?authuser=0'), 'abc-defg-hij');
  assert.equal(meetingCodeFromUrl('abc-defg-hij'), 'abc-defg-hij');
  assert.equal(meetingCodeFromUrl('https://example.com/abc-defg-hij'), '');
});

test('Die jüngste passende native Meet-Aufzeichnung wird dem Konferenzdatensatz zugeordnet', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/spaces/abc-defg-hij')) return new Response(JSON.stringify({ name: 'spaces/space-1', meetingCode: 'abc-defg-hij' }), { status: 200 });
    if (value.includes('/conferenceRecords?')) return new Response(JSON.stringify({ conferenceRecords: [{ name: 'conferenceRecords/conf-1', startTime: '2026-09-10T10:00:00Z' }] }), { status: 200 });
    if (value.includes('/conferenceRecords/conf-1/recordings')) return new Response(JSON.stringify({ recordings: [{ name: 'conferenceRecords/conf-1/recordings/rec-1', state: 'FILE_GENERATED', startTime: '2026-09-10T10:05:00Z', driveDestination: { file: 'drive-file-1', exportUri: 'https://drive.google.com/file/d/drive-file-1/view' } }] }), { status: 200 });
    throw new Error(`Unerwartete URL: ${value}`);
  };
  const result = await findGoogleMeetRecording('token', 'https://meet.google.com/abc-defg-hij', { notBefore: '2026-09-10T10:04:00Z' });
  assert.equal(result.conference.name, 'conferenceRecords/conf-1');
  assert.equal(result.recording.state, 'FILE_GENERATED');
  assert.equal(result.recording.driveDestination.file, 'drive-file-1');
});
