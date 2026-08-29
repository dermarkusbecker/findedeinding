import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, requireAdmin, requirePermission, sessionFromRequest, USER_PERMISSIONS } from '../lib/auth.js';
import programControlHandler from '../api/program-control.js';
import participantProgramHandler from '../api/participant-program.js';

process.env.AUTH_SECRET = 'test-secret-with-at-least-thirty-two-characters';
const profileId = '11111111-1111-4111-8111-111111111111';
const requestFor = (token) => ({ headers: { cookie: `fdd_session=${token}` } });
const responseMock = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('Benutzer-Session enthält serverseitig festgelegte Rolle und Berechtigungen', () => {
  const token = createSession('kunde@example.de', 'user', { profileId, participantId: profileId, permissions: ['clara_program', 'not_allowed'] });
  const session = sessionFromRequest(requestFor(token));
  assert.equal(session.role, 'user');
  assert.deepEqual(session.permissions, ['clara_program']);
  assert.equal(session.profileId, profileId);
});

test('normaler Benutzer kann Admin-APIs auch mit direktem Request nicht aufrufen', () => {
  const token = createSession('kunde@example.de', 'user', { profileId, permissions: USER_PERMISSIONS });
  const response = responseMock();
  assert.equal(requireAdmin(requestFor(token), response), null);
  assert.equal(response.statusCode, 403);
});

test('fehlende individuelle Berechtigung wird serverseitig abgelehnt', () => {
  const token = createSession('kunde@example.de', 'user', { profileId, permissions: ['documents'] });
  const response = responseMock();
  assert.equal(requirePermission('clara_program')(requestFor(token), response), null);
  assert.equal(response.statusCode, 403);
});

test('passende individuelle Berechtigung wird serverseitig akzeptiert', () => {
  const token = createSession('kunde@example.de', 'user', { profileId, permissions: ['clara_program'] });
  const response = responseMock();
  assert.equal(requirePermission('clara_program')(requestFor(token), response).profileId, profileId);
});

test('Admin besitzt automatisch alle Zugangsrechte', () => {
  const token = createSession('admin@example.de', 'admin', { profileId });
  const response = responseMock();
  assert.equal(requireAdmin(requestFor(token), response).role, 'admin');
  assert.equal(requirePermission('community')(requestFor(token), response).role, 'admin');
});

test('direkter Aufruf der Admin-Programmsteuerung durch Benutzer endet vor jedem Datenbankzugriff mit 403', async () => {
  const token = createSession('kunde@example.de', 'user', { profileId, permissions: USER_PERMISSIONS });
  const response = responseMock();
  await programControlHandler({ method: 'GET', query: { participantId: profileId }, ...requestFor(token) }, response);
  assert.equal(response.statusCode, 403);
});

test('direkter Aufruf der Clara-API ohne Clara-Freigabe endet vor jedem Datenbankzugriff mit 403', async () => {
  const token = createSession('kunde@example.de', 'user', { profileId, permissions: ['customer_portal'] });
  const response = responseMock();
  await participantProgramHandler({ method: 'GET', query: {}, ...requestFor(token) }, response);
  assert.equal(response.statusCode, 403);
});
