import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Portal-Login ist sicher in Kundenakte und zweiter Navigation verwaltbar', async () => {
  const [html, client, api] = await Promise.all([file('admin.html'), file('admin.js'), file('api/participants.js')]);
  assert.match(client, /label:'Portal & Sicherheit'/);
  assert.match(client, /data-manage-customer-login/);
  assert.match(html, /id="toggleOneTimePassword"/);
  assert.match(client, /dataset\.password/);
  assert.match(api, /must_change_password: true/);
  assert.match(api, /action === 'send-login-mail'/);
});

test('Signaturen und globale Logoquelle sind editierbar und im Composer auswählbar', async () => {
  const [html, client, api, migration] = await Promise.all([file('admin.html'), file('admin-communication-center.js'), file('api/leads.js'), file('supabase/migrations/20260907120000_communication_signatures.sql')]);
  assert.match(html, /data-settings-panel="signatures"/);
  assert.match(html, /id="communicationComposerSignature"/);
  assert.match(client, /fillSignatureControls/);
  assert.match(api, /saveCommunicationSignature/);
  assert.match(api, /signature_id/);
  assert.match(migration, /Markus Becker · Persönlich/);
  assert.match(migration, /create table if not exists public\.system_branding/);
});

test('Zugangsautomation, Wochenreflexion und Q&A sind durchgängig verknüpft', async () => {
  const [migration, programApi, portal, admin] = await Promise.all([file('supabase/migrations/20260907120000_communication_signatures.sql'), file('api/program-control.js'), file('portal.js'), file('admin.js')]);
  assert.match(migration, /Portal-Zugang nach Vertragsabschluss/);
  assert.match(migration, /'participant_activated'/);
  assert.match(programApi, /reflection:/);
  assert.match(portal, /weekReflectionQuestionForm/);
  assert.match(portal, /action:'support_question'/);
  assert.match(admin, /openAdminWeekReflection/);
  assert.match(admin, /Fragen für das Q&amp;A mit Markus/);
});

test('Gate-Übersicht springt an den Seitenanfang und Landing-Texte bleiben unskaliert', async () => {
  const [html, admin, landing] = await Promise.all([file('admin.html'), file('admin.js'), file('landing-reference.css')]);
  assert.match(html, /id="gateOverviewTop"/);
  assert.match(admin, /'#gateOverviewTop'/);
  assert.match(landing, /\.app-frame\{transform:translateX\(-50%\)\}/);
  assert.match(landing, /@media\(max-width:560px\)\{\.app-frame\{left:0;max-width:100%/);
});
