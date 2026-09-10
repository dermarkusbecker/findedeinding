import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Einstellungen enthalten eine zentrale Tarifverwaltung mit vollständigen Vertragsdaten', async () => {
  const [html, script, styles] = await Promise.all([file('admin.html'), file('admin.js'), file('admin-crm-refresh.css')]);
  assert.match(html, /data-settings-tab="tariffs"/);
  assert.match(html, /data-settings-panel="tariffs"/);
  assert.match(html, /id="tariffList"/);
  assert.match(html, /id="tariffDialog"/);
  for (const name of ['name', 'productLabel', 'durationLabel', 'grossPrice', 'paymentModel', 'paymentDue', 'isActive', 'isDefault']) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(script, /function loadServiceTariffs/);
  assert.match(script, /function renderServiceTariffs/);
  assert.match(script, /action=tariff/);
  assert.match(styles, /\.tariff-list/);
  assert.match(styles, /\.tariff-form-grid/);
});

test('Aktive Tarife befüllen jeden Vertragsabschluss aus derselben Datenbasis', async () => {
  const [html, script, api, contract, migration] = await Promise.all([
    file('admin.html'),
    file('admin.js'),
    file('api/leads.js'),
    file('lib/video-contract.js'),
    file('supabase/migrations/20260910190000_service_tariffs.sql'),
  ]);
  assert.match(html, /id="videoContractTariff"/);
  assert.match(script, /function applyTariffToVideoContract/);
  assert.match(script, /function applyTariffToLeadContract/);
  assert.match(script, /Tarif<select name="tariffId" required/);
  for (const field of ['product', 'duration', 'totalPrice', 'paymentModel', 'paymentDue']) assert.match(script, new RegExp(`elements\\.${field}\\.value=tariff`));
  assert.match(script, /tariffId:values\.tariffId/);
  assert.match(contract, /tariffId: clean\(input\.tariffId/);
  assert.match(api, /async function serviceTariffs/);
  assert.match(api, /async function saveServiceTariff/);
  assert.match(api, /tariff_id: uuidValid\(normalized\.contract\.tariffId\)/);
  assert.match(api, /tariff_id: tariff\.id/);
  assert.match(migration, /create table if not exists public\.service_tariffs/);
  assert.match(migration, /'fdd-8-wochen'/);
  assert.match(migration, /add column if not exists tariff_id uuid references public\.service_tariffs/);
});
