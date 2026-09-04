import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Vertragsabschluss erzeugt automatisch Kundennummer, Teilnehmer-Login und Einmalzugang', async () => {
  const [migration, auth, leads] = await Promise.all([
    file('supabase/migrations/20260904220000_participant_logins.sql'),
    file('lib/user-auth.js'),
    file('api/leads.js'),
  ]);
  assert.match(migration, /customer_number_seq/);
  assert.match(migration, /new\.portal_username := first_name \|\| '_' \|\| new\.customer_number/);
  assert.match(migration, /must_change_password/);
  assert.match(auth, /oneTimePassword = randomTemporaryPassword\(\)/);
  assert.match(auth, /must_change_password: true/);
  assert.match(leads, /Teilnehmer-Login automatisch erstellt/);
});

test('Teilnehmer können sich mit Teilnehmer-Login anmelden und müssen das Einmalpasswort ändern', async () => {
  const [html, client, api, portal, auth] = await Promise.all([
    file('login.html'), file('login.js'), file('api/auth.js'), file('api/portal.js'), file('lib/user-auth.js'),
  ]);
  assert.match(html, /name="identifier"/);
  assert.match(client, /change-initial-password/);
  assert.match(api, /mustChangePassword \? '\/login\?change=required'/);
  assert.match(api, /action === 'change-initial-password'/);
  assert.match(portal, /profile\.must_change_password === true/);
  assert.match(auth, /portal_username=eq/);
});

test('zweite Navigation und Adminbereich verwalten Login, Einmalpasswort und Mailversand', async () => {
  const [html, client, participantsApi, styles] = await Promise.all([
    file('admin.html'), file('admin.js'), file('api/participants.js'), file('admin-crm-refresh.css'),
  ]);
  assert.match(client, /\['Portal-Login','Login, Einmalpasswort & Versand','#participantLoginManager'/);
  for (const id of ['participantLoginManager', 'participantLoginDialog', 'issueOneTimePassword', 'sendParticipantLoginMail', 'oneTimePasswordResult']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(participantsApi, /action === 'update-login'/);
  assert.match(participantsApi, /action === 'issue-one-time-password'/);
  assert.match(participantsApi, /action === 'send-login-mail'/);
  assert.match(styles, /\.participant-login-manager/);
});

test('Einmalpasswörter werden nicht im Klartext persistiert', async () => {
  const [migration, api] = await Promise.all([
    file('supabase/migrations/20260904220000_participant_logins.sql'),
    file('api/participants.js'),
  ]);
  assert.doesNotMatch(migration, /temporary_password|plain.*password/i);
  assert.doesNotMatch(api, /one_time_password\s*:/i);
  assert.match(api, /visibleOnce: true/);
});
