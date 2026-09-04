import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Command Center besitzt keine fest eingebauten Demo-Kennzahlen mehr', async () => {
  const html = await file('admin.html');
  for (const id of ['dashboardDate', 'dashboardLiveSummary', 'activeCustomerCount', 'dashboardClarityGain', 'dashboardOpenGates', 'dashboardCoachNeeded', 'dashboardAttentionList', 'dashboardWeekCounts']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /Freitag, 28\. August 2026/);
  assert.doesNotMatch(html, /Julia · Entscheidung offen|David · Gate blockiert|Leonie · Abschlusscall/);
  assert.doesNotMatch(html, /<strong>\+4,2<\/strong>|<strong>7<\/strong>\s*<p>3 davon/);
});

test('geschützte Dashboard-API aggregiert die fachlichen Supabase-Echtdaten', async () => {
  const api = await file('api/leads.js');
  assert.match(api, /action === 'command-dashboard'/);
  assert.match(api, /async function commandDashboard/);
  for (const table of ['user_profiles', 'participant_progress', 'clarity_measurements', 'week_gates', 'coach_escalations', 'customer_questions', 'lead_tasks', 'leads', 'lead_communications']) assert.match(api, new RegExp(`rest/v1/${table}`));
  assert.match(api, /required=eq\.true&completed_at=is\.null/);
  assert.match(api, /direction=eq\.inbound&read_at=is\.null/);
  assert.match(api, /completedGains/);
  assert.match(api, /weekDistribution: distribution\.slice\(1\)/);
});

test('Dashboard rendert Live-Metriken, Klarheitskurve, Wochenverteilung und echte Fokusvorgänge', async () => {
  const [script, styles] = await Promise.all([file('admin.js'), file('admin-crm-refresh.css')]);
  for (const fn of ['loadCommandDashboard', 'renderCommandDashboard', 'renderDashboardClarity', 'renderDashboardDistribution', 'renderDashboardAttention']) assert.match(script, new RegExp(`function ${fn}`));
  assert.match(script, /fetch\('\/api\/leads\?action=command-dashboard'\)/);
  assert.match(script, /openDashboardAction/);
  assert.match(styles, /\.dashboard-live-state/);
  assert.match(styles, /#dashboardClarityPoints/);
  assert.match(styles, /article\[data-dashboard-action\]/);
});
