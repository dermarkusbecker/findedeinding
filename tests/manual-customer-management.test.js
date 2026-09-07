import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Mitarbeiter mit Kundenrecht können eine vollständig verknüpfte Kundenakte manuell anlegen', async () => {
  const [html, client, api, auth, styles] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('api/participants.js'),
    file('lib/user-auth.js'),
    file('admin-crm-refresh.css'),
  ]);

  assert.match(html, /id="createCustomerButton"/);
  assert.match(html, /id="manualCustomerDialog"/);
  assert.match(html, /id="manualCustomerForm"/);
  for (const field of ['name', 'email', 'programStartDate', 'phone', 'mobilePhone', 'birthDate', 'street', 'postalCode', 'city', 'country', 'sendInvitation']) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(client, /fetch\('\/api\/participants',\{method:'POST'/);
  assert.match(client, /openParticipantLogin\(data\.participant\.id,data\.oneTimePassword/);
  assert.match(api, /async function createManualCustomer/);
  assert.match(api, /request\.method === 'POST' \? 'customers'/);
  assert.match(api, /source: 'manual_crm'/);
  assert.match(api, /matchingLeads\[0\]/);
  assert.match(api, /converted_user_profile_id: participant\.id/);
  assert.match(api, /permissions: \['customer_portal', 'clara_program', 'documents'\]/);
  assert.match(auth, /sendInvitation = true/);
  assert.match(auth, /if \(!sendInvitation\) return/);
  assert.match(styles, /\.customer-overview-actions/);
  assert.match(styles, /\.manual-customer-note/);
});

test('Kundenstammdaten einschließlich Login-E-Mail bleiben zentral editierbar und synchronisiert', async () => {
  const [html, client, programApi, lifecycle] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('api/program-control.js'),
    file('lib/contact-lifecycle.js'),
  ]);

  const profileDialog = html.slice(html.indexOf('id="customerProfileDialog"'), html.indexOf('</dialog>', html.indexOf('id="customerProfileDialog"')));
  assert.match(profileDialog, /name="email" type="email" required/);
  assert.doesNotMatch(profileDialog, /name="email"[^>]*readonly/);
  assert.match(client, /email:form\.elements\.email\.value/);
  assert.match(client, /customerProfileFieldLabels=\{[^}]*email:'E-Mail'/);
  assert.match(programApi, /auth\/v1\/admin\/users/);
  assert.match(programApi, /Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet/);
  assert.match(programApi, /email_changed|emailChanged/);
  assert.match(lifecycle, /email: clean\(profile\.email, 254\)\.toLowerCase\(\)/);
});
