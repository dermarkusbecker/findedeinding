import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeCustomerProgress } from '../api/participants.js';
import { createWeekOneState } from '../lib/week-one.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Kundenübersicht trennt Kundenliste und Teilnehmer-Login in eigene Unterbereiche', async () => {
  const [html, script] = await Promise.all([file('admin.html'), file('admin.js')]);
  assert.match(html, /id="participantOverview"/);
  assert.match(html, /id="participantLoginManager" hidden/);
  assert.match(script, /groups:\[\{label:'Kundenakten'/);
  assert.match(script, /detailGroups:\[\{label:'Überblick'/);
  assert.match(script, /label:'Zugang & Unterlagen'/);
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
  assert.match(api, /participants\.filter\(\(participant\) => leadByCustomer\.has\(participant\.id\) \|\| participant\.permissions\?\.includes\('demo_full_access'\)\)/);
  assert.match(html, /id="participantStatusFilter"/);
  assert.match(html, /id="participantSort"/);
  assert.match(styles, /\.customer-overview-results\.tiles/);
  assert.match(styles, /\.customer-detail-card/);
});

test('Kundenfortschritt entsteht erst aus bestätigten Wochenabschlüssen', () => {
  const gates = [
    { week: 0, required: true, completed_at: '2026-09-01T10:00:00Z' },
    { week: 0, required: true, completed_at: '2026-09-01T10:01:00Z' },
    { week: 1, required: true, completed_at: '2026-09-02T10:00:00Z' },
    { week: 1, required: true, completed_at: '2026-09-02T10:01:00Z' },
    { week: 2, required: true, completed_at: null },
  ];
  const inWeekTwo = { current_week: 2, process_status: 'WEEK_2', privacy_consent_at: '2026-09-01', start_commitment_at: '2026-09-01', program_start_date: '2026-09-01' };
  const weekOne = createWeekOneState();
  weekOne.status = 'completed';
  weekOne.completed_at = '2026-09-03T10:00:00Z';
  weekOne.wishes = weekOne.wishes.map((wish) => ({ ...wish, completed: true }));
  weekOne.fdd_target.completed = true;
  weekOne.clarity_baseline = { score: 3, completed: true };
  weekOne.career_history = { ...weekOne.career_history, cv_uploaded: true, completed: true };
  const entries = [{ week: 1, data_block: 'week_1_state', structured_data: { week_1: weekOne }, created_at: '2026-09-03T10:00:00Z' }];
  const now = new Date('2026-09-04T12:00:00Z');
  assert.deepEqual(summarizeCustomerProgress(gates, inWeekTwo, entries, now), { completed_weeks: [1], process_week: 1, released_week: 1, completion_percent: 13 });
  assert.deepEqual(summarizeCustomerProgress(gates.map((gate) => gate.week === 0 ? { ...gate, completed_at: null } : gate), { current_week: 0, process_status: 'ONBOARDING' }).process_week, 0);
  const weekTwoReadyButNotClosed = gates.map((gate) => gate.week === 2 ? { ...gate, completed_at: '2026-09-03T10:00:00Z' } : gate);
  assert.deepEqual(summarizeCustomerProgress(weekTwoReadyButNotClosed, inWeekTwo, entries, now), { completed_weeks: [1], process_week: 1, released_week: 1, completion_percent: 13 });
});

test('Kundenakte öffnet zuerst das Dashboard und das Verkaufsgespräch direkt als Dialog', async () => {
  const [html, script] = await Promise.all([file('admin.html'), file('admin.js')]);
  assert.match(html, /id="customerDashboard"/);
  assert.match(html, /data-customer-page="dashboard"/);
  assert.match(html, /data-customer-page="conversation" hidden/);
  assert.match(html, /id="customerConversationForm"/);
  assert.match(script, /customerDashboardPage='dashboard'/);
  assert.match(script, /function openCustomerDashboard/);
  assert.match(script, /function setCustomerDashboardPage/);
  assert.match(script, /\['Verkaufsgespräch','Dialog direkt öffnen'/);
  assert.match(script, /contextParticipants==='conversation'.*openLeadEditor/s);
  assert.match(script, /conversation:\['sales_calls'\]/);
  assert.match(script, /function canAccessCustomerPage/);
  assert.match(script, /group\.items\.filter\(item=>canAccessCustomerPage\(item\[6\]\)\)/);
  assert.match(script, /data-customer-summary-permission/);
  assert.match(script, /Kundengespräch wurde gespeichert/);
});

test('CRM verknüpft alle laufenden Kundenfälle mit dem lesbaren Wochenprozess', async () => {
  const [html, script, styles, programApi] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('admin-crm-refresh.css'),
    file('api/program-control.js'),
  ]);
  assert.match(html, /id="dashboardRunningCount"/);
  assert.match(html, /id="customerProcessWeekNav"/);
  assert.match(html, /id="customerProcessDetail"/);
  assert.match(html, /Prozessfortschritt &amp; Kundeneingaben/);
  assert.match(script, /\['Prozessfortschritt','Wochenstatus, Reflexion & Eingaben'/);
  assert.match(script, /participants\.filter\(person=>customerStatus\(person\)!=='completed'\)/);
  assert.doesNotMatch(script, /participants\.slice\(0,4\)\.map\(person=>participantMarkup/);
  assert.match(script, /data-dashboard-participant-id/);
  assert.match(script, /openCustomerDashboard\(button\.dataset\.dashboardParticipantId,'program'\)/);
  assert.match(script, /function renderCustomerProcess/);
  assert.match(programApi, /const processWeeks = processWeekResult\(result\)/);
  assert.match(programApi, /processWeeks, clarityAnalysis/);
  assert.match(programApi, /function weekOneAnswers/);
  assert.match(programApi, /function guidedAnswers/);
  assert.match(styles, /\.customer-process-layout/);
  assert.match(styles, /\.customer-week-track \{[^}]*grid-template-columns: repeat\(8,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.customer-process-detail>header \{[^}]*align-items: center;[^}]*height: auto;[^}]*min-height: 126px;[^}]*position: relative;/);
  assert.match(styles, /\.customer-process-detail>header>div \{[^}]*justify-content: center;/);
});

test('Kunden-Dashboard bleibt kompakt und öffnet Stammdaten in einem eigenen Bearbeitungsfenster', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css')]);
  assert.match(html, /id="customerProfileDialog"/);
  assert.match(html, /id="customerProfileForm"/);
  assert.match(html, /data-edit-customer-profile/);
  assert.match(script, /function openCustomerProfileEditor/);
  assert.match(script, /data-edit-customer-field/);
  assert.match(script, /JSON\.stringify\(\{participantId,customerProfile\}\)/);
  assert.doesNotMatch(script, /querySelector\('#editCustomerData'\)\.addEventListener\('click',\(\)=>openProgramControl/);
  assert.match(html, /class="lead-dashboard-card customer-balance-summary-card"/);
  assert.doesNotMatch(html, /class="lead-dashboard-card lead-balance-card" data-customer-summary-permission="finance"/);
  assert.match(styles, /\.customer-dashboard-summary \{[^}]*grid-template-columns: repeat\(12,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.customer-dashboard-summary>\.customer-contact-summary-card \{[^}]*grid-column: span 7/);
  assert.match(styles, /\.customer-dashboard-summary>\.customer-balance-summary-card \{[^}]*grid-column: span 5/);
  assert.match(styles, /\.customer-dashboard-summary>\.customer-communication-summary-card,\.customer-dashboard-summary>\.customer-task-summary-card \{[^}]*grid-column: span 6/);
  assert.match(styles, /\.customer-profile-dialog/);
});

test('Nächste Schritte bleiben auch in einspaltigen Ansichten kompakt', async () => {
  const styles = await file('admin-lead-dashboard.css');
  assert.match(styles, /\.lead-next-card \{ align-self: start; min-height: 0; overflow: hidden; \}/);
  assert.match(styles, /#leadNextSteps \{ align-content: start; display: flex; flex-direction: column;/);
  assert.doesNotMatch(styles, /lead-next-card #leadNextSteps \{ flex: 1 1 auto; \}/);
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
