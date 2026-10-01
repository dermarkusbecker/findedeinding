import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateOwnContactProfile } from '../lib/customer-self-profile.js';

const service = { url: 'https://example.test', key: 'service-key' };
const context = { participantId: 'customer-1', admin: false };
const input = {
  name: 'Chris Beispiel', email: 'chris@example.test',
  streetName: 'Neue Straße', houseNumber: '12a', postalCode: '10115', city: 'Berlin',
  country: 'Deutschland', phone: '030 123', mobilePhone: '0170 123',
  whatsappSameAsMobile: true, preferredChannel: 'email', postalMailActive: true,
};

test('customer updates only their own contact profile and linked CRM lead', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('select=id,auth_user_id,email')) return Response.json([{ id: 'customer-1', auth_user_id: 'auth-1', email: input.email }]);
    if (String(url).includes('/user_profiles?') && options.method === 'PATCH') return Response.json([{ id: 'customer-1', source_lead_id: 'lead-1', ...JSON.parse(options.body) }]);
    if (String(url).includes('/leads?') && options.method === 'PATCH') return Response.json([{ id: 'lead-1' }]);
    throw new Error('Unexpected request: ' + url);
  };
  const result = await updateOwnContactProfile(service, context, { ...input, participantId: 'another-customer' });
  assert.equal(result.profile.street, 'Neue Straße 12a');
  assert.equal(result.syncWarning, false);
  const ownWrite = calls.find((call) => call.url.includes('/user_profiles?') && call.options.method === 'PATCH');
  assert.match(ownWrite.url, /id=eq.customer-1/);
  assert.doesNotMatch(ownWrite.url, /another-customer/);
  assert.equal(JSON.parse(ownWrite.options.body).whatsapp_phone, input.mobilePhone);
  const leadWrite = calls.find((call) => call.url.includes('/leads?'));
  assert.equal(JSON.parse(leadWrite.options.body).street_name, 'Neue Straße');
  assert.equal(JSON.parse(leadWrite.options.body).house_number, '12a');
});

test('customer email change requires confirmation and current password', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => Response.json([{ id: 'customer-1', auth_user_id: 'auth-1', email: input.email }]);
  await assert.rejects(updateOwnContactProfile(service, context, { ...input, email: 'new@example.test', emailConfirmation: 'different@example.test' }), /stimmen nicht überein/);
  await assert.rejects(updateOwnContactProfile(service, context, { ...input, email: 'new@example.test', emailConfirmation: 'new@example.test' }), /aktuellen Passwort/);
  await assert.rejects(updateOwnContactProfile(service, { ...context, adminPreview: true }, input), /schreibgeschützt/);
});

test('customer account menu and contact form remain accessible on mobile', async () => {
  const html = await readFile(new URL('../portal.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../portal-account.css', import.meta.url), 'utf8');
  const script = await readFile(new URL('../portal-account.js', import.meta.url), 'utf8');
  assert.match(html, /id="portalProfileMenuButton"[^>]*aria-expanded="false"/);
  assert.match(html, /id="openCustomerAccount"/);
  assert.match(html, /id="customerLogout"/);
  for (const field of ['streetName', 'houseNumber', 'postalCode', 'city']) assert.match(html, new RegExp('name="' + field + '"'));
  assert.match(css, /@media\(max-width:700px\)[\s\S]*aside \.side-foot \{ display: block/);
  assert.match(script, /showView\('account'\)/);
  assert.match(script, /action=profile-update/);
});
