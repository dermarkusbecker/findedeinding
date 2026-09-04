import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Interessenten öffnen eine vollständige CRM-Detailakte statt nur eines Bearbeitungsdialogs', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-lead-dashboard.css')]);
  for (const id of ['leadDashboard', 'leadDashboardOverview', 'leadSalesCallCard', 'leadFinanceCard', 'leadCommunicationCard', 'leadContractsCard', 'leadTasksCard', 'leadNotesCard', 'leadBankCard']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /openLeadDashboard/);
  assert.match(script, /renderLeadDashboard/);
  assert.match(script, /renderSalesCallCard/);
  assert.match(script, /openLeadSalesCall/);
  assert.match(script, /Akte öffnen/);
  assert.match(styles, /\.lead-dashboard-grid/);
  assert.match(styles, /\.lead-task-card,\.lead-notes-card,\.lead-bank-card,\.lead-next-card\s*\{[^}]*grid-column:\s*span 6;/s);
  assert.doesNotMatch(styles, /\.lead-(?:task|bank)-card\s*\{\s*grid-column:\s*span 7;/);
  assert.match(styles, /\.lead-profile-hero/);
  assert.match(styles, /\.lead-sales-call-card/);
  assert.doesNotMatch(html.slice(html.indexOf('id="leadDashboard"'), html.indexOf('data-panel="settings"')), /Wirtschaftliche Verhältnisse/i);
});

test('Interessenten-Navigation bildet Eingang, aktive Fälle, kein und späteres Interesse mit Echtdaten ab', async () => {
  const [html, script, styles, api, schema, migration] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('admin-crm-refresh.css'),
    file('api/leads.js'),
    file('supabase/schema.sql'),
    file('supabase/migrations/20260904235900_lead_interest_navigation.sql'),
  ]);
  assert.match(script, /groups:\[\{label:'Gewinnung'/);
  for (const label of ['Eingang', 'Aktive Interessenten', 'Kein Interesse', 'Später Interesse']) assert.match(script, new RegExp(label));
  assert.match(script, /function leadNavigationCounts/);
  assert.match(script, /function setLeadListFilter/);
  assert.match(script, /function resetLeadListView/);
  assert.match(script, /lead\.converted_user_profile_id\|\|lead\.status==='customer'/);
  assert.match(script, /renderContextNavigation\('leads'\)/);
  assert.match(html, /id="leadListSearch"/);
  assert.match(html, /option value="later">Später Interesse/);
  assert.match(styles, /\.lead-context-group\s*\{/);
  assert.match(styles, /\.lead-context-filter\.active/);
  assert.match(api, /'offer', 'later', 'customer'/);
  assert.match(api, /\['customer', 'lost', 'later'\]/);
  assert.match(schema, /'offer', 'later', 'customer'/);
  assert.match(migration, /leads_status_check/);
  assert.match(migration, /'later'/);
});

test('CRM-Akte unterstützt Verträge, Zahlungen, E-Mail, Aufgaben, Notizen und Bankdaten', async () => {
  const [script, api, migration] = await Promise.all([file('admin.js'), file('api/leads.js'), file('supabase/migrations/20260904190000_lead_admin_dashboard.sql')]);
  for (const recordType of ['contract', 'payment', 'communication', 'task', 'bank', 'note']) assert.match(script, new RegExp(`${recordType}:\\{`));
  assert.match(api, /action === 'dashboard'/);
  assert.match(api, /action === 'dashboard-record'/);
  for (const table of ['lead_contracts', 'lead_payments', 'lead_communications', 'lead_tasks', 'lead_bank_accounts', 'customer_questions']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
});

test('Fragen aus dem Acht-Wochen-Portal werden serverseitig an die Admin-Akte übergeben', async () => {
  const [portal, handler, admin] = await Promise.all([file('portal.js'), file('api/participant-program.js'), file('admin.js')]);
  assert.match(portal, /action: 'support_question'/);
  assert.match(handler, /action === 'support_question'/);
  assert.match(handler, /customer_questions/);
  assert.match(admin, /fragen aus 8 Wochen/i);
  assert.match(admin, /answer_question/);
});

test('Ein Lead wird erst nach unterschriebenem Dokument und Videovertrag automatisch Teilnehmer', async () => {
  const [html, script, api, participantsApi, usersApi, auth, migration] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('api/leads.js'),
    file('api/participants.js'),
    file('api/users.js'),
    file('lib/user-auth.js'),
    file('supabase/migrations/20260904200000_contract_activation_lifecycle.sql'),
  ]);
  assert.match(script, /documentConfirmed/);
  assert.match(script, /videoContractConfirmed/);
  assert.match(script, /participantActivated/);
  assert.match(api, /status === 'signed' && documentConfirmed && videoContractConfirmed/);
  assert.match(api, /activateContractedLead/);
  assert.match(api, /Teilnehmer-Aktivierung gesperrt/);
  assert.match(api, /status === 'customer' && !current\.converted_user_profile_id/);
  assert.match(migration, /document_confirmed_at/);
  assert.match(migration, /video_contract_confirmed_at/);
  assert.match(migration, /program_start_date/);
  assert.doesNotMatch(html, /id="convertLead"/);
  assert.match(participantsApi, /ausschließlich nach einem vollständig bestätigten Lead-Vertragsabschluss/);
  assert.doesNotMatch(usersApi, /ensureProgram/);
  assert.match(usersApi, /Teilnehmerzugänge entstehen ausschließlich automatisch/);
  assert.doesNotMatch(auth, /Demo Kunde/);
});

test('Teilnehmerlisten enthalten keine fest eingebauten Demo-Datensätze', async () => {
  const [script, html] = await Promise.all([file('admin.js'), file('admin.html')]);
  assert.match(script, /let participants = \[\];/);
  assert.doesNotMatch(script, /demoParticipants|demo-/);
  assert.doesNotMatch(html, /participantNavCount/);
  assert.match(html, /id="activeCustomerCount">0</);
});
