import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('CRM besitzt ein zentrales Postfach für Interessenten und Teilnehmer', async () => {
  const [html, script, styles] = await Promise.all([
    file('admin.html'), file('admin.js'), file('admin-communication.css'),
  ]);
  assert.match(html, /data-view="communications"/);
  assert.match(html, /data-panel="communications"/);
  for (const id of ['communicationMailbox', 'communicationList', 'communicationReadingPane', 'communicationSearch', 'communicationComposerDialog']) assert.match(html, new RegExp(`id="${id}"`));
  for (const folder of ['all', 'inbound', 'outbound', 'draft', 'system']) assert.match(html, new RegExp(`data-mail-folder="${folder}"`));
  assert.match(script, /communications:\{icon:'✉',label:'Kommunikations-Center'/);
  assert.match(script, /contact\.type==='customer'\?'Teilnehmer':'Interessent'/);
  assert.match(styles, /\.communication-mailbox/);
  assert.match(styles, /\.mail-reading-pane/);
});

test('Kommunikationsnavigation trennt Postfach, Vorlagen, Seriennachrichten und Automationen', async () => {
  const [html, script] = await Promise.all([file('admin.html'), file('admin.js')]);
  for (const section of ['mailbox', 'templates', 'campaigns', 'automations']) assert.match(html, new RegExp(`data-communication-section="${section}"`));
  for (const label of ['Postfach', 'Vorlagen', 'Seriennachrichten', 'Automatisierte Nachrichten']) assert.match(script, new RegExp(label));
  assert.match(script, /data-context-communication/);
  assert.match(html, /admin-communication-center\.js/);
});

test('Kommunikations-API liefert ein vereintes Postfach und verwaltet Entwürfe und Lesestatus', async () => {
  const api = await file('api/leads.js');
  assert.match(api, /async function communicationInbox/);
  assert.match(api, /action === 'communications'/);
  assert.match(api, /action === 'communication-draft'/);
  assert.match(api, /delivery_status: 'draft'/);
  assert.match(api, /action === 'communication-read'/);
  assert.match(api, /converted_user_profile_id \? 'customer' : 'lead'/);
});

test('Postfachdaten speichern vollständigen Inhalt, Versandstatus und Lesezeitpunkt', async () => {
  const migration = await file('supabase/migrations/20260904230000_communication_inbox.sql');
  for (const column of ['body text', 'channel text', 'delivery_status text', 'read_at timestamptz']) assert.match(migration, new RegExp(column));
  assert.match(migration, /lead_communications_mailbox_idx/);
});

test('ohne Domain-Mail-Anbieter werden neue Nachrichten ehrlich als Entwurf gespeichert', async () => {
  const [html, api] = await Promise.all([file('admin.html'), file('api/leads.js')]);
  assert.match(html, /Domain-Mail noch nicht verbunden/);
  assert.match(html, /Als Entwurf speichern/);
  assert.match(api, /mailTransport: \{ active: false/);
  assert.match(api, /wurde als Entwurf gespeichert/);
});
