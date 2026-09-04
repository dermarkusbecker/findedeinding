import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Interessenten öffnen eine vollständige CRM-Detailakte statt nur eines Bearbeitungsdialogs', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-lead-dashboard.css')]);
  for (const id of ['leadDashboard', 'leadDashboardOverview', 'leadFinanceCard', 'leadCommunicationCard', 'leadContractsCard', 'leadTasksCard', 'leadNotesCard', 'leadBankCard']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /openLeadDashboard/);
  assert.match(script, /renderLeadDashboard/);
  assert.match(script, /Dashboard öffnen/);
  assert.match(styles, /\.lead-dashboard-grid/);
  assert.match(styles, /\.lead-profile-hero/);
  assert.doesNotMatch(html.slice(html.indexOf('id="leadDashboard"'), html.indexOf('data-panel="users"')), /Wirtschaftliche Verhältnisse/i);
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
