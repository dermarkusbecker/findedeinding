import { requireCurrentPermission } from '../lib/user-auth.js';
import { getParticipantProgramAccess, patchParticipantProgress, serviceHeaders } from '../lib/program-access-service.js';
import { isOnboardingComplete } from '../lib/program-access.js';
import { applyWeekOneAction, createWeekOneState, missingWeekOneRequirements, stepStatuses, weekOneComplete, weekOnePrompt } from '../lib/week-one.js';
import { applyGuidedWeekAction, createGuidedWeekState, guidedStepStatuses, guidedWeekComplete, guidedWeekDefinition, missingGuidedRequirements, normalizeGuidedWeekState } from '../lib/guided-weeks.js';
import { readClarityQuestionOverrides, resolveClarityPrompt } from '../lib/clarity-questions.js';
import { handleClaraMessage } from '../lib/clara/api-handler.js';
import { handleParticipantDocument } from '../lib/documents/api-handler.js';
import { weekResetScope } from '../lib/week-reset.js';

const programWeeks = [
  { week: 1, title: 'Jetzt geht es los', mode: 'Ist-Aufnahme', question: 'Stell dir vor, vor dir steht eine Fee und du hast genau drei Wünsche frei. Welche drei Dinge würdest du dir für dein Leben aktuell am meisten wünschen?', help: 'Nenne zunächst einfach alle drei. Danach vertiefen wir sie einzeln.', upload: 'Lebenslauf optional' },
  { week: 2, title: 'Fähigkeiten & Umfeld', mode: 'Datensammlung', question: 'Welche besonderen Fähigkeiten oder Qualifikationen hast du dir außerhalb deiner klassischen Ausbildung und deines Berufs angeeignet?', help: 'Denk auch an Hobbys, Ehrenamt, eigene Projekte oder langjährige Erfahrung.', upload: 'Nachweise optional' },
  { week: 3, title: 'Motivatoren', mode: 'Auswahl', question: 'Wenn du auf dein heutiges Leben schaust: Welcher deiner fünf wichtigsten Motivatoren kommt aktuell am deutlichsten zu kurz?', help: 'Wir betrachten das als Puzzleteil – nicht automatisch als Berufskriterium.', upload: 'Workbook optional' },
  { week: 4, title: 'Halbzeit', mode: 'Synthese', question: 'Sollte das Thema „Gestaltungsfreiheit“ eher in deinem Ding enthalten sein, in deinem Leben, in beidem – oder weißt du es noch nicht?', help: 'Du ordnest selbst zu. Human Design bleibt dabei nur eine ergänzende Perspektive.', upload: 'Halbzeitanalyse bestätigen' },
  { week: 5, title: 'Werte & Lebenswerk', mode: 'Reflexion', question: 'Welche Eigenschaft bewunderst du an anderen Menschen besonders – und was berührt dich daran?', help: 'Wir unterscheiden später zwischen eigener Stärke, Potenzial und Wunsch.', upload: 'Grabrede erforderlich' },
  { week: 6, title: 'Dein-Ding-Map', mode: 'Verdichtung', question: 'Wenn du an eine zukünftige Tätigkeit denkst: Was möchtest du auf keinen Fall mehr in deinem Arbeitsalltag haben?', help: 'Wir sammeln mindestens zehn konkrete Ausschlusskriterien und formulieren danach deine gewünschten Gegenstücke.', upload: 'Perfekter Tag erforderlich' },
  { week: 7, title: 'Optionen & Realität', mode: 'Entscheidung', question: 'Wenn du alles zusammennimmst: Welche Richtungen oder Tätigkeiten fühlen sich so an, als könnte etwas für dich darin stecken?', help: 'Du nennst zuerst eigene Optionen. Mindestens eine davon bekommt einen kleinen, sicheren Realitätskontakt.', upload: 'Zukunfts-Timelines erforderlich' },
  { week: 8, title: 'Umsetzung', mode: 'Handeln', question: 'Was sind die ein bis drei konkreten Dinge, die du innerhalb der nächsten 24 Stunden tun kannst, damit deine Entscheidung nicht nur auf Papier steht?', help: 'Kontrollierbare Handlungen zählen mehr als Ergebnisse, die du nicht direkt beeinflussen kannst.', upload: 'Commitment erforderlich' },
];

const weekContent = (week, gates, weekOneState = null, guidedState = null, questionOverrides = []) => {
  const content = programWeeks.find((item) => item.week === Number(week));
  if (!content) return null;
  if (Number(week) === 1 && weekOneState) {
    const prompt = weekOnePrompt(weekOneState);
    return { ...content, question: resolveClarityPrompt(questionOverrides, 1, weekOneState.current_step, prompt.question || content.question), help: prompt.help || content.help, tasks: stepStatuses(weekOneState) };
  }
  if (Number(week) >= 2 && guidedState) {
    const definition = guidedWeekDefinition(week);
    const activeStep = definition.steps.find((step) => step.id === guidedState.current_step);
    return { ...content, title: definition.title, mode: definition.mode, question: activeStep ? resolveClarityPrompt(questionOverrides, week, activeStep.id, activeStep.question) : 'Diese Woche ist bereit zum Abschluss.', help: definition.intro, tasks: guidedStepStatuses(guidedState) };
  }
  return { ...content, tasks: gates.filter((gate) => Number(gate.week) === Number(week) && gate.required !== false).map((gate) => ({ id: gate.id, key: gate.gate_key, label: gate.label, completed: Boolean(gate.completed_at) })) };
};

async function readWeekOneState(result, participantId) {
  const stateResponse = await fetch(`${result.service.url}/rest/v1/process_entries?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.1&data_block=eq.week_1_state&select=structured_data&order=created_at.desc&limit=1`, { headers: serviceHeaders(result.service.key) });
  const rows = await stateResponse.json();
  if (!stateResponse.ok) throw new Error(rows.message || 'Woche 1 konnte nicht geladen werden.');
  return rows[0]?.structured_data?.week_1 || createWeekOneState();
}

async function readGuidedWeekState(result, participantId, week) {
  const response = await fetch(`${result.service.url}/rest/v1/process_entries?user_profile_id=eq.${encodeURIComponent(participantId)}&week=eq.${week}&data_block=eq.week_${week}_state&select=structured_data&order=created_at.desc&limit=1`, { headers: serviceHeaders(result.service.key) });
  const rows = await response.json();
  if (!response.ok) throw new Error(rows.message || `Woche ${week} konnte nicht geladen werden.`);
  return normalizeGuidedWeekState(week, rows[0]?.structured_data?.[`week_${week}`] || createGuidedWeekState(week));
}

async function saveGuidedWeekState(result, participantId, week, state, rawAnswer = '') {
  const response = await fetch(`${result.service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(result.service.key), body: JSON.stringify({ user_profile_id: participantId, week, data_block: `week_${week}_state`, raw_answer: String(rawAnswer || '').slice(0, 10000) || null, structured_data: { [`week_${week}`]: state }, evidence_level: 'participant_statement' }) });
  if (!response.ok) throw new Error(`Dein Fortschritt in Woche ${week} konnte nicht gespeichert werden.`);
}

async function saveWeekOneState(result, participantId, state, rawAnswer = '') {
  const saveResponse = await fetch(`${result.service.url}/rest/v1/process_entries`, {
    method: 'POST',
    headers: serviceHeaders(result.service.key),
    body: JSON.stringify({ user_profile_id: participantId, week: 1, data_block: 'week_1_state', raw_answer: String(rawAnswer || '').slice(0, 10000) || null, structured_data: { week_1: state }, evidence_level: 'participant_statement' }),
  });
  if (!saveResponse.ok) {
    const error = await saveResponse.json().catch(() => ({}));
    throw new Error(error.message || 'Dein Fortschritt in Woche 1 konnte nicht gespeichert werden.');
  }
}

function weekOnePreconditions(progress = {}) {
  return { privacyConsent: Boolean(progress.privacy_consent_at), startCommitment: Boolean(progress.start_commitment_at) };
}

function protectedAccess(access, complete) {
  if (complete) return access;
  const weekStates = access.weekStates.map((state) => Number(state.week) === 1 ? state : { ...state, accessible: false, reason: 'week_1_incomplete' });
  return { ...access, currentWeek: access.unlockedWeeks.includes(1) ? 1 : 0, unlockedWeeks: access.unlockedWeeks.filter((week) => Number(week) === 1), automaticUnlockedWeeks: access.automaticUnlockedWeeks.filter((week) => Number(week) === 1), weekStates };
}

async function setGate(service, participantId, gateId, completed) {
  const response = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gateId)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, {
    method: 'PATCH', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ completed_at: completed ? new Date().toISOString() : null }),
  });
  const rows = await response.json();
  if (!response.ok || !rows[0]) throw new Error(rows.message || 'Pflichtaufgabe wurde nicht gefunden.');
  return rows[0];
}

function missingOptionalRelation(status, data = {}) {
  return status === 404 || ['PGRST205', '42P01'].includes(data?.code);
}

async function optionalRows(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok && missingOptionalRelation(response.status, data)) return [];
  if (!response.ok) throw new Error(data.message || fallback);
  return data;
}

async function deleteWeekData(service, participantId, week) {
  const id = encodeURIComponent(participantId);
  const headers = serviceHeaders(service.key);
  const documents = await optionalRows(await fetch(`${service.url}/rest/v1/participant_documents?user_profile_id=eq.${id}&week=eq.${week}&select=id,storage_bucket,storage_path`, { headers }), 'Dokumente der Woche konnten nicht geladen werden.');
  for (const document of documents) {
    const storageDelete = await fetch(`${service.url}/storage/v1/object/${encodeURIComponent(document.storage_bucket)}/${document.storage_path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers });
    if (!storageDelete.ok && storageDelete.status !== 404) throw new Error('Ein Upload dieser Woche konnte nicht gelöscht werden.');
  }
  const resources = [
    `participant_memory?user_profile_id=eq.${id}&source_week=eq.${week}`,
    `clara_messages?user_profile_id=eq.${id}&week=eq.${week}`,
    `participant_documents?user_profile_id=eq.${id}&week=eq.${week}`,
    `process_entries?user_profile_id=eq.${id}&week=eq.${week}`,
  ];
  for (const resource of resources) {
    const result = await fetch(`${service.url}/rest/v1/${resource}`, { method: 'DELETE', headers });
    const data = await result.json().catch(() => ({}));
    if (!result.ok && !missingOptionalRelation(result.status, data)) throw new Error(data.message || 'Die Inhalte der Woche konnten nicht vollständig gelöscht werden.');
  }
  const gateReset = await fetch(`${service.url}/rest/v1/week_gates?user_profile_id=eq.${id}&week=eq.${week}`, { method: 'PATCH', headers, body: JSON.stringify({ completed_at: null, evidence_entry_id: null }) });
  if (!gateReset.ok) throw new Error('Die Pflichtschritte der Woche konnten nicht zurückgesetzt werden.');
  const scope = weekResetScope(week);
  for (const phase of scope.clarityPhases) {
    const measurement = await fetch(`${service.url}/rest/v1/clarity_measurements?user_profile_id=eq.${id}&phase=eq.${phase}`, { method: 'DELETE', headers });
    if (!measurement.ok) throw new Error('Die Klarheitsmessung der Woche konnte nicht zurückgesetzt werden.');
  }
  return scope;
}

export default async function handler(request, response) {
  if (request.query?.feature === 'clara-message') return handleClaraMessage(request, response);
  if (request.query?.feature === 'participant-document') return handleParticipantDocument(request, response);
  const session = await requireCurrentPermission('clara_program')(request, response);
  if (!session) return;
  try {
    const result = await getParticipantProgramAccess(session.participantId);
    if (request.method === 'GET') {
      const onboardingComplete = isOnboardingComplete(result.progress);
      const weekOneState = await readWeekOneState(result, session.participantId);
      const preconditions = weekOnePreconditions(result.progress);
      const weekOneGateComplete = weekOneComplete(weekOneState, preconditions);
      const access = protectedAccess(result.serializedAccess, weekOneGateComplete);
      const requestedWeek = request.query?.week === undefined ? null : Number(request.query.week);
      if (requestedWeek !== null && (!Number.isInteger(requestedWeek) || requestedWeek < 1 || requestedWeek > 8)) return response.status(400).json({ error: 'Ungültige Woche.' });
      if (requestedWeek !== null && !preconditions.privacyConsent) return response.status(403).json({ error: 'Bevor es losgehen kann, brauchen wir noch deine bestätigte Datenschutz-Einwilligung.' });
      if (requestedWeek !== null && !preconditions.startCommitment) return response.status(403).json({ error: 'Bevor es losgehen kann, fehlt noch dein unterschriebenes persönliches Commitment.' });
      if (!onboardingComplete && requestedWeek !== null) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      if (requestedWeek !== null && requestedWeek > 1 && !weekOneGateComplete) return response.status(403).json({ error: `Woche 1 ist noch nicht vollständig. Es fehlt: ${missingWeekOneRequirements(weekOneState, preconditions).join(', ')}.` });
      if (requestedWeek !== null && !access.weekStates.some((state) => state.week === requestedWeek && state.accessible)) return response.status(403).json({ error: 'Diese Woche ist noch nicht freigeschaltet.', access });
      const accessibleWeeks = (onboardingComplete ? access.unlockedWeeks : []).map((week) => {
        const content = programWeeks.find((item) => item.week === week);
        return { week, title: content.title, mode: content.mode };
      });
      const recordedWeekAccessible = access.weekStates.some((state) => state.week === Number(result.progress.current_week) && state.accessible);
      const selectedWeek = onboardingComplete ? (requestedWeek || (recordedWeekAccessible ? Number(result.progress.current_week) : access.unlockedWeeks[0] || 1)) : 0;
      const guidedState = selectedWeek >= 2 ? await readGuidedWeekState(result, session.participantId, selectedWeek) : null;
      const questionOverrides = selectedWeek ? await readClarityQuestionOverrides(result.service, selectedWeek) : [];
      return response.status(200).json({ profile: { id: result.profile.id, name: result.profile.name }, access, onboardingComplete, programWeeks: programWeeks.map(({ week, title, mode }) => ({ week, title, mode })), accessibleWeeks, selectedWeek, week: selectedWeek ? weekContent(selectedWeek, result.gates, selectedWeek === 1 ? weekOneState : null, guidedState, questionOverrides) : null, weekOne: weekOneState, weekOneGate: { complete: weekOneGateComplete, missingRequirements: missingWeekOneRequirements(weekOneState, preconditions) }, weekState: guidedState, weekGate: guidedState ? { complete: guidedWeekComplete(guidedState), missingRequirements: missingGuidedRequirements(guidedState) } : null });
    }
    if (request.method !== 'PATCH') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    const action = request.body?.action;
    if (action === 'start') {
      if (result.access.status !== 'active') return response.status(423).json({ error: 'Dein Programm ist aktuell pausiert.' });
      const commitmentConfirmed = request.body?.commitment === true;
      const signedDocumentUploaded = request.body?.signedDocument === true;
      if (!request.body?.privacy || !commitmentConfirmed || !signedDocumentUploaded) return response.status(400).json({ error: 'Bitte bestätige deine Einwilligung und lade dein unterschriebenes Commitment hoch.' });
      const startGates = result.gates.filter((gate) => Number(gate.week) === 0);
      const now = new Date().toISOString();
      const berlinDateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const datePart = (type) => berlinDateParts.find((part) => part.type === type)?.value;
      const configuredStartDate = String(result.progress.program_start_date || '');
      const programStartDate = /^\d{4}-\d{2}-\d{2}$/.test(configuredStartDate) ? configuredStartDate : `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
      await Promise.all([
        patchParticipantProgress(result.service, session.participantId, { privacy_consent_at: now, start_commitment_at: now, program_start_date: programStartDate, access_mode: 'time_based', current_week: 1, process_status: 'WEEK_1', last_activity_at: now }),
        Promise.allSettled(startGates.map((gate) => setGate(result.service, session.participantId, gate.id, true))),
      ]);
      return response.status(200).json({ ok: true, started: true, week: 1 });
    } else if (action === 'revoke_privacy') {
      const now = new Date().toISOString();
      await patchParticipantProgress(result.service, session.participantId, { privacy_consent_at: null, current_week: 0, process_status: 'ONBOARDING', last_activity_at: now });
    } else if (action === 'week_1_update') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const currentState = await readWeekOneState(result, session.participantId);
      const update = applyWeekOneAction(currentState, request.body?.stepAction || {});
      if (!update.ok) return response.status(400).json({ error: update.error, details: update.details, weekOne: update.state });
      const rawAnswer = request.body?.stepAction?.answer || request.body?.stepAction?.wishes?.join('\n') || request.body?.stepAction?.fileName || '';
      await saveWeekOneState(result, session.participantId, update.state, rawAnswer);
      const statuses = stepStatuses(update.state);
      const gateMap = { three_wishes: statuses[0].status === 'completed', target_and_baseline: statuses[1].status === 'completed' && statuses[2].status === 'completed', career_history: statuses[3].status === 'completed' };
      await Promise.allSettled(result.gates.filter((gate) => Number(gate.week) === 1 && gate.gate_key in gateMap).map((gate) => setGate(result.service, session.participantId, gate.id, gateMap[gate.gate_key])));
      return response.status(200).json({ ok: true, weekOne: update.state, steps: statuses, gate: { complete: weekOneComplete(update.state, weekOnePreconditions(result.progress)), missingRequirements: missingWeekOneRequirements(update.state, weekOnePreconditions(result.progress)) } });
    } else if (action === 'guided_week_update') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (!Number.isInteger(week) || week < 2 || week > 8 || !result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const stepAction = request.body?.stepAction || {};
      if (stepAction.type === 'external_completed') return response.status(403).json({ error: 'Technische Ergebnisse können nur durch den zuständigen serverseitigen Dienst bestätigt werden.' });
      if (stepAction.type === 'document_uploaded') {
        const documentId = String(stepAction.documentId || '');
        const storageFallbackValid = documentId.startsWith(`storage:${session.participantId}/`);
        let storedDocumentValid = false;
        if (/^[0-9a-f-]{36}$/i.test(documentId)) {
          const documentResponse = await fetch(`${result.service.url}/rest/v1/participant_documents?id=eq.${encodeURIComponent(documentId)}&user_profile_id=eq.${encodeURIComponent(session.participantId)}&week=eq.${week}&select=id&limit=1`, { headers: serviceHeaders(result.service.key) });
          const rows = await documentResponse.json().catch(() => ([]));
          storedDocumentValid = documentResponse.ok && Boolean(rows[0]);
        }
        if (!storageFallbackValid && !storedDocumentValid) return response.status(400).json({ error: 'Der zugehörige sichere Upload wurde nicht gefunden.' });
      }
      const currentState = await readGuidedWeekState(result, session.participantId, week);
      const update = applyGuidedWeekAction(currentState, stepAction);
      if (!update.ok) return response.status(400).json({ error: update.error, details: update.details, weekState: update.state });
      const rawAnswer = request.body?.stepAction?.answer || request.body?.stepAction?.fileName || '';
      await saveGuidedWeekState(result, session.participantId, week, update.state, rawAnswer);
      const gateMap = Object.fromEntries([...new Set(guidedWeekDefinition(week).steps.map((step) => step.gateKey))].map((key) => [key, guidedWeekDefinition(week).steps.filter((step) => step.gateKey === key).every((step) => update.state.completed_steps.includes(step.id))]));
      await Promise.allSettled(result.gates.filter((gate) => Number(gate.week) === week && gate.gate_key in gateMap).map((gate) => setGate(result.service, session.participantId, gate.id, gateMap[gate.gate_key])));
      return response.status(200).json({ ok: true, weekState: update.state, steps: guidedStepStatuses(update.state), gate: { complete: guidedWeekComplete(update.state), missingRequirements: missingGuidedRequirements(update.state) } });
    } else if (action === 'set_gate') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (week === 1) return response.status(400).json({ error: 'Der Fortschritt in Woche 1 wird automatisch aus deinen Antworten ermittelt.' });
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const gate = result.gates.find((item) => item.id === request.body?.gateId && Number(item.week) === week);
      if (!gate) return response.status(404).json({ error: 'Pflichtaufgabe wurde nicht gefunden.' });
      await setGate(result.service, session.participantId, gate.id, Boolean(request.body?.completed));
      await patchParticipantProgress(result.service, session.participantId, { last_activity_at: new Date().toISOString() });
    } else if (action === 'save_answer') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      const answer = typeof request.body?.answer === 'string' ? request.body.answer.trim().slice(0, 10000) : '';
      if (!answer) return response.status(400).json({ error: 'Antwort fehlt.' });
      if (week === 1) return response.status(400).json({ error: 'Bitte beantworte den aktuell angezeigten Schritt in Woche 1.' });
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
      const insert = await fetch(`${result.service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(result.service.key), body: JSON.stringify({ user_profile_id: session.participantId, week, data_block: `week_${week}_dialog`, raw_answer: answer, evidence_level: 'participant_statement' }) });
      if (!insert.ok) throw new Error('Antwort konnte nicht gespeichert werden.');
      const firstGate = result.gates.find((gate) => Number(gate.week) === week && gate.required !== false);
      if (firstGate) await setGate(result.service, session.participantId, firstGate.id, true);
      await patchParticipantProgress(result.service, session.participantId, { last_activity_at: new Date().toISOString() });
    } else if (action === 'reopen_week') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (!Number.isInteger(week) || week < 1 || week > 8) return response.status(400).json({ error: 'Ungültige Woche für den Replay.' });
      if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist derzeit nicht zugänglich.' });
      const resetState = await deleteWeekData(result.service, session.participantId, week);
      await patchParticipantProgress(result.service, session.participantId, { current_week: resetState.week, process_status: resetState.processStatus, last_activity_at: new Date().toISOString() });
    } else if (action === 'complete_week') {
      if (!isOnboardingComplete(result.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
      const week = Number(request.body?.week);
      if (week === 1) {
        const weekOneState = await readWeekOneState(result, session.participantId);
        const preconditions = weekOnePreconditions(result.progress);
        if (!weekOneComplete(weekOneState, preconditions)) return response.status(409).json({ error: `Fast geschafft. Es fehlt noch: ${missingWeekOneRequirements(weekOneState, preconditions).join(', ')}.` });
        const weekOneGates = result.gates.filter((gate) => Number(gate.week) === 1 && gate.required !== false);
        await Promise.all(weekOneGates.map((gate) => setGate(result.service, session.participantId, gate.id, true)));
        weekOneState.status = 'completed';
        weekOneState.completed_at = new Date().toISOString();
        await saveWeekOneState(result, session.participantId, weekOneState, 'Woche 1 abgeschlossen');
      } else {
        if (!result.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist nicht freigeschaltet.' });
        const guidedState = await readGuidedWeekState(result, session.participantId, week);
        if (!guidedWeekComplete(guidedState)) return response.status(409).json({ error: `Fast geschafft. Es fehlt noch: ${missingGuidedRequirements(guidedState).join(', ')}.` });
        const required = result.gates.filter((gate) => Number(gate.week) === week && gate.required !== false);
        if (!required.length || required.some((gate) => !gate.completed_at)) return response.status(409).json({ error: 'Die Woche ist erst abgeschlossen, wenn alle Pflichtaufgaben bestätigt sind.' });
      }
      const nextWeek = Math.min(8, week + 1);
      await patchParticipantProgress(result.service, session.participantId, { current_week: nextWeek, process_status: week === 8 ? 'FINAL_REPORT' : `WEEK_${nextWeek}`, last_activity_at: new Date().toISOString() });
    } else return response.status(400).json({ error: 'Unbekannte Aktion.' });
    const updated = await getParticipantProgramAccess(session.participantId);
    return response.status(200).json({ ok: true, access: updated.serializedAccess });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Programmzugriff konnte nicht verarbeitet werden.' });
  }
}
