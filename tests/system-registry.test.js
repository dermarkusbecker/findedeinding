import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemRegistry } from '../lib/system-registry.js';

test('Systemregister zeigt aktive Google-, Supabase- und OpenAI-Dienste getrennt', () => {
  const registry = buildSystemRegistry({
    googleConfigured: true,
    googleConnection: { connected_email: 'admin@example.com' },
    openaiConfigured: true,
    openaiModel: 'test-model',
    checkedAt: '2026-09-04T10:00:00.000Z',
  });
  const byId = Object.fromEntries(registry.integrations.map((item) => [item.id, item]));
  assert.equal(byId.supabase.status.key, 'active');
  assert.equal(byId.openai.status.key, 'active');
  assert.equal(byId.google_calendar.status.key, 'active');
  assert.equal(byId.google_meet.status.key, 'active');
  assert.match(byId.google_calendar.detail, /admin@example\.com/);
  assert.equal(registry.summary.activeIntegrations, 4);
});

test('Systemregister unterscheidet fehlende Konfiguration und geplanten Ausbau', () => {
  const registry = buildSystemRegistry({ googleConfigured: false, openaiConfigured: false });
  assert.equal(registry.integrations.find((item) => item.id === 'google_calendar').status.key, 'missing');
  assert.equal(registry.integrations.find((item) => item.id === 'crm_email').status.key, 'planned');
  assert.equal(registry.agents.find((item) => item.id === 'situation_recognition').status.key, 'missing');
  assert.equal(registry.agents.find((item) => item.id === 'decision_escalation').status.key, 'planned');
  assert.ok(registry.summary.planned >= 5);
});

test('Systemregister listet die tatsächlich implementierten KI-Aufgaben nachvollziehbar', () => {
  const registry = buildSystemRegistry({ openaiConfigured: true });
  const activeAgents = registry.agents.filter((item) => item.status.key === 'active');
  assert.deepEqual(activeAgents.map((item) => item.id), ['clara_dialog', 'situation_recognition', 'career_recognition']);
  assert.match(activeAgents.find((item) => item.id === 'situation_recognition').situation, /Intentionen.*Themen.*Spannungen/);
});
