import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('alle Kunden-Schreibwege prüfen dieselbe zeitbasierte Wochenfreigabe', async () => {
  const [participant, clara, documents, records, gates, control] = await Promise.all([
    source('api/participant-program.js'),
    source('lib/clara/api-handler.js'),
    source('lib/documents/api-handler.js'),
    source('lib/customer-records-service.js'),
    source('api/gates.js'),
    source('api/program-control.js'),
  ]);
  assert.match(participant, /result\.access\.canAccessWeek\(week\)/);
  assert.match(participant, /result\.access\.canAccessWeek\(1\)/);
  assert.match(clara, /program\.access\.canAccessWeek\(week\)/);
  assert.match(documents, /program\.access\.canAccessWeek\(normalizedWeek\)/);
  assert.match(records, /program\.access\.canAccessWeek\(week\)/);
  assert.match(gates, /program\.access\.canAccessWeek\(targetGate\.week\)/);
  assert.match(control, /current\.access\.canAccessWeek\(week\)/);
});

test('Portal- und Admin-Anzeigen beziehen den Wochenstand aus der kanonischen Quelle', async () => {
  const [service, participants, users, dashboard, clara, userAuth] = await Promise.all([
    source('lib/program-access-service.js'),
    source('api/participants.js'),
    source('api/users.js'),
    source('api/leads.js'),
    source('lib/clara/api-handler.js'),
    source('lib/user-auth.js'),
  ]);
  for (const file of [service, participants, users, dashboard]) assert.match(file, /reconcileAccessFromEntries/);
  assert.match(dashboard, /privacy_consent_at,start_commitment_at/);
  assert.match(clara, /source\?\.week \|\| program\.access\.processWeek/);
  assert.match(userAuth, /process_status: 'ONBOARDING', current_week: 0/);
});

test('Datenbankmigration sperrt Zukunftswochen auch bei direktem Schreiben', async () => {
  const migration = await source('supabase/migrations/20260905130000_enforce_program_week_integrity.sql');
  assert.match(migration, /program_week_is_released/);
  assert.match(migration, /Europe\/Berlin/);
  assert.match(migration, /privacy_consent_at is not null/);
  assert.match(migration, /start_commitment_at is not null/);
  for (const table of ['week_gates', 'process_entries', 'participant_documents', 'customer_questions', 'clara_messages', 'participant_memory']) {
    assert.match(migration, new RegExp(table));
  }
  assert.match(migration, /participant_progress_user_profile_unique/);
  assert.match(migration, /raise exception 'Programm-Woche % ist für diesen Teilnehmer noch nicht freigeschaltet\.'/);
  assert.match(migration, /revoke execute on function/);
});

test('Zukunftsdaten werden weder als Klarheitsverlauf noch als Kundendokument ausgeliefert', async () => {
  const [participant, records] = await Promise.all([source('api/participant-program.js'), source('lib/customer-records-service.js')]);
  assert.match(participant, /releasedWeeks\.has\(Number\(item\.week\)\)/);
  assert.match(records, /Number\(document\.week\) === 0 \|\| \(programStarted && program\.access\.canAccessWeek\(document\.week\)\)/);
});
