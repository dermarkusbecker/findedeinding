import { requireCurrentPermission } from '../user-auth.js';
import { getParticipantProgramAccess, serviceHeaders } from '../program-access-service.js';
import { isOnboardingComplete, isProgramWeekFinalized } from '../program-access.js';
import { applyWeekOneAction, stepStatuses, weekOneComplete, weekOnePrompt, WEEK_ONE_STEPS } from '../week-one.js';
import { currentGuidedStep, guidedGateStatus, guidedStepStatuses, guidedWeekComplete } from '../guided-weeks.js';
import { buildClaraContext } from './context-builder.js';
import { requestClaraResponse } from './llm-client.js';
import { validatedExtractions, validatedMemoryUpdates } from './memory-policy.js';
import { applyClaraStateSuggestions } from './state-bridge.js';
import { buildJourneyUiAction, verifyConfirmationToken } from './journey-actions.js';
import { findParticipantMessage, insertAssistantMessage, insertRawParticipantMessage, persistMemoryUpdates, readClaraData, saveGuidedWeekSnapshot, saveWeekOneSnapshot } from './store.js';
import { readClarityQuestionOverrides, resolveClarityPrompt } from '../clarity-questions.js';

async function syncWeekOneGates(service, participantId, gates, state) {
  const statuses = stepStatuses(state);
  const values = { three_wishes: statuses[0].status === 'completed', target_and_baseline: statuses[1].status === 'completed' && statuses[2].status === 'completed', career_history: statuses[3].status === 'completed' };
  await Promise.all(gates.filter((gate) => Number(gate.week) === 1 && gate.gate_key in values).map(async (gate) => {
    const result = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gate.id)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ completed_at: values[gate.gate_key] ? (gate.completed_at || new Date().toISOString()) : null }) });
    if (!result.ok) throw new Error('Der validierte Week-1-Gate-Status konnte nicht gespeichert werden.');
  }));
  return statuses;
}

async function syncGuidedWeekGates(service, participantId, gates, state) {
  const values = guidedGateStatus(state);
  await Promise.all(gates.filter((gate) => Number(gate.week) === Number(state.week) && gate.gate_key in values).map(async (gate) => {
    const result = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gate.id)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ completed_at: values[gate.gate_key] ? (gate.completed_at || new Date().toISOString()) : null }) });
    if (!result.ok) throw new Error(`Der validierte Gate-Status für Woche ${state.week} konnte nicht gespeichert werden.`);
  }));
  return guidedStepStatuses(state);
}

export async function handleClaraMessage(request, response) {
  const session = await requireCurrentPermission('clara_program')(request, response);
  if (!session) return;
  try {
    const program = await getParticipantProgramAccess(session.participantId);
    if (!isOnboardingComplete(program.progress)) return response.status(403).json({ error: 'Bitte schließe zuerst dein Onboarding ab.' });
    if (program.access.status !== 'active') return response.status(423).json({ error: 'Dein Programm ist aktuell pausiert.' });
    const source = request.method === 'GET' ? request.query : request.body;
    const week = Number(source?.week || program.progress.current_week);
    if (!Number.isInteger(week) || week < 1 || week > 8) return response.status(400).json({ error: 'Ungültige Woche.' });
    if (!program.access.canAccessWeek(week)) return response.status(403).json({ error: 'Diese Woche ist noch nicht freigeschaltet.' });
    const data = await readClaraData(program.service, session.participantId, week);
    if (request.method === 'GET') return response.status(200).json({ messages: data.messages, week, currentStep: data.state.current_step });
    if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    if (isProgramWeekFinalized(program.progress, week)) return response.status(409).json({ error: `Woche ${week} ist abgeschlossen. Clara und deine Antworten bleiben sichtbar, sind aber schreibgeschützt.` });
    const questionOverrides = await readClarityQuestionOverrides(program.service, week);
    if (request.body?.action === 'confirm_result') {
      if (week !== 1) return response.status(400).json({ error: 'Für diesen Schritt liegt keine offene Ergebnisbestätigung vor.' });
      const confirmation = verifyConfirmationToken(request.body?.confirmationToken, { participantId: session.participantId });
      if (!confirmation || confirmation.week !== week) return response.status(400).json({ error: 'Diese Bestätigung ist ungültig oder abgelaufen.' });
      const update = applyWeekOneAction(data.state, { type: 'confirm_wishes', wishes: confirmation.wishes });
      if (!update.ok) return response.status(400).json({ error: update.error });
      await saveWeekOneSnapshot(program.service, session.participantId, update.state, 'Drei Wünsche bestätigt');
      const statuses = await syncWeekOneGates(program.service, session.participantId, program.gates, update.state);
      await insertRawParticipantMessage(program.service, { participantId: session.participantId, week, content: 'Passt so', clientMessageId: request.body?.clientMessageId });
      const firstWish = update.state.wishes[0]?.raw_wish || confirmation.wishes[0];
      const baseQuestion = weekOnePrompt(update.state).question;
      const deepeningQuestion = resolveClarityPrompt(questionOverrides, 1, update.state.current_step, baseQuestion);
      const llm = { response: { message: `Perfekt. Deine drei Wünsche sind festgehalten. Schauen wir auf deinen ersten Wunsch: „${firstWish}“\n\n${deepeningQuestion}`, action: 'respond', step_status: 'completed' }, model: 'server', responseId: null, usage: null, uiAction: { type: 'complete_step', stepStatus: 'completed', confirmation: null } };
      const assistantMessage = await insertAssistantMessage(program.service, { participantId: session.participantId, week, llm, stateResult: { accepted: [{ action: 'confirm_wishes' }], rejected: [] } });
      const preconditions = { privacyConsent: Boolean(program.progress.privacy_consent_at), startCommitment: Boolean(program.progress.start_commitment_at) };
      return response.status(200).json({ message: { id: assistantMessage.id, role: 'assistant', content: llm.response.message, created_at: assistantMessage.created_at, uiAction: llm.uiAction }, weekOne: update.state, steps: statuses, gate: { complete: weekOneComplete(update.state, preconditions) } });
    }
    const content = typeof request.body?.message === 'string' ? request.body.message.trim().slice(0, 5000) : '';
    const clientMessageId = typeof request.body?.clientMessageId === 'string' ? request.body.clientMessageId.trim().slice(0, 100) : '';
    if (!content) return response.status(400).json({ error: 'Nachricht fehlt.' });
    if (clientMessageId && await findParticipantMessage(program.service, session.participantId, clientMessageId)) return response.status(409).json({ error: 'Diese Nachricht wurde bereits verarbeitet.', code: 'DUPLICATE_MESSAGE' });

    const raw = await insertRawParticipantMessage(program.service, { participantId: session.participantId, week, content, clientMessageId });
    const context = buildClaraContext({ participantId: session.participantId, participantName: program.profile.name, week, state: data.state, messages: [...data.messages, { role: 'participant', content, created_at: new Date().toISOString() }], memories: data.memories, rawEntries: [...data.rawEntries, raw.entry], commitment: { confirmed: Boolean(program.progress.start_commitment_at), confirmedAt: program.progress.start_commitment_at || null }, questionOverrides });
    const llm = await requestClaraResponse({ context, message: content, previousResponseId: data.previousResponseId });
    llm.response.extracted_information = validatedExtractions(llm.response.extracted_information, content);
    llm.response.memory_updates = validatedMemoryUpdates(llm.response.memory_updates, content);
    llm.uiAction = buildJourneyUiAction({ state: data.state, response: llm.response, participantId: session.participantId, week });
    const stateSuggestions = week === 1 && data.state.current_step === WEEK_ONE_STEPS.WISHES ? [] : llm.response.suggested_state_updates;
    const stateResult = applyClaraStateSuggestions(data.state, stateSuggestions);
    if (stateResult.changed) {
      if (week === 1) await saveWeekOneSnapshot(program.service, session.participantId, stateResult.state, content);
      else await saveGuidedWeekSnapshot(program.service, session.participantId, week, stateResult.state, content);
    }
    const statuses = stateResult.changed
      ? (week === 1 ? await syncWeekOneGates(program.service, session.participantId, program.gates, stateResult.state) : await syncGuidedWeekGates(program.service, session.participantId, program.gates, stateResult.state))
      : (week === 1 ? stepStatuses(stateResult.state) : guidedStepStatuses(stateResult.state));
    if (week >= 2 && stateResult.changed) {
      const nextStep = currentGuidedStep(stateResult.state);
      llm.response.message = nextStep
        ? `${llm.response.message}\n\n${resolveClarityPrompt(questionOverrides, week, nextStep.id, nextStep.question)}`
        : `${llm.response.message}\n\nDamit sind alle Schritte dieser Woche vollständig erfasst.`;
    }
    const assistantMessage = await insertAssistantMessage(program.service, { participantId: session.participantId, week, llm, stateResult });
    await persistMemoryUpdates(program.service, { participantId: session.participantId, week, sourceEntryId: raw.entry.id, sourceMessageId: raw.message.id, updates: llm.response.memory_updates });
    const preconditions = { privacyConsent: Boolean(program.progress.privacy_consent_at), startCommitment: Boolean(program.progress.start_commitment_at) };
    const complete = week === 1 ? weekOneComplete(stateResult.state, preconditions) : guidedWeekComplete(stateResult.state);
    return response.status(200).json({ message: { id: assistantMessage.id, role: 'assistant', content: llm.response.message, created_at: assistantMessage.created_at, uiAction: llm.uiAction }, responseId: llm.responseId, weekOne: week === 1 ? stateResult.state : undefined, weekState: week >= 2 ? stateResult.state : undefined, steps: statuses, gate: { complete }, applied: stateResult.accepted, rejected: stateResult.rejected });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Clara konnte deine Nachricht nicht verarbeiten.', code: error.code || 'CLARA_ERROR' });
  }
}
