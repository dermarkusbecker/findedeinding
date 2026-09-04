const step = (id, title, question, gateKey, options = {}) => ({ id, title, question, gateKey, kind: 'dialog', ...options });

export const GUIDED_WEEK_DEFINITIONS = Object.freeze({
  2: {
    title: 'Fähigkeiten & Umfeld', mode: 'Datensammlung', intro: 'Wir ergänzen dein Bild um Fähigkeiten, Erfahrungen und die Sicht auf dich selbst.',
    steps: [
      step('education', 'Aus- und Weiterbildungen', 'Welche Ausbildungen, Studiengänge, Weiterbildungen, Seminare oder beruflichen Qualifikationen hast du bisher absolviert?', 'skills'),
      step('informal_skills', 'Informelles Können', 'Welche besonderen Fähigkeiten oder Qualifikationen hast du dir außerhalb deiner klassischen Ausbildung und deines Berufs angeeignet?', 'skills'),
      step('work_people', 'Menschen im Arbeitsumfeld', 'Mit welchen Menschen hast du in deiner aktuellen oder letzten Tätigkeit hauptsächlich zu tun?', 'self_external_view'),
      step('work_conditions', 'Arbeitsplatz und Bedingungen', 'Wie sehen dein typischer Arbeitsplatz und die Bedingungen aus, unter denen du arbeitest?', 'self_external_view'),
      step('external_work', 'Fremdbild im Beruf', 'Was würden Kollegen oder Vorgesetzte wahrscheinlich als deine größten Stärken nennen?', 'self_external_view'),
      step('external_private', 'Fremdbild privat', 'Was würden deine engsten Freunde wahrscheinlich als deine größten Stärken bezeichnen?', 'self_external_view'),
      step('current_goal', 'Dein aktuelles Ziel', 'Welches berufliche oder persönliche Ziel verfolgst du im Moment – wenn überhaupt?', 'current_goal', { allowNone: true }),
      step('strengths', 'Deine Stärken', 'Wenn du dich selbst einschätzt: Was sind deine größten Stärken?', 'self_external_view'),
      step('development', 'Entwicklungsfelder', 'Welche Eigenschaften oder Fähigkeiten würdest du aktuell eher als Schwächen oder Entwicklungsfelder bezeichnen?', 'self_external_view'),
    ],
  },
  3: {
    title: 'Motivatoren', mode: 'Auswahl', intro: 'Wir schauen darauf, was dich von innen antreibt und was schon früh freiwillig aus dir heraus entstanden ist.',
    steps: [
      step('motivators', 'Top 5 Motivatoren', 'Welche fünf Motivatoren sind dir nach dem paarweisen Vergleich am wichtigsten? Nenne sie bitte in deiner Reihenfolge.', 'motivators', { minItems: 5, maxItems: 5 }),
      step('undersupplied', 'Was kommt zu kurz?', 'Welcher deiner fünf wichtigsten Motivatoren kommt in deinem heutigen Leben am deutlichsten zu kurz?', 'motivators'),
      step('childhood', 'Kindheitsinteressen', 'Was hast du als Kind freiwillig und gerne gemacht, wenn dir niemand gesagt hat, was du tun sollst?', 'childhood'),
      step('still_present', 'Was lebt heute noch?', 'Welche dieser Dinge machst du heute noch – vielleicht in ähnlicher Form – und welche sind verschwunden?', 'childhood'),
      step('why_lost', 'Warum verschwunden?', 'Warum glaubst du, ist dieser Teil irgendwann aus deinem Leben verschwunden?', 'childhood'),
      step('reintegration', 'Wieder mehr Raum', 'Welche ein oder zwei Dinge davon möchtest du in nächster Zeit bewusst wieder in dein Leben integrieren?', 'reintegration', { minItems: 1, maxItems: 2 }),
    ],
  },
  4: {
    title: 'Halbzeit', mode: 'Synthese', intro: 'Human Design ist hier eine ergänzende Reflexionsperspektive – keine objektive Wahrheit über dich.',
    steps: [
      step('birth_data', 'Geburtsdaten', 'Bitte gib mir dein Geburtsdatum, deine möglichst genaue Geburtszeit und deinen Geburtsort.', 'human_design'),
      step('human_design', 'Human Design', 'Deine Chartdaten werden ausschließlich über die angebundene Berechnung ausgewertet.', 'human_design', { kind: 'external', external: 'human_design' }),
      step('puzzle_assignment', 'Ding oder Leben?', 'Ordne die zentralen bisherigen Themen jeweils deinem Ding, deinem Leben, beidem oder vorerst offen zu.', 'puzzle_assignment', { kind: 'structured' }),
      step('midpoint_report', 'Halbzeitbericht', 'Clara erstellt aus den belegten Puzzleteilen deinen Halbzeitbericht.', 'midpoint_report', { kind: 'external', external: 'midpoint_report' }),
    ],
  },
  5: {
    title: 'Werte & Lebenswerk', mode: 'Reflexion', intro: 'Wir ergänzen dein Bild um Werte, Resonanz, Bewunderung und das, was langfristig Bedeutung hat.',
    steps: [
      step('values', 'Top 5 Werte', 'Welche fünf Werte sind dir nach dem paarweisen Vergleich am wichtigsten? Nenne sie bitte in deiner Reihenfolge.', 'values', { minItems: 5, maxItems: 5 }),
      step('lila_ready', 'LILA vorbereiten', 'Nimm dir für LILA 60 bis 90 Minuten freie Zeit. Wenn du ungestört bereit bist, schreibe GO.', 'lila', { expected: 'GO' }),
      step('lila', 'LILA', 'Das Spiel wird im eigenen, auditierbaren LILA-Modus durchgeführt.', 'lila', { kind: 'external', external: 'lila' }),
      step('admiration', 'Was du bewunderst', 'Welche Menschen bewunderst du – und welche Eigenschaften oder Lebensweisen faszinieren dich an ihnen?', 'values'),
      step('eulogy', 'Deine Grabrede', 'Bearbeite die Grabrede in Ruhe und lade anschließend die Seiten hier hoch.', 'eulogy', { kind: 'upload', documentType: 'workbook' }),
    ],
  },
  6: {
    title: 'Dein-Ding-Map', mode: 'Verdichtung', intro: 'Jetzt verbinden wir die Puzzleteile und verkleinern den Suchraum – noch ohne vorschnelle Berufsantwort.',
    steps: [
      step('enthusiasm', 'Was dich begeistert', 'Was begeistert dich wirklich und gibt dir spürbar Energie?', 'four_areas'),
      step('strength_potential', 'Was in dir steckt', 'Welche Fähigkeiten, Erfahrungen und Potenziale möchtest du künftig stärker nutzen?', 'four_areas'),
      step('difference', 'Wo du wirken willst', 'Für welche Menschen oder bei welchen Problemen würdest du gerne einen Unterschied machen?', 'four_areas'),
      step('value_creation', 'Womit du Wert schaffst', 'Wofür könnten andere Menschen oder Unternehmen in deinem Können einen echten Nutzen sehen?', 'four_areas'),
      step('perfect_day', 'Dein perfekter Tag', 'Beschreibe im Workbook einen normalen, passenden Dienstag in drei Jahren und lade die Seiten hoch.', 'ding_map', { kind: 'upload', documentType: 'workbook' }),
      step('exclusions', 'Ausschlusskriterien', 'Welche mindestens zehn Dinge möchtest du in deinem zukünftigen Arbeitsalltag möglichst nicht mehr haben?', 'exclusion_criteria', { minItems: 10 }),
      step('counterparts', 'Deine Positivkriterien', 'Was möchtest du stattdessen? Formuliere für jedes Ausschlusskriterium dein gewünschtes Gegenstück.', 'ding_map', { minItems: 10 }),
      step('ding_map', 'Dein-Ding-Map', 'Clara verdichtet die vier Bereiche und deine Kriterien zu deiner Dein-Ding-Map.', 'ding_map', { kind: 'external', external: 'ding_map' }),
    ],
  },
  7: {
    title: 'Optionen & Realität', mode: 'Entscheidung', intro: 'Wir reduzieren äußeren Input, prüfen deine eigenen Richtungen und gleichen mindestens eine davon mit der Realität ab.',
    steps: [
      step('own_options', 'Deine Möglichkeiten', 'Welche zwei bis vier Richtungen oder Tätigkeiten fühlen sich so an, als könnte etwas für dich darin stecken?', 'final_two', { minItems: 2, maxItems: 4 }),
      step('resonance', 'Innere Resonanz', 'Was lösen diese Möglichkeiten jeweils spontan in dir aus – Energie, Neugier, Vorfreude, Angst oder Widerstand?', 'final_two'),
      step('reality_plan', 'Realitätskontakt planen', 'Was ist der kleinste sichere und reversible Schritt, mit dem du mindestens eine Option real erleben kannst?', 'reality_contact'),
      step('reality_result', 'Realitätskontakt auswerten', 'Was hat sich durch den Realitätskontakt verändert, und ist dein Interesse stärker, gleich oder schwächer geworden?', 'reality_contact'),
      step('final_two', 'Deine finalen Optionen', 'Welche genau zwei Möglichkeiten möchtest du als Option A und Option B weiter betrachten?', 'final_two', { minItems: 2, maxItems: 2 }),
      step('future_timelines', 'Zwei Wege, zwei Zukünfte', 'Schreibe beide Zukunftswege im Workbook auf und lade die Seiten anschließend hoch.', 'decision_confirmation', { kind: 'upload', documentType: 'workbook' }),
      step('decision', 'Tendenz oder Entscheidung', 'Hat sich durch die beiden Zukunftswege eine klare Tendenz oder Entscheidung ergeben?', 'decision_confirmation', { allowNone: true }),
      step('decision_resolution', 'Entscheidung persönlich bestätigen', 'Deine Entscheidung wird gemeinsam mit Markus sicher bestätigt.', 'decision_confirmation', { kind: 'external', external: 'decision_confirmation' }),
    ],
  },
  8: {
    title: 'Umsetzung', mode: 'Handeln', intro: 'Jetzt geht es nicht mehr um weitere Möglichkeiten, sondern darum, deine Entscheidung durch konkretes Handeln zu prüfen.',
    steps: [
      step('worst_case', 'Realistischer Worst Case', 'Was ist das Schlimmste, was realistisch passieren könnte, wenn du deine Entscheidung umsetzt?', 'implementation_plan'),
      step('coping', 'Dein Umgang damit', 'Wenn genau das eintreten würde: Was könntest du dann tun?', 'implementation_plan'),
      step('inaction_risk', 'Risiko des Nicht-Handelns', 'Was könnte passieren, wenn du aus Angst überhaupt nichts veränderst?', 'implementation_plan'),
      step('barriers', 'Einwände und Rückenwind', 'Welche Einwände halten dich zurück – und was sagt die Stimme, die deine Entwicklung und Entscheidung ernst nimmt?', 'implementation_plan'),
      step('written_decision', 'Meine Entscheidung', 'Arbeite deine schriftliche Entscheidung aus und lade sie hier hoch.', 'implementation_plan', { kind: 'upload', documentType: 'workbook' }),
      step('next_24h', 'Die nächsten 24 Stunden', 'Welche ein bis drei konkreten Dinge kannst du innerhalb der nächsten 24 Stunden tun?', 'implementation_plan', { minItems: 1, maxItems: 3 }),
      step('next_30d', 'Die nächsten 30 Tage', 'Was soll in den nächsten 30 Tagen sichtbar passiert sein – durch Dinge, die du selbst beeinflussen kannst?', 'implementation_plan'),
      step('next_90d', 'Dein 90-Tage-Meilenstein', 'Welcher realistische erste Meilenstein soll nach 90 Tagen erreicht sein?', 'implementation_plan'),
      step('final_commitment', 'Umsetzungs-Commitment', 'Drucke dein Umsetzungs-Commitment aus, unterschreibe es und lade es wieder hoch.', 'final_commitment', { kind: 'upload', documentType: 'workbook' }),
      step('clarity_end', 'Deine Klarheit heute', 'Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?', 'dossier_and_call', { kind: 'scale', min: 1, max: 10 }),
      step('final_dossier', 'Dein-Ding-Dossier', 'Clara erstellt dein finales Dossier ausschließlich aus belegten Aussagen und Ergebnissen.', 'dossier_and_call', { kind: 'external', external: 'final_dossier' }),
      step('final_call', 'Abschluss mit Markus', 'Zum Abschluss wird dein persönlicher 45-Minuten-Termin mit Markus vorbereitet.', 'dossier_and_call', { kind: 'external', external: 'final_call' }),
    ],
  },
});

export function guidedWeekDefinition(week) { return GUIDED_WEEK_DEFINITIONS[Number(week)] || null; }

export function createGuidedWeekState(week) {
  const definition = guidedWeekDefinition(week);
  if (!definition) return null;
  return { version: 2, week: Number(week), status: 'in_progress', current_step: definition.steps[0].id, clarity_checkin: { score: null, changed: null, note: '', completed: false, recorded_at: null }, answers: {}, completed_steps: [], documents: {}, external_results: {}, updated_at: null, completed_at: null };
}

export function normalizeGuidedWeekState(week, state) {
  const base = createGuidedWeekState(week);
  if (!base || !state || Number(state.week) !== Number(week)) return base;
  const legacyCompletedWeek = Number(state.version || 1) < 2 && state.status === 'ready_to_complete';
  const legacyClarity = legacyCompletedWeek ? { completed: true, migrated: true } : {};
  return { ...base, ...state, version: 2, clarity_checkin: { ...base.clarity_checkin, ...legacyClarity, ...(state.clarity_checkin || {}) }, answers: state.answers || {}, completed_steps: Array.isArray(state.completed_steps) ? state.completed_steps : [], documents: state.documents || {}, external_results: state.external_results || {} };
}

export function needsGuidedClarityCheckin(state) {
  const normalized = normalizeGuidedWeekState(state?.week, state);
  return Boolean(normalized && !normalized.clarity_checkin?.completed);
}

export function guidedClarityStep(state) {
  const week = Number(state?.week);
  if (!guidedWeekDefinition(week)) return null;
  return {
    id: 'weekly_clarity',
    title: 'Dein Klarheits-Check-in',
    question: 'Hat sich seit letzter Woche etwas verändert – und wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?',
    kind: 'clarity_checkin',
    min: 1,
    max: 10,
  };
}

export function currentGuidedStep(state) {
  return guidedWeekDefinition(state?.week)?.steps.find((item) => item.id === state.current_step) || null;
}

const splitItems = (answer = '') => String(answer).split(/\n|;|,(?=\s*(?:\d+[.)-]|[^,]{2,}))/).map((item) => item.replace(/^\s*(?:[-•*]|\d+[.)-])\s*/, '').trim()).filter(Boolean);

function validateGuidedAnswer(stepDefinition, action) {
  const answer = String(action.answer || '').trim();
  const items = Array.isArray(action.items) && action.items.length ? action.items.map((item) => String(item).trim()).filter(Boolean) : splitItems(answer);
  if (stepDefinition.kind === 'external') return { ok: false, error: 'Dieser Schritt benötigt ein bestätigtes technisches Ergebnis.' };
  if (stepDefinition.kind === 'upload') return action.documentId ? { ok: true, answer: action.fileName || 'Dokument hochgeladen', items: [] } : { ok: false, error: 'Bitte lade zuerst das erforderliche Dokument hoch.' };
  if (stepDefinition.kind === 'scale') {
    const score = Number(action.score ?? answer);
    return score >= stepDefinition.min && score <= stepDefinition.max ? { ok: true, answer: String(score), items: [] } : { ok: false, error: `Bitte wähle einen Wert zwischen ${stepDefinition.min} und ${stepDefinition.max}.` };
  }
  if (!answer && !(stepDefinition.allowNone && action.confirmedNone)) return { ok: false, error: 'Bitte beantworte zuerst die aktuelle Frage.' };
  if (stepDefinition.expected && answer.toUpperCase() !== stepDefinition.expected) return { ok: false, error: `Schreibe ${stepDefinition.expected}, sobald du bereit bist.` };
  if (stepDefinition.minItems && items.length < stepDefinition.minItems) return { ok: false, error: `Für diesen Schritt werden mindestens ${stepDefinition.minItems} eigenständige Punkte benötigt.` };
  if (stepDefinition.maxItems && items.length > stepDefinition.maxItems) return { ok: false, error: `Bitte verdichte deine Antwort auf höchstens ${stepDefinition.maxItems} Punkte.` };
  return { ok: true, answer: answer || 'Aktuell kein Ziel vorhanden', items };
}

export function applyGuidedWeekAction(inputState, action = {}) {
  const state = structuredClone(normalizeGuidedWeekState(inputState?.week, inputState));
  const definition = guidedWeekDefinition(state?.week);
  const active = currentGuidedStep(state);
  if (!definition) return { ok: false, error: 'Die aktuelle Woche ist ungültig.', state: inputState };
  if (needsGuidedClarityCheckin(state)) {
    if (action.type !== 'save_clarity_checkin') return { ok: false, error: 'Bitte schließe zuerst deinen Klarheits-Check-in für diese Woche ab.', state: inputState, details: { reason: 'CLARITY_CHECKIN_REQUIRED' } };
    const score = Number(action.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) return { ok: false, error: 'Bitte wähle einen Klarheitswert zwischen 1 und 10.', state: inputState };
    if (typeof action.changed !== 'boolean') return { ok: false, error: 'Bitte gib an, ob sich seit der letzten Woche etwas verändert hat.', state: inputState };
    const recordedAt = new Date().toISOString();
    state.clarity_checkin = { score, changed: action.changed, note: String(action.note || '').trim().slice(0, 3000), completed: true, recorded_at: recordedAt };
    state.updated_at = recordedAt;
    return { ok: true, state };
  }
  if (!active) return { ok: false, error: 'Der aktuelle Wochenschritt ist ungültig.', state: inputState };
  if (action.type === 'correct_answer') {
    const target = definition.steps.find((item) => item.id === action.stepId);
    if (!target || !state.completed_steps.includes(target.id) || ['external', 'upload', 'scale'].includes(target.kind)) return { ok: false, error: 'Diese frühere Antwort kann hier nicht korrigiert werden.', state: inputState };
    const validated = validateGuidedAnswer(target, action);
    if (!validated.ok) return { ok: false, error: validated.error, state: inputState };
    state.answers[target.id] = { ...state.answers[target.id], raw_answer: validated.answer, items: validated.items, status: 'completed', corrected_at: new Date().toISOString() };
    state.updated_at = new Date().toISOString();
    return { ok: true, state };
  }
  if (action.stepId && action.stepId !== active.id) return { ok: false, error: 'Diese Antwort gehört nicht zum aktuellen Schritt.', state: inputState, details: { reason: 'WRONG_STEP' } };
  if (!['save_answer', 'document_uploaded', 'external_completed'].includes(action.type)) return { ok: false, error: 'Diese Aktion ist für den aktuellen Schritt nicht erlaubt.', state: inputState };
  if (action.type === 'external_completed') {
    if (active.kind !== 'external' || action.external !== active.external || action.verified !== true) return { ok: false, error: 'Das technische Ergebnis konnte nicht bestätigt werden.', state: inputState };
    state.external_results[active.id] = { resultId: action.resultId || null, completedAt: new Date().toISOString() };
  } else {
    const validated = validateGuidedAnswer(active, { ...action, documentId: action.type === 'document_uploaded' ? action.documentId : null });
    if (!validated.ok) return { ok: false, error: validated.error, state: inputState };
    state.answers[active.id] = { raw_answer: validated.answer, items: validated.items, status: 'completed', confirmed_at: new Date().toISOString() };
    if (action.type === 'document_uploaded') state.documents[active.id] = { id: action.documentId, fileName: action.fileName, uploadedAt: new Date().toISOString() };
  }
  if (!state.completed_steps.includes(active.id)) state.completed_steps.push(active.id);
  const next = definition.steps.find((item) => !state.completed_steps.includes(item.id));
  state.current_step = next?.id || null;
  state.status = next ? 'in_progress' : 'ready_to_complete';
  state.updated_at = new Date().toISOString();
  return { ok: true, state };
}

export function guidedStepStatuses(state) {
  const normalized = normalizeGuidedWeekState(state?.week, state);
  const clarity = guidedClarityStep(normalized);
  const clarityStatus = normalized.clarity_checkin?.completed ? 'completed' : 'in_progress';
  return [
    { ...clarity, status: clarityStatus },
    ...guidedWeekDefinition(normalized.week).steps.map((item) => ({ id: item.id, title: item.title, status: normalized.completed_steps.includes(item.id) ? 'completed' : !normalized.clarity_checkin?.completed ? 'open' : item.id === normalized.current_step ? 'in_progress' : 'open', kind: item.kind })),
  ];
}

export function guidedGateStatus(state) {
  const normalized = normalizeGuidedWeekState(state?.week, state);
  const definition = guidedWeekDefinition(normalized.week);
  const gateKeys = [...new Set(definition.steps.map((item) => item.gateKey))];
  return Object.fromEntries(gateKeys.map((gateKey) => [gateKey, definition.steps.filter((item) => item.gateKey === gateKey).every((item) => normalized.completed_steps.includes(item.id))]));
}

export function guidedWeekComplete(state) {
  const normalized = normalizeGuidedWeekState(state?.week, state);
  return Boolean(normalized.clarity_checkin?.completed) && guidedWeekDefinition(normalized.week).steps.every((item) => normalized.completed_steps.includes(item.id));
}

export function missingGuidedRequirements(state) {
  return guidedStepStatuses(state).filter((item) => item.status !== 'completed').map((item) => item.title);
}
