import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeCustomerProgress } from '../api/participants.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kundenübersicht trennt Kundenliste und Teilnehmer-Login in eigene Unterbereiche', async () => {
  const [html, script] = await Promise.all([file('admin.html'), file('admin.js')]);
  assert.match(html, /id="participantOverview"/);
  assert.match(html, /id="participantLoginManager" hidden/);
  assert.match(script, /detailGroups:\[\{label:'Verwaltung'/);
  assert.match(script, /\['Portal-Login','Login, Einmalpasswort & Versand'/);
  assert.match(script, /function setParticipantSection/);
  assert.match(script, /participantSection!=='logins'/);
});

test('Kundenliste unterstützt Kacheln, Liste und große Detailansicht mit ausschließlich echten Kunden', async () => {
  const [html, script, api, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('api/participants.js'), file('admin-crm-refresh.css')]);
  for (const mode of ['tiles', 'list', 'details']) assert.match(html, new RegExp(`data-participant-view="${mode}"`));
  assert.match(script, /participantViewMode==='list'/);
  assert.match(script, /participantViewMode==='details'/);
  assert.match(script, /function customerOverviewMarkup/);
  assert.match(api, /user_profiles\?role=eq\.user&select=\*,participant_progress!inner/);
  assert.match(api, /status=eq\.customer/);
  assert.match(api, /linked_lead_id/);
  assert.match(api, /week_gates\?required=eq\.true/);
  assert.match(api, /participants\.filter\(\(participant\) => leadByCustomer\.has\(participant\.id\)\)/);
  assert.match(html, /id="participantStatusFilter"/);
  assert.match(html, /id="participantSort"/);
  assert.match(styles, /\.customer-overview-results\.tiles/);
  assert.match(styles, /\.customer-detail-card/);
});

test('Kundenfortschritt entsteht aus abgeschlossenen Pflicht-Gates statt aus der Zeitfreischaltung', () => {
  const gates = [
    { week: 0, required: true, completed_at: '2026-09-01T10:00:00Z' },
    { week: 0, required: true, completed_at: '2026-09-01T10:01:00Z' },
    { week: 1, required: true, completed_at: '2026-09-02T10:00:00Z' },
    { week: 1, required: true, completed_at: '2026-09-02T10:01:00Z' },
    { week: 2, required: true, completed_at: null },
  ];
  assert.deepEqual(summarizeCustomerProgress(gates, 8), { completed_weeks: [1], process_week: 2, completion_percent: 13 });
  assert.deepEqual(summarizeCustomerProgress(gates.map((gate) => gate.week === 0 ? { ...gate, completed_at: null } : gate), 8).process_week, 0);
});

test('Kundenakte öffnet zuerst ein Dashboard und führt das Kundengespräch als eigene Seite', async () => {
  const [html, script] = await Promise.all([file('admin.html'), file('admin.js')]);
  assert.match(html, /id="customerDashboard"/);
  assert.match(html, /data-customer-page="dashboard"/);
  assert.match(html, /data-customer-page="conversation" hidden/);
  assert.match(html, /id="customerConversationForm"/);
  assert.match(script, /customerDashboardPage='dashboard'/);
  assert.match(script, /function openCustomerDashboard/);
  assert.match(script, /function setCustomerDashboardPage/);
  assert.match(script, /\['Kundengespräche','Laufende und abgeschlossene Gespräche'/);
  assert.match(script, /conversation:\['sales_calls'\]/);
  assert.match(script, /function canAccessCustomerPage/);
  assert.match(script, /group\.items\.filter\(item=>canAccessCustomerPage\(item\[6\]\)\)/);
  assert.match(script, /data-customer-summary-permission/);
  assert.match(script, /Kundengespräch wurde gespeichert/);
});

test('interne Rollen besitzen fest definierte und serverseitig geprüfte CRM-Rechte', async () => {
  const [roles, migration, usersApi, auth, participantsApi, programApi, customerRecords, html] = await Promise.all([
    file('lib/staff-roles.js'),
    file('supabase/migrations/20260905100000_staff_roles.sql'),
    file('api/users.js'),
    file('lib/user-auth.js'),
    file('api/participants.js'),
    file('api/program-control.js'),
    file('lib/customer-records-service.js'),
    file('admin.html'),
  ]);
  for (const role of ['owner', 'administrator', 'sales', 'customer_success', 'communications', 'finance']) {
    assert.match(roles, new RegExp(`${role}:`));
    assert.match(migration, new RegExp(`'${role}'`));
  }
  assert.match(usersApi, /staffPermissionsFor/);
  assert.match(usersApi, /requireCurrentAdmin\(request, response, 'users'\)/);
  assert.match(auth, /current\.staffPermissions\.includes/);
  assert.match(html, /id="staffRoleOverview"/);
  assert.match(html, /name="staffRole"/);
  assert.match(roles, /sales:[^\n]+permissions: \['dashboard', 'leads', 'sales_calls', 'communications'\]/);
  assert.match(participantsApi, /request\.method === 'GET' \? \['customers', 'program', 'sales_calls'\]/);
  assert.match(programApi, /request\.method === 'GET' \? \['customers', 'program', 'sales_calls'\]/);
  assert.match(customerRecords, /\['customers', 'finance', 'communications', 'sales_calls'\]/);
  assert.match(customerRecords, /!context\.staffPermissions\.some\(\(permission\) => \['customers', 'program'\]\.includes\(permission\)\)/);
  assert.match(participantsApi, /const fullCustomerAccess = admin\.staffPermissions\.some/);
  assert.match(html, /data-customer-page="conversation" hidden/);
});
