import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWeekOneAction, createWeekOneState, missingWeekOneRequirements, stepStatuses, validateMinWords, weekOneComplete, WEEK_ONE_STEPS } from '../lib/week-one.js';

const validWishes = [
  'Ich möchte finanziell endlich viel freier leben.',
  'Ich wünsche mir eine Arbeit mit echter Bedeutung.',
  'Ich möchte wieder mehr Zeit für mich haben.',
];

function moveThroughWishes(state = createWeekOneState()) {
  let result = applyWeekOneAction(state, { type: 'save_wishes', wishes: validWishes });
  for (let index = 0; index < 3; index += 1) result = applyWeekOneAction(result.state, { type: 'save_wish_followup', wishIndex: index, answer: 'Dann würde ich mich sicherer und deutlich zufriedener fühlen.' });
  return result.state;
}

test('Wunsch mit einem Wort wird freundlich abgelehnt', () => {
  assert.deepEqual(validateMinWords('Geld').reason, 'TOO_SHORT');
});

test('Wunsch mit mindestens sechs Wörtern wird formal akzeptiert', () => {
  assert.equal(validateMinWords(validWishes[0]).valid, true);
});

test('nur zwei Wünsche starten keine Vertiefung', () => {
  const result = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes.slice(0, 2) });
  assert.equal(result.ok, false);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.ENTRY);
});

test('drei gültige Wünsche starten mit Wunsch 1', () => {
  const result = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes });
  assert.equal(result.ok, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_1);
});

test('eine konkrete Vertiefungsantwort führt ohne Fragenbatterie zu Wunsch 2', () => {
  const collected = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes }).state;
  const result = applyWeekOneAction(collected, { type: 'save_wish_followup', wishIndex: 0, answer: 'Ich könnte meine Rechnungen ruhig bezahlen und hätte weniger Angst.' });
  assert.equal(result.state.wishes[0].completed, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_2);
  assert.equal(result.state.wishes[0].followup_count, 1);
});

test('Weiß nicht löst eine sinnvolle weitere Konkretisierung aus', () => {
  const collected = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes }).state;
  const result = applyWeekOneAction(collected, { type: 'save_wish_followup', wishIndex: 0, answer: 'Weiß nicht.' });
  assert.equal(result.state.wishes[0].completed, false);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_1);
});

test('Rohwunsch bleibt bei strukturierter Vertiefung unverändert', () => {
  const collected = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes }).state;
  const result = applyWeekOneAction(collected, { type: 'save_wish_followup', wishIndex: 0, answer: 'Ich möchte ohne dauernde Geldsorgen ruhig schlafen können.' });
  assert.equal(result.state.wishes[0].raw_wish, validWishes[0]);
  assert.match(result.state.wishes[0].emotional_meaning, /ruhig schlafen/);
});

test('zu kurzes FDD-Ziel wird abgelehnt', () => {
  const result = applyWeekOneAction(moveThroughWishes(), { type: 'save_target', answer: 'Ich will Klarheit.' });
  assert.equal(result.ok, false);
  assert.equal(result.details.reason, 'TOO_SHORT');
});

test('formal gültiges aber abstraktes Klarheitsziel wird konkretisiert', () => {
  const result = applyWeekOneAction(moveThroughWishes(), { type: 'save_target', answer: 'Ich möchte danach einfach viel mehr Klarheit haben.' });
  assert.equal(result.ok, true);
  assert.equal(result.state.fdd_target.completed, false);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.TARGET_CLARIFY);
});

test('Klarheitswert wird gespeichert und optionale Begründung bleibt optional', () => {
  const state = createWeekOneState();
  state.current_step = WEEK_ONE_STEPS.CLARITY;
  const result = applyWeekOneAction(state, { type: 'save_clarity', score: 7 });
  assert.equal(result.state.clarity_baseline.score, 7);
  assert.equal(result.state.clarity_baseline.completed, true);
  assert.equal(result.state.clarity_baseline.reason_raw, '');
});

test('CV-Upload allein schließt den beruflichen Weg nicht ab', () => {
  const result = applyWeekOneAction(createWeekOneState(), { type: 'cv_uploaded', fileName: 'lebenslauf.pdf' });
  assert.equal(result.state.career_history.cv_uploaded, true);
  assert.equal(result.state.career_history.completed, false);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.CAREER_CV);
});

test('ohne Lebenslauf kann der berufliche Schritt nicht umgangen werden', () => {
  const result = applyWeekOneAction(createWeekOneState(), { type: 'choose_career_dialog' });
  assert.equal(result.ok, false);
  assert.equal(result.details.reason, 'CV_REQUIRED');
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.ENTRY);
});

test('Lebenslauf muss nach erfolgreichem Upload ausdrücklich bestätigt werden', () => {
  let result = applyWeekOneAction(createWeekOneState(), { type: 'confirm_cv_upload' });
  assert.equal(result.ok, false);
  assert.equal(result.details.reason, 'CV_REQUIRED');
  result = applyWeekOneAction(createWeekOneState(), { type: 'cv_uploaded', fileName: 'lebenslauf.pdf', fileId: 'cv-1' });
  result = applyWeekOneAction(result.state, { type: 'confirm_cv_upload' });
  assert.equal(result.ok, true);
  assert.equal(result.state.career_history.participant_confirmed, true);
  assert.equal(result.state.career_history.completed, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.REVIEW);
});

test('Woche 1 spricht keine vorschnelle Berufsempfehlung aus', () => {
  const collected = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes }).state;
  const result = applyWeekOneAction(collected, { type: 'save_wish_followup', wishIndex: 0, answer: 'Welcher Beruf passt deiner Meinung nach zu mir?' });
  assert.equal(result.ok, false);
  assert.equal(result.details.reason, 'NO_EARLY_RECOMMENDATION');
  assert.match(result.error, /Puzzleteile/);
});

test('Woche 1 bleibt bei fehlendem Pflichtschritt oder Commitment gesperrt', () => {
  const state = createWeekOneState();
  assert.equal(weekOneComplete(state, { privacyConsent: true, startCommitment: true }), false);
  const statuses = stepStatuses(state);
  assert.equal(statuses.filter((step) => step.status === 'completed').length, 0);
});

test('alle fachlichen Schritte und beide Voraussetzungen schließen Woche 1 ab', () => {
  const state = moveThroughWishes();
  state.fdd_target.completed = true;
  state.clarity_baseline = { score: 7, reason_raw: '', completed: true };
  state.career_history.cv_uploaded = true;
  state.career_history.completed = true;
  assert.equal(weekOneComplete(state, { privacyConsent: true, startCommitment: true }), true);
  assert.equal(weekOneComplete(state, { privacyConsent: true, startCommitment: false }), false);
});

test('Reload kann mit gespeichertem State an der offenen Stelle fortsetzen', () => {
  const state = moveThroughWishes();
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(reloaded.current_step, WEEK_ONE_STEPS.TARGET);
  assert.equal(reloaded.wishes.every((wish) => wish.completed), true);
});

test('Satzzeichen werden nicht als zusätzliche Wörter gezählt', () => {
  assert.equal(validateMinWords('Freiheit, Geld!').wordCount, 2);
});

test('Wünsche werden strikt der Reihe nach vertieft', () => {
  let result = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes });
  assert.equal(result.state.active_wish, 0);
  result = applyWeekOneAction(result.state, { type: 'save_wish_followup', wishIndex: 0, answer: 'Das gibt mir Sicherheit und spürbare Ruhe.' });
  assert.equal(result.state.active_wish, 1);
  result = applyWeekOneAction(result.state, { type: 'save_wish_followup', wishIndex: 1, answer: 'Das macht meinen Alltag sinnvoll und lebendig.' });
  assert.equal(result.state.active_wish, 2);
});

test('unklare Wunschantwort wird höchstens dreimal nachgefragt', () => {
  let result = applyWeekOneAction(createWeekOneState(), { type: 'save_wishes', wishes: validWishes });
  for (let count = 0; count < 3; count += 1) result = applyWeekOneAction(result.state, { type: 'save_wish_followup', wishIndex: 0, answer: 'Weiß nicht.' });
  assert.equal(result.state.wishes[0].followup_count, 3);
  assert.equal(result.state.wishes[0].completed, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_2);
});

test('konkretisiertes FDD-Ziel wird abgeschlossen', () => {
  let result = applyWeekOneAction(moveThroughWishes(), { type: 'save_target', answer: 'Ich möchte danach einfach viel mehr Klarheit haben.' });
  result = applyWeekOneAction(result.state, { type: 'clarify_target', answer: 'Ich kann mich für eine berufliche Richtung entscheiden.' });
  assert.equal(result.state.fdd_target.completed, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.CLARITY);
});

test('Klarheitswerte außerhalb von 1 bis 10 werden abgelehnt', () => {
  assert.equal(applyWeekOneAction(createWeekOneState(), { type: 'save_clarity', score: 0 }).ok, false);
  assert.equal(applyWeekOneAction(createWeekOneState(), { type: 'save_clarity', score: 11 }).ok, false);
});

test('Schrittstatus wird ausschließlich aus dem State berechnet', () => {
  const state = moveThroughWishes();
  const statuses = stepStatuses(state);
  assert.equal(statuses[0].status, 'completed');
  assert.equal(statuses[1].status, 'open');
});

test('fehlende Voraussetzungen werden konkret benannt', () => {
  const missing = missingWeekOneRequirements(createWeekOneState(), { privacyConsent: true, startCommitment: true });
  assert.ok(missing.includes('Klarheitswert'));
  assert.ok(missing.includes('hochgeladener Lebenslauf'));
});

test('korrigierter Wunsch erfüllt weiterhin die Sechs-Wörter-Regel', () => {
  const state = moveThroughWishes();
  assert.equal(applyWeekOneAction(state, { type: 'correct_wish', wishIndex: 1, wish: 'Mehr Freiheit' }).ok, false);
  const result = applyWeekOneAction(state, { type: 'correct_wish', wishIndex: 1, wish: 'Ich wünsche mir deutlich mehr Freiheit in meinem Berufsalltag.' });
  assert.equal(result.ok, true);
  assert.equal(result.state.current_step, WEEK_ONE_STEPS.WISH_2);
  assert.equal(result.state.wishes[1].completed, false);
});
