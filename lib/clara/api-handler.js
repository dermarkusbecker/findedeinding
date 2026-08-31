import { requireCurrentPermission } from '../user-auth.js';
import { getParticipantProgramAccess, serviceHeaders } from '../program-access-service.js';
import { isOnboardingComplete } from '../program-access.js';
import { stepStatuses, weekOneComplete } from '../week-one.js';
import { buildClaraContext } from './context-builder.js';
import { requestClaraResponse } from './llm-client.js';
import { validatedExtractions, validatedMemoryUpdates } from './memory-policy.js';
import { applyClaraStateSuggestions } from './state-bridge.js';
import { findParticipantMessage, insertAssistantMessage, insertRawParticipantMessage, persistMemoryUpdates, readClaraData, saveWeekOneSnapshot } from './store.js';

async function syncWeekOneGates(service, participantId, gates, state) {
  const statuses = stepStatuses(state);
  const values = { three_wishes: statuses[0].status === 'completed', target_and_baseline: statuses[1].status === 'completed' && statuses[2].status === 'completed', career_history: statuses[3].status === 'completed' };
  await Promise.all(gates.filter((gate) => Number(gate.week) === 1 && gate.gate_key in values).map(async (gate) => {
    const result = await fetch(`${service.url}/rest/v1/week_gates?id=eq.${encodeURIComponent(gate.id)}&user_profile_id=eq.${encodeURIComponent(participantId)}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ completed_at: values[gate.gate_key] ? (gate.completed_at || new Date().toISOString()) : null }) });
    if (!result.ok) throw new Error('Der validierte Week-1-Gate-Status konnte nicht gespeichert werden.');
  }));
  return statuses;
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
    if (week !== 1) return response.status(400).json({ error: 'Der freie Clara-Dialog ist aktuell für Woche 1 aktiviert.' });
    const data = await readClaraData(program.service, session.participantId, week);
    if (request.method === 'GET') return response.status(200).json({ messages: data.messages, week, currentStep: data.state.current_step });
    if (request.method !== 'POST') return response.status(405).json({ error: 'Methode nicht erlaubt.' });
    const content = typeof request.body?.message === 'string' ? request.body.message.trim().slice(0, 5000) : '';
    const clientMessageId = typeof request.body?.clientMessageId === 'string' ? request.body.clientMessageId.trim().slice(0, 100) : '';
    if (!content) return response.status(400).json({ error: 'Nachricht fehlt.' });
    if (clientMessageId && await findParticipantMessage(program.service, session.participantId, clientMessageId)) return response.status(409).json({ error: 'Diese Nachricht wurde bereits verarbeitet.', code: 'DUPLICATE_MESSAGE' });

    const raw = await insertRawParticipantMessage(program.service, { participantId: session.participantId, week, content, clientMessageId });
    const context = buildClaraContext({ participantId: session.participantId, participantName: program.profile.name, week, state: data.state, messages: [...data.messages, { role: 'participant', content, created_at: new Date().toISOString() }], memories: data.memories, rawEntries: [...data.rawEntries, raw.entry] });
    const llm = await requestClaraResponse({ context, message: content });
    llm.response.extracted_information = validatedExtractions(llm.response.extracted_information, content);
    llm.response.memory_updates = validatedMemoryUpdates(llm.response.memory_updates, content);
    const stateResult = applyClaraStateSuggestions(data.state, llm.response.suggested_state_updates);
    if (stateResult.changed) await saveWeekOneSnapshot(program.service, session.participantId, stateResult.state, content);
    const statuses = stateResult.changed ? await syncWeekOneGates(program.service, session.participantId, program.gates, stateResult.state) : stepStatuses(stateResult.state);
    const assistantMessage = await insertAssistantMessage(program.service, { participantId: session.participantId, week, llm, stateResult });
    await persistMemoryUpdates(program.service, { participantId: session.participantId, week, sourceEntryId: raw.entry.id, sourceMessageId: raw.message.id, updates: llm.response.memory_updates });
    const preconditions = { privacyConsent: Boolean(program.progress.privacy_consent_at), startCommitment: Boolean(program.progress.start_commitment_at) };
    return response.status(200).json({ message: { id: assistantMessage.id, role: 'assistant', content: llm.response.message, created_at: assistantMessage.created_at }, weekOne: stateResult.state, steps: statuses, gate: { complete: weekOneComplete(stateResult.state, preconditions) }, applied: stateResult.accepted, rejected: stateResult.rejected });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Clara konnte deine Nachricht nicht verarbeiten.', code: error.code || 'CLARA_ERROR' });
  }
}
