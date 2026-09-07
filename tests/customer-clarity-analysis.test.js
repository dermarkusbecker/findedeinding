import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackCustomerClarityAnalysis } from '../lib/customer-clarity-agent.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Klarheitsanalyse liegt in der zweiten Navigation der Kundenakte und nicht mehr in der Hauptnavigation', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css')]);
  assert.doesNotMatch(html, /data-view="clarity"/);
  assert.match(html, /data-customer-page="clarity"/);
  assert.match(script, /label:'Prozess & Erkenntnisse'/);
  assert.match(script, /\['Klarheitsanalyse','KI-Synthese & Gesprächsansätze'/);
  assert.match(script, /function renderCustomerClarity/);
  assert.match(styles, /\.customer-clarity-workspace/);
  assert.match(styles, /\.customer-guidance-grid/);
});

test('Analyse nutzt ausschließlich freigegebene Wochen und liefert kanalspezifische Gesprächsansätze', () => {
  const analysis = fallbackCustomerClarityAnalysis({ participantName: 'Test Kunde', processWeeks: [
    { week: 1, title: 'Ausgangslage', accessible: true, answers: [{ label: 'Klarheits-Baseline', value: '3 von 10' }, { label: 'Ziel', value: 'Mehr Zeit für sinnvolle Arbeit' }] },
    { week: 2, title: 'Fähigkeiten', accessible: true, answers: [{ label: 'Klarheits-Check-in', value: '5 von 10' }, { label: 'Stärke', value: 'Komplexes verständlich erklären' }] },
    { week: 3, title: 'Motivatoren', accessible: false, answers: [{ label: 'Gesperrt', value: 'DARF NICHT ERSCHEINEN' }] },
  ] });
  assert.equal(analysis.clarityTrajectory.start, 3);
  assert.equal(analysis.clarityTrajectory.current, 5);
  assert.equal(analysis.clarityTrajectory.change, 2);
  assert.equal(JSON.stringify(analysis).includes('DARF NICHT ERSCHEINEN'), false);
  assert.ok(analysis.conversationGuidance.meet.length);
  assert.ok(analysis.conversationGuidance.phone.length);
  assert.ok(analysis.conversationGuidance.whatsapp.length);
  assert.match(analysis.boundaries.join(' '), /keine Diagnose/i);
});

test('Klarheitsagent wird beleggebunden gespeichert und im CRM-Systemregister ausgewiesen', async () => {
  const [agent, api, registry, migration] = await Promise.all([file('lib/customer-clarity-agent.js'), file('api/program-control.js'), file('lib/system-registry.js'), file('supabase/migrations/20260907160000_customer_clarity_analysis.sql')]);
  assert.match(agent, /releasedProcessWeeks/);
  assert.match(agent, /source_fingerprint/);
  assert.match(agent, /store: false/);
  assert.match(agent, /Erfinde keine Fakten/);
  assert.match(api, /ensureCustomerClarityAnalysis/);
  assert.match(registry, /customer_clarity/);
  assert.match(migration, /customer_clarity_analyses/);
  assert.match(migration, /user_profile_id uuid not null unique/);
});
