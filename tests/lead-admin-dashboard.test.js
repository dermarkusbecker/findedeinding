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

test('Die Zweitnavigation öffnet eigenständige Interessenten-Seiten und startet das Verkaufsgespräch direkt', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-lead-dashboard.css')]);
  for (const page of ['overview', 'conversation', 'messages', 'contracts', 'finance', 'bank', 'tasks', 'notes']) {
    assert.match(html, new RegExp(`data-lead-page="${page}"`));
    assert.match(script, new RegExp(`'${page}'`));
  }
  assert.equal((html.match(/data-lead-page="/g) || []).length, 8);
  assert.match(script, /let leadDashboardPage = 'overview'/);
  assert.match(script, /function setLeadDashboardPage/);
  assert.match(script, /data-context-leads=/);
  assert.match(script, /if\(page==='conversation'\)openLeadEditor\(activeLeadDashboard\.lead\.id\)/);
  assert.match(script, /function setLeadDashboardPage[\s\S]*?behavior:'auto'/);
  assert.match(styles, /\.lead-dashboard-page\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(styles, /\.lead-detail-page \.lead-dashboard-card\s*\{[^}]*grid-column:\s*1\/-1/);
});

test('Verkaufsgespräch erfasst nur die klaren Kontaktdaten mit bedingter WhatsApp-Pflicht', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css')]);
  assert.match(html, /<section class="lead-basics lead-wizard-page" data-lead-step="1">/);
  for (const name of ['firstName', 'lastName', 'email', 'mobilePhone']) assert.match(html, new RegExp(`name="${name}"[^>]*required`));
  assert.match(html, /name="hasAlternateWhatsapp"/);
  assert.match(html, /id="leadWhatsappField" hidden/);
  assert.doesNotMatch(html.slice(html.indexOf('data-lead-step="1"'),html.indexOf('data-lead-step="2"')), /Anliegen des Interessenten|Interne Notizen|lead-status-field/);
  assert.match(styles, /#leadDialog\.lead-dialog \{[^}]*max-width: 920px;[^}]*overflow: hidden;[^}]*width: calc\(100% - 36px\);/);
  assert.match(styles, /#leadDialog \.lead-contact-grid label \{[^}]*font-size: 12px/);
  assert.match(styles, /#leadDialog \.lead-whatsapp-field \{[^}]*grid-column: 1\/-1/);
  assert.equal((html.match(/data-lead-step="[1-4]"/g)||[]).length,4);
  assert.match(html, /id="leadStepBack"[^>]*hidden/);
  assert.match(html, /id="leadStepNext">Weiter →/);
  assert.match(html, /id="leadStepSave"[^>]*hidden>Verkaufsgespräch abschließen/);
  assert.match(script, /function setLeadWizardStep/);
  assert.match(script, /function validateLeadWizardStep/);
  assert.match(script, /setLeadWizardStep\(leadWizardStep\+1\)/);
  assert.match(styles, /\.lead-wizard-progress ol \{[^}]*grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(script, /function setAlternateWhatsapp/);
  assert.match(script, /whatsappSameAsMobile=!leadForm\.elements\.hasAlternateWhatsapp\.checked/);
});

test('Terminseite zeigt konfigurierte Dauern und führt erst über Tag, dann freie Uhrzeit', async () => {
  const [html, script, styles, api, migration] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css'), file('api/leads.js'), file('supabase/migrations/20260910120000_sales_conversation_contact_and_booking.sql')]);
  assert.match(html, /id="availableDays"/);
  assert.match(html, /id="availableTimes"/);
  assert.match(html, /name="offeredDuration" value="30"/);
  assert.doesNotMatch(html, /id="demoAppointmentSlots"/);
  assert.match(script, /function renderAvailableTimes/);
  assert.match(script, /settings\.offeredDurations/);
  assert.match(styles, /#leadDialog \.appointment-slot-picker/);
  assert.match(api, /offered_durations: settings\.offeredDurations/);
  assert.match(migration, /offered_durations integer\[\]/);
});

test('Terminbestätigung wird erst beim vollständigen Abschluss des Verkaufsgesprächs ausgelöst', async () => {
  const [html, script, communication, api, migration] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-communication-center.js'), file('api/leads.js'), file('supabase/migrations/20260910120000_sales_conversation_contact_and_booking.sql')]);
  assert.match(script, /action=complete-sales-conversation/);
  assert.match(api, /action === 'complete-sales-conversation'/);
  assert.match(api, /appointment_confirmation_prepared_at/);
  assert.match(api, /notifyAttendees: false/);
  assert.match(api, /notifyAttendees: true/);
  assert.match(html, /value="sales_conversation_completed">Verkaufsgespräch abgeschlossen/);
  assert.match(communication, /sales_conversation_completed:'Verkaufsgespräch abgeschlossen'/);
  assert.match(migration, /sales_conversation_appointment_confirmation/);
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
  assert.match(script, /later:'Später Interesse'/);
  assert.match(styles, /\.lead-context-group\s*\{/);
  assert.match(styles, /\.lead-context-filter\.active/);
  assert.match(api, /'offer', 'later', 'customer'/);
  assert.match(api, /\['customer', 'lost', 'later'\]/);
  assert.match(schema, /'offer', 'later', 'customer'/);
  assert.match(migration, /leads_status_check/);
  assert.match(migration, /'later'/);
});

test('Interessenentscheidung ordnet Listen zu und erzeugt eine zentrale Wiedervorlage', async () => {
  const [html, script, styles, api, migration] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('admin-lead-dashboard.css'),
    file('api/leads.js'),
    file('supabase/migrations/20260910173000_lead_interest_follow_up.sql'),
  ]);
  assert.match(html, /id="markLeadLost"[^>]*>Kein Interesse/);
  assert.match(html, /id="markLeadLater"[^>]*>Später Interesse/);
  assert.match(html, /Wann sollen wir Dich nochmal kontaktieren\?/);
  assert.match(html, /name="followUpDate" type="date" required/);
  assert.match(styles, /\.lead-follow-up-dialog::backdrop/);
  assert.match(script, /action=set-interest-status/);
  assert.match(script, /setLeadListFilter\(status\)/);
  assert.match(api, /async function setLeadInterestStatus/);
  assert.match(api, /rpc\/set_lead_interest_status/);
  assert.match(migration, /task_type = 'lead_follow_up'/);
  assert.match(migration, /'Wiedervorlage: Interessenten erneut kontaktieren'/);
  assert.match(migration, /update public\.leads[\s\S]*set status = p_status/);
});

test('CRM-Akte unterstützt Verträge, Zahlungen, E-Mail, Aufgaben, Notizen und Bankdaten', async () => {
  const [script, api, migration] = await Promise.all([file('admin.js'), file('api/leads.js'), file('supabase/migrations/20260904190000_lead_admin_dashboard.sql')]);
  for (const recordType of ['contract', 'payment', 'communication', 'task', 'bank', 'note']) assert.match(script, new RegExp(`${recordType}:\\{`));
  assert.match(api, /action === 'dashboard'/);
  assert.match(api, /action === 'dashboard-record'/);
  for (const table of ['lead_contracts', 'lead_payments', 'lead_communications', 'lead_tasks', 'lead_bank_accounts', 'customer_questions']) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
});

test('Vertragsnummern werden zentral, fortlaufend und ohne manuelle Eingabe vergeben', async () => {
  const [script, api, migration] = await Promise.all([
    file('admin.js'),
    file('api/leads.js'),
    file('supabase/migrations/20260910170000_automatic_contract_numbers.sql'),
  ]);
  assert.doesNotMatch(script, /name="contractNumber"/);
  assert.match(script, /Schema: FDD–Jahr–laufende Nummer/);
  assert.match(api, /async function reserveContractNumber/);
  assert.match(api, /rpc\/next_contract_number/);
  assert.doesNotMatch(api, /crypto\.randomInt/);
  assert.match(migration, /create table if not exists public\.contract_number_counters/);
  assert.match(migration, /return format\('FDD-%s-%s'/);
  assert.match(migration, /create unique index if not exists lead_contracts_contract_number_unique/);
  assert.match(migration, /create trigger lead_contracts_assign_contract_number/);
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
  assert.match(participantsApi, /createManualCustomer/);
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
