import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitStreetAddress, syncLeadToCustomerProfile, syncCustomerProfileToLead } from '../lib/contact-lifecycle.js';
import { normalizeVideoContract } from '../lib/video-contract.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kontakt fragt die vier Adressangaben einzeln ab und reicht sie an Termin und Abschluss weiter', async () => {
  const [html, script, api, migration] = await Promise.all([
    read('admin.html'), read('admin.js'), read('api/leads.js'),
    read('supabase/migrations/20260928210000_sales_conversation_separate_address.sql'),
  ]);
  const contact = html.slice(html.indexOf('<section class="lead-basics lead-wizard-page"'), html.indexOf('<section class="lead-questions lead-wizard-page"'));
  for (const name of ['streetName', 'houseNumber', 'postalCode', 'city']) {
    assert.match(contact, new RegExp(`name="${name}"[^>]*`));
    assert.doesNotMatch(contact, new RegExp(`name="${name}"[^>]*required`));
    assert.equal((html.match(new RegExp(`data-lead-address="${name}"`, 'g')) || []).length, 2);
    assert.match(script, new RegExp(`${name}:values\\.${name}`));
  }
  assert.match(script, /validateLeadContactStep\(\)/);
  assert.match(api, /street_name:clean\(request\.body\?\.streetName/);
  for (const column of ['street_name', 'house_number', 'postal_code', 'city']) assert.match(migration, new RegExp(`add column if not exists ${column}`));
});

test('separate address fields form the existing PDF and invoice address consistently', () => {
  const input = { streetName: 'Musterweg', houseNumber: '12a', postalCode: '12345', city: 'Berlin' };
  const { contract, missing } = normalizeVideoContract(input);
  assert.equal(contract.street, 'Musterweg 12a');
  assert.equal(contract.postalCity, '12345 Berlin');
  assert.ok(!missing.includes('Straße'));
  assert.ok(!missing.includes('PLZ und Ort'));
  assert.ok(normalizeVideoContract({ ...input, houseNumber: '' }).missing.includes('Hausnummer'));
  assert.deepEqual(splitStreetAddress('Musterweg 12a'), { streetName: 'Musterweg', houseNumber: '12a' });
});

test('Anschrift speichert unabhängig von übrigen Pflichtfeldern und aktualisiert Kontakt und Anfrage sofort', async () => {
  const [script, api] = await Promise.all([read('admin.js'), read('api/leads.js')]);
  assert.match(script, /function persistLeadAddress\(\)/);
  assert.match(script, /fetch\('\/api\/leads\?action=update-address'/);
  assert.match(script, /renderLeadDashboard\(\{\.\.\.activeLeadDashboard,lead:data\.lead\}\)/);
  assert.match(script, /leadDialog\.addEventListener\('close',[^\n]*persistLeadAddress/);
  const addressRoute = api.slice(api.indexOf("action === 'update-address'"), api.indexOf("action === 'update')"));
  assert.match(addressRoute, /patchLead\(service, current\.id, address\)/);
  assert.doesNotMatch(addressRoute, /mobilePhone|firstName|lastName/);
});


test('an address entered in Kontakt reaches the linked customer and returns as four lead fields', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const writes = [];
  global.fetch = async (_url, options) => { writes.push(JSON.parse(options.body)); return Response.json([{}]); };
  const service = { url: 'https://example.test', key: 'test' };
  await syncLeadToCustomerProfile(service, {
    id: 'lead', converted_user_profile_id: 'customer', name: 'Max Muster',
    street_name: 'Musterweg', house_number: '12a', postal_code: '12345', city: 'Berlin',
  });
  assert.equal(writes[0].street, 'Musterweg 12a');
  assert.equal(writes[0].postal_code, '12345');
  await syncCustomerProfileToLead(service, {
    id: 'customer', source_lead_id: 'lead', name: 'Max Muster', email: 'max@example.test',
    street: 'Neuer Weg 7', postal_code: '54321', city: 'Hamburg',
  });
  assert.equal(writes[1].street_name, 'Neuer Weg');
  assert.equal(writes[1].house_number, '7');
  assert.equal(writes[1].city, 'Hamburg');
});
