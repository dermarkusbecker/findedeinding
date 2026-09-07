import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Demo-Vollzugriff ist als einzelnes Kundenmerkmal verdrahtet und gewährt keine CRM-Adminrolle', async () => {
  const [service, portal, participants, users, dashboard] = await Promise.all([
    file('lib/program-access-service.js'),
    file('portal.js'),
    file('api/participants.js'),
    file('api/users.js'),
    file('api/leads.js'),
  ]);
  assert.match(service, /fullProgramAccess: profiles\[0\]\.permissions\?\.includes\('demo_full_access'\)/);
  assert.match(participants, /participant\.permissions\?\.includes\('demo_full_access'\)/);
  assert.match(users, /fullProgramAccess: user\.permissions\?\.includes\('demo_full_access'\)/);
  assert.match(dashboard, /fullProgramAccess: profile\?\.permissions\?\.includes\('demo_full_access'\)/);
  assert.match(portal, /Demo-Modus · alle Wochen offen/);
  assert.match(portal, /Im Demo-Modus sofort verfügbar/);
  assert.doesNotMatch(service, /role=eq\.admin/);
});
