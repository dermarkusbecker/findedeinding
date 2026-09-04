import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kundennavigation bildet exakt Verwaltung, Finanzen, Kommunikation und Termine ab', async () => {
  const [script, html, styles] = await Promise.all([file('admin.js'), file('admin.html'), file('admin-crm-refresh.css')]);
  for (const group of ['Verwaltung', 'Finanzen', 'Kommunikation', 'Termine']) assert.match(script, new RegExp(`label:'${group}'`));
  for (const page of ['dashboard', 'login', 'documents', 'documentInbox', 'conversation', 'account', 'billing', 'messages', 'whatsapp', 'appointments']) assert.match(html, new RegExp(`data-customer-page="${page}"`));
  assert.match(script, /function customerContextProfileMarkup/);
  assert.match(styles, /\.customer-context-profile/);
});

test('Kundenakte sammelt Vertrags-, Upload-, Finanz-, Nachrichten- und Termindaten serverseitig', async () => {
  const [api, migration] = await Promise.all([file('api/customer-records.js'), file('supabase/migrations/20260905110000_customer_workspace.sql')]);
  for (const relation of ['participant_documents', 'customer_appointments', 'lead_contracts', 'lead_payments', 'lead_communications', 'lead_bank_accounts']) assert.match(api, new RegExp(relation));
  assert.match(migration, /mobile_phone text/);
  assert.match(migration, /whatsapp_same_as_mobile boolean/);
  assert.match(migration, /profile_photo_path text/);
  assert.match(migration, /create table if not exists public\.customer_appointments/);
  assert.match(migration, /document_type in \('start_commitment','cv','workbook','other','contract','video_contract','shared'\)/);
});

test('WhatsApp Business besitzt vollständigen Chat, Composer, Versand und signierten Eingang', async () => {
  const [html, client, api, webhook, registry] = await Promise.all([file('admin.html'), file('admin.js'), file('api/customer-records.js'), file('api/whatsapp-webhook.js'), file('lib/system-registry.js')]);
  assert.match(html, /id="customerWhatsappMessages"/);
  assert.match(html, /id="customerWhatsappForm"/);
  assert.match(client, /action=whatsapp-send/);
  assert.match(api, /graph\.facebook\.com/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /direction: 'inbound'/);
  assert.match(registry, /id: 'whatsapp_business'/);
});

test('Kundenportal zeigt synchronisierte Termine und erlaubt ein optionales Profilbild', async () => {
  const [html, client, styles] = await Promise.all([file('portal.html'), file('portal.js'), file('portal.css')]);
  assert.match(html, /data-view="appointments"/);
  assert.match(html, /id="portalAppointmentList"/);
  assert.match(html, /id="portalProfilePhotoInput"/);
  assert.match(client, /function renderPortalAppointments/);
  assert.match(client, /action=avatar-upload/);
  assert.match(styles, /\.portal-appointment-list/);
});
