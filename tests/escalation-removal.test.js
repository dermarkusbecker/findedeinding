import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activeFiles = [
  'admin.html',
  'admin.js',
  'admin-crm-refresh.css',
  'api/leads.js',
  'lib/clara/prompts.js',
  'lib/gate-templates.js',
  'lib/guided-weeks.js',
  'lib/system-registry.js',
  'supabase/schema.sql',
];

test('aktive CRM-Oberfläche und Fachlogik enthalten keine Eskalationsfunktion mehr', async () => {
  const sources = await Promise.all(activeFiles.map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (let index = 0; index < sources.length; index += 1) {
    assert.doesNotMatch(sources[index], /eskalation|escalation|coachNeeded|dashboardCoach/i, activeFiles[index]);
  }
});
