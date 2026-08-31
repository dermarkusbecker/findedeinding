import { serviceHeaders } from '../program-access-service.js';
import { createWeekOneState } from '../week-one.js';
import { CLARA_PROMPT_VERSION, CLARA_SCHEMA_VERSION } from './config.js';

async function read(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(data.message || fallback);
  return data;
}

export async function readClaraData(service, participantId, week = 1) {
  const id = encodeURIComponent(participantId);
  const headers = serviceHeaders(service.key);
  const [messages, memories, rawEntries, states] = await Promise.all([
    fetch(`${service.url}/rest/v1/clara_messages?user_profile_id=eq.${id}&week=eq.${week}&select=id,role,content,created_at&order=created_at.desc&limit=20`, { headers }).then((r) => read(r, 'Clara-Verlauf konnte nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/participant_memory?user_profile_id=eq.${id}&select=id,memory_type,topic,value,source_week,confidence,status,created_at&order=created_at.desc&limit=100`, { headers }).then((r) => read(r, 'Teilnehmer-Memory konnte nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${id}&select=id,week,data_block,raw_answer,created_at&raw_answer=not.is.null&order=created_at.desc&limit=40`, { headers }).then((r) => read(r, 'Rohantworten konnten nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${id}&week=eq.1&data_block=eq.week_1_state&select=structured_data&order=created_at.desc&limit=1`, { headers }).then((r) => read(r, 'Woche 1 konnte nicht geladen werden.')),
  ]);
  return { messages: messages.reverse(), memories: memories.reverse(), rawEntries: rawEntries.reverse(), state: states[0]?.structured_data?.week_1 || createWeekOneState() };
}

export async function findParticipantMessage(service, participantId, clientMessageId) {
  if (!clientMessageId) return null;
  const response = await fetch(`${service.url}/rest/v1/clara_messages?user_profile_id=eq.${encodeURIComponent(participantId)}&client_message_id=eq.${encodeURIComponent(clientMessageId)}&role=eq.participant&select=id&limit=1`, { headers: serviceHeaders(service.key) });
  return (await read(response, 'Nachricht konnte nicht geprüft werden.'))[0] || null;
}

export async function insertRawParticipantMessage(service, { participantId, week, content, clientMessageId }) {
  const entryResponse = await fetch(`${service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, data_block: `week_${week}_clara_dialog`, raw_answer: content, structured_data: {}, evidence_level: 'participant_statement' }) });
  const entry = (await read(entryResponse, 'Rohantwort konnte nicht gespeichert werden.'))[0];
  const messageResponse = await fetch(`${service.url}/rest/v1/clara_messages`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, role: 'participant', content, client_message_id: clientMessageId || null, source_entry_id: entry.id, prompt_version: CLARA_PROMPT_VERSION, schema_version: CLARA_SCHEMA_VERSION }) });
  return { entry, message: (await read(messageResponse, 'Clara-Nachricht konnte nicht gespeichert werden.'))[0] };
}

export async function insertAssistantMessage(service, { participantId, week, llm, stateResult }) {
  const response = await fetch(`${service.url}/rest/v1/clara_messages`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, role: 'assistant', content: llm.response.message, model: llm.model, model_response_id: llm.responseId, prompt_version: CLARA_PROMPT_VERSION, schema_version: CLARA_SCHEMA_VERSION, structured_response: llm.response, accepted_state_updates: stateResult.accepted, rejected_state_updates: stateResult.rejected, token_usage: llm.usage }) });
  return (await read(response, 'Claras Antwort konnte nicht gespeichert werden.'))[0];
}

export async function saveWeekOneSnapshot(service, participantId, state, rawAnswer) {
  const response = await fetch(`${service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(service.key), body: JSON.stringify({ user_profile_id: participantId, week: 1, data_block: 'week_1_state', raw_answer: String(rawAnswer).slice(0, 10000), structured_data: { week_1: state }, evidence_level: 'participant_statement' }) });
  if (!response.ok) throw new Error('Claras validierter Fortschritt konnte nicht gespeichert werden.');
}

export async function persistMemoryUpdates(service, { participantId, week, sourceEntryId, sourceMessageId, updates }) {
  for (const update of updates) {
    let superseded = null;
    if (update.operation === 'supersede') {
      const lookup = await fetch(`${service.url}/rest/v1/participant_memory?user_profile_id=eq.${encodeURIComponent(participantId)}&topic=eq.${encodeURIComponent(update.topic)}&status=eq.active&select=id,memory_version&order=created_at.desc&limit=1`, { headers: serviceHeaders(service.key) });
      superseded = (await read(lookup, 'Memory-Korrektur konnte nicht vorbereitet werden.'))[0] || null;
      if (superseded) {
        const changed = await fetch(`${service.url}/rest/v1/participant_memory?id=eq.${superseded.id}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ status: 'superseded', updated_at: new Date().toISOString() }) });
        if (!changed.ok) throw new Error('Vorheriges Memory konnte nicht versioniert werden.');
      }
    }
    const response = await fetch(`${service.url}/rest/v1/participant_memory`, { method: 'POST', headers: serviceHeaders(service.key), body: JSON.stringify({ user_profile_id: participantId, memory_type: update.memory_type, topic: update.topic, value: update.value, source_entry_id: sourceEntryId, source_message_id: sourceMessageId, source_week: week, confidence: update.confidence, status: 'active', supersedes_memory_id: superseded?.id || null, memory_version: Number(superseded?.memory_version || 0) + 1, extractor_version: `${CLARA_PROMPT_VERSION}/${CLARA_SCHEMA_VERSION}` }) });
    if (!response.ok) throw new Error('Teilnehmer-Memory konnte nicht gespeichert werden.');
  }
}
