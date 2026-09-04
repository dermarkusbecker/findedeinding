import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Vorlagencenter besitzt Bibliothek, Vorschau, Suche und Platzhaltereditor', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin-communication-center.js'), file('admin-communication.css')]);
  for (const id of ['communicationTemplateList', 'communicationTemplatePreview', 'templateSearch', 'templateCategory', 'communicationTemplateDialog']) assert.match(html, new RegExp(`id="${id}"`));
  for (const placeholder of ['vorname', 'datum', 'uhrzeit', 'meet_link', 'woche', 'portal_link']) assert.match(html, new RegExp(`{{${placeholder}}}`));
  assert.match(script, /function renderTemplates/);
  assert.match(script, /function openTemplateDialog/);
  assert.match(styles, /\.template-workspace/);
});

test('Seriennachrichten selektieren Interessenten, Teilnehmer, alle oder einzelne Kontakte', async () => {
  const [html, script, api] = await Promise.all([file('admin.html'), file('admin-communication-center.js'), file('api/leads.js')]);
  for (const audience of ['leads', 'customers', 'all', 'selected']) assert.match(html, new RegExp(`value="${audience}"`));
  assert.match(script, /campaignSelectedContacts/);
  assert.match(script, /selectedLeadIds/);
  assert.match(api, /COMMUNICATION_CAMPAIGN_AUDIENCES/);
  assert.match(api, /recipient_count/);
  assert.match(api, /status: body\?\.status === 'scheduled' \? 'scheduled' : 'draft'/);
});

test('Automationen verbinden CRM-Auslöser, Verzögerung, Vorlage und Zielgruppe', async () => {
  const [html, script, api] = await Promise.all([file('admin.html'), file('admin-communication-center.js'), file('api/leads.js')]);
  for (const trigger of ['lead_created', 'appointment_scheduled', 'contract_signed', 'participant_activated', 'week_unlocked', 'inactivity']) assert.match(html, new RegExp(`value="${trigger}"`));
  assert.match(script, /function renderAutomations/);
  assert.match(api, /COMMUNICATION_AUTOMATION_TRIGGERS/);
  assert.match(api, /delay_value/);
  assert.match(api, /trigger_config/);
  assert.match(api, /automation-state/);
});

test('Supabase-Migration erstellt Kommunikationsvorlagen, Kampagnen, Automationen und Standardvorlagen', async () => {
  const migration = await file('supabase/migrations/20260904233000_communication_center.sql');
  for (const table of ['communication_templates', 'communication_campaigns', 'communication_automations']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  for (const template of ['Terminerinnerung', 'Willkommensnachricht', 'Teilnehmer-Zugang', 'Neue Woche freigeschaltet']) assert.match(migration, new RegExp(template));
  assert.match(migration, /Domain-Mail-Schnittstelle|Mail-Schnittstelle/);
});

test('Kommunikations-Center bleibt bis zur Provider-Anbindung ehrlich im Planungsmodus', async () => {
  const [html, api] = await Promise.all([file('admin.html'), file('api/leads.js')]);
  assert.match(html, /Mailversand startet nach Verbindung des Domain-Anbieters/);
  assert.match(html, /Bis zur Mail-Anbindung bleiben geplante Ausführungen sicher angehalten/);
  assert.match(api, /mailTransport: \{ active: false/);
  assert.match(api, /wartet bis zur Mail-Anbindung auf den Versand/);
});
