import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.match(api, /linked_lead_id/);
  assert.match(styles, /\.customer-overview-results\.tiles/);
  assert.match(styles, /\.customer-detail-card/);
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
  assert.match(script, /Kundengespräch wurde gespeichert/);
});

test('interne Rollen besitzen fest definierte und serverseitig geprüfte CRM-Rechte', async () => {
  const [roles, migration, usersApi, auth, html] = await Promise.all([
    file('lib/staff-roles.js'),
    file('supabase/migrations/20260905100000_staff_roles.sql'),
    file('api/users.js'),
    file('lib/user-auth.js'),
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
});
