import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStepTransition, processEligibleStateSuggestions, sanitizeClaraProcessMessage } from '../lib/clara/process-policy.js';

const saveSuggestion = { action: 'save_guided_answer', payload: { step_id: 'education', answer: 'Ausbildung', items: [] } };

test('offene Clara-Rückfrage blockiert jeden automatischen Prozesssprung', () => {
  const suggestions = processEligibleStateSuggestions({
    needs_followup: true,
    step_status: 'needs_clarification',
    next_action: { type: 'stay', step: 'education' },
    suggested_state_updates: [saveSuggestion],
  });
  assert.deepEqual(suggestions, []);
});

test('vollständig geklärter Baustein gibt exakt die validierbare Speicheraktion frei', () => {
  const suggestions = processEligibleStateSuggestions({
    needs_followup: false,
    step_status: 'completed',
    next_action: { type: 'advance_if_valid', step: 'education' },
    suggested_state_updates: [saveSuggestion],
  });
  assert.deepEqual(suggestions, [saveSuggestion]);
});

test('Nächster Schritt wird erst nach einem echten State-Übergang freigegeben', () => {
  const blocked = buildStepTransition({ beforeState: { current_step: 'education' }, afterState: { current_step: 'education' }, nextPrompt: 'Nächste Frage' });
  const ready = buildStepTransition({ beforeState: { current_step: 'education' }, afterState: { current_step: 'informal_skills' }, nextPrompt: 'Welche informellen Fähigkeiten hast du?' });
  assert.equal(blocked.ready, false);
  assert.equal(ready.ready, true);
  assert.equal(ready.toStep, 'informal_skills');
});

test('Clara entfernt Ausblicke auf spätere Wochen aus ihrer Antwort', () => {
  const clean = sanitizeClaraProcessMessage('Danke, das ist vollständig. Nächste Woche schauen wir auf deine Motivatoren. Bleiben wir bei diesem Ergebnis.', 2);
  assert.equal(clean, 'Danke, das ist vollständig.\n\nBleiben wir bei diesem Ergebnis.');
  assert.doesNotMatch(sanitizeClaraProcessMessage('In Woche 5 geht es um Werte. Deine Antwort ist gespeichert.', 2), /Woche 5/);
});
