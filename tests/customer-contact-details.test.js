import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kundenakte zeigt echte Stamm- und Adressdaten statt Lead-Herkunft', async () => {
  const [html, client, api, access, migration, styles] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('api/program-control.js'),
    file('lib/program-access-service.js'),
    file('supabase/migrations/20260905090000_customer_contact_details.sql'),
    file('admin-program.css'),
  ]);

  assert.match(html, /id="customerAddressTitle">Name &amp; Adresse/);
  for (const id of ['customerProfileName', 'customerBirthDate', 'customerStreet', 'customerPostalCode', 'customerCity', 'customerCountry', 'customerPhone', 'customerProfileEmail', 'customerWhatsappPhone', 'customerPreferredChannel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html.match(/<section class="customer-address-card"[\s\S]*?<\/section>/)?.[0] || '', /Herkunft|Quelle/);
  assert.match(client, /customerProfile:\{name:/);
  assert.match(api, /async function patchCustomerProfile/);
  assert.match(api, /preferred_communication_channel/);
  assert.match(access, /birth_date,street,postal_code,city,country,phone,mobile_phone,whatsapp_phone,whatsapp_same_as_mobile/);
  assert.match(migration, /add column if not exists birth_date date/);
  assert.match(migration, /set phone = lead\.phone/);
  assert.match(styles, /\.customer-address-card/);
});

test('Telefon wird beim Vertragsabschluss in die Kundenstammdaten übernommen', async () => {
  const [leads, auth] = await Promise.all([file('api/leads.js'), file('lib/user-auth.js')]);
  assert.match(leads, /phone: lead\.phone/);
  assert.match(auth, /phone: String\(phone \|\| ''\)/);
});
