import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  gateTemplates,
  gateTemplateSettingRows,
  gateWeekDefaults,
  gateWeekSettingRows,
  participantGateRows,
} from '../lib/gate-templates.js';

test('Gate-Konfiguration deckt Start und alle acht Wochen eindeutig ab', () => {
  assert.deepEqual(gateWeekDefaults.map((item) => item.week), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(gateWeekSettingRows().length, 9);
  assert.equal(gateTemplateSettingRows().length, gateTemplates.length);
  assert.equal(new Set(gateTemplateSettingRows().map((item) => item.gate_key)).size, gateTemplates.length);
  assert.equal(participantGateRows('kunde-1').length, gateTemplates.length);
});

test('Gate-Einstellungen sind admin-geschützt und aktualisieren auch bestehende Kunden', async () => {
  const api = await readFile(new URL('../api/gates.js', import.meta.url), 'utf8');
  assert.match(api, /requireCurrentAdmin/);
  assert.match(api, /action\s*===\s*'settings'/);
  assert.match(api, /gate_week_settings/);
  assert.match(api, /gate_template_settings/);
  assert.match(api, /week_gates\?week=eq\./);
  assert.match(api, /action\s*===\s*'reset'/);
  assert.match(api, /allowed\.some/);
});

test('Supabase-Migration schützt zukünftige Gate-Bezeichnungen per Insert-Trigger', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260904140000_gate_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.gate_week_settings/);
  assert.match(migration, /create table if not exists public\.gate_template_settings/);
  assert.match(migration, /before insert on public\.week_gates/);
  assert.match(migration, /apply_gate_template_label/);
  assert.match(migration, /enable row level security/);
});
