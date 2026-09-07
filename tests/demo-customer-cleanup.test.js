import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = () => readFile(new URL('../supabase/migrations/20260907170000_remove_demo_customer_accounts.sql', import.meta.url), 'utf8');

test('Freigegebener Live-Start entfernt Kunden und nur deren 1:1 verknüpfte Interessenten', async () => {
  const sql = await migration();
  assert.match(sql, /where profile\.role = 'user'/);
  assert.match(sql, /profile\.source_lead_id/);
  assert.match(sql, /lead\.converted_user_profile_id = any\(customer_profile_ids\)/);
  assert.match(sql, /delete from auth\.users/);
  assert.match(sql, /Customer cleanup incomplete: customer profiles remain/);
  assert.doesNotMatch(sql, /where profile\.role = 'admin'/);
  assert.doesNotMatch(sql, /truncate/i);
});

test('Supabase-Datenbankbereinigung überlässt Binärdateien ausdrücklich der Storage-API', async () => {
  const sql = await migration();
  assert.doesNotMatch(sql, /delete from storage\.objects/);
  assert.match(sql, /delete from public\.user_profiles/);
});
