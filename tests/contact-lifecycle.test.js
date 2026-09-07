import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitContactName } from '../lib/contact-lifecycle.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Interessentenakte besitzt dieselbe gruppierte zweite Navigation wie die Kundenakte', async () => {
  const [script, styles] = await Promise.all([file('admin.js'), file('admin-crm-refresh.css')]);
  assert.match(script, /leads:\{[^\n]*detailGroups:/);
  for (const group of ['Überblick', 'Vertrieb', 'Kommunikation', 'Abschluss & Finanzen', 'Organisation']) assert.match(script, new RegExp(`label:'${group.replace('&', '\\&')}'`));
  assert.match(script, /function leadContextProfileMarkup/);
  assert.match(script, /function leadContextGroupsMarkup/);
  assert.match(script, /name==='leads'&&activeLeadDashboard/);
  assert.match(styles, /\.lead-context-profile/);
});

test('Interessent und Kunde sind über eine eindeutige Lebenszyklus-ID 1:1 verbunden', async () => {
  const [migration, leadApi, customerApi, auth, records] = await Promise.all([
    file('supabase/migrations/20260907150000_contact_lifecycle_link_and_autosave.sql'),
    file('api/leads.js'),
    file('api/program-control.js'),
    file('lib/user-auth.js'),
    file('lib/customer-records-service.js'),
  ]);
  assert.match(migration, /source_lead_id uuid references public\.leads/);
  assert.match(migration, /user_profiles_source_lead_unique/);
  assert.match(migration, /leads_converted_profile_unique/);
  assert.match(auth, /sourceLeadId/);
  assert.match(leadApi, /syncLeadToCustomerProfile/);
  assert.match(customerApi, /syncCustomerProfileToLead/);
  assert.match(records, /profile\.source_lead_id/);
  assert.deepEqual(splitContactName('Anna Maria Muster'), { firstName: 'Anna', lastName: 'Maria Muster' });
});

test('Entwurfsfelder zeigen automatisches Zwischenspeichern in Interessenten-, Kunden- und Onboarding-Akte', async () => {
  const [html, admin, portal, api] = await Promise.all([file('admin.html'), file('admin.js'), file('portal.js'), file('api/participant-program.js')]);
  for (const id of ['leadAutosaveStatus', 'customerProfileAutosaveStatus', 'customerConversationAutosaveStatus']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(admin, /function persistLeadDraft/);
  assert.match(admin, /function persistCustomerProfile/);
  assert.match(admin, /function persistCustomerConversation/);
  assert.match(portal, /function persistOnboardingProfile/);
  assert.match(portal, /setTimeout\(\(\) => persistOnboardingProfile/);
  assert.match(api, /profileComplete: normalized\.missing\.length === 0/);
});
