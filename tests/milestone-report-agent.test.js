import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackMilestoneReport, generateMilestoneReport, milestoneSources } from '../lib/milestone-report-agent.js';

const definition = { weeks: Array.from({ length: 8 }, (_, index) => ({ title: `Woche ${index + 1}`, steps: [{ id: `step_${index + 1}`, title: 'Meine Gedanken' }] })) };
const curriculum = Array.from({ length: 8 }, (_, index) => ({ week: index + 1, step_id: `step_${index + 1}`, status: 'completed', messages: [{ role: 'user', content: index === 7 ? 'Ich plane für Montag ein Gespräch.' : `Meine Beobachtung ${index + 1}` }], summary: `Ergebnis ${index + 1}` }));

test('Zwischenbericht nutzt nur abgeschlossene Wochen 1 bis 4', () => {
  const sources = milestoneSources({ milestoneWeek: 4, definition, curriculum });
  assert.equal(sources.length, 4);
  assert.equal(sources[3].lessons[0].statements[0], 'Meine Beobachtung 4');
  assert.doesNotMatch(JSON.stringify(sources), /Montag/);
});

test('Ersatzbericht behauptet geplante Umsetzung nicht als Erfolg', () => {
  const guidedStates = new Map([[8, { clarity_checkin: { score: 7, note: 'Ich sehe meinen nächsten Schritt.' } }]]);
  const sources = milestoneSources({ milestoneWeek: 8, definition, curriculum, weekOneState: { clarity_baseline: { score: 3 } }, guidedStates });
  const report = fallbackMilestoneReport({ milestoneWeek: 8, sources });
  assert.match(report.implementation, /Ob die Schritte bereits umgesetzt wurden.*nicht automatisch belegt/);
  assert.match(report.development, /Woche 1 bei 3.*Woche 8 bei 7/);
  assert.equal(report.evidence.length, 8);
});

test('Bestehende OpenAI-Schnittstelle erstellt strukturierte, nicht gespeicherte Berichte', async () => {
  let request;
  const client = { responses: { create: async (input) => { request = input; return { model: 'test-model', output_text: JSON.stringify({ title: 'Dein Bericht', introduction: 'Einleitung', situation: 'Ausgangslage', insights: ['Beobachtung'], development: 'Entwicklung', implementation: 'Noch offen', nextSteps: ['Prüfen'], evidence: ['Woche 1: Beobachtung'] }) }; } } };
  const report = await generateMilestoneReport({ participantId: 'test', participantName: 'Kunde', milestoneWeek: 4, sources: milestoneSources({ milestoneWeek: 4, definition, curriculum }), client, env: { OPENAI_API_KEY: 'test', CLARA_OPENAI_MODEL: 'test-model' } });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema');
  assert.match(request.instructions, /Unterscheide Wunsch, Plan, Versuch und tatsächlich belegte Umsetzung/);
  assert.equal(report.generator, 'openai');
});
