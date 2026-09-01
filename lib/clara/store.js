import { serviceHeaders } from '../program-access-service.js';
import { createWeekOneState } from '../week-one.js';
import { CLARA_PROMPT_VERSION, CLARA_SCHEMA_VERSION } from './config.js';

async function read(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error(data.message || fallback);
  return data;
}

const missingRelation = (response, data = {}) => response.status === 404 || ['PGRST205', '42P01'].includes(data.code);

async function optionalRead(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok && missingRelation(response, data)) return null;
  if (!response.ok) throw new Error(data.message || fallback);
  return data;
}

export async function readClaraData(service, participantId, week = 1) {
  const id = encodeURIComponent(participantId);
  const headers = serviceHeaders(service.key);
  const [storedMessages, storedMemories, rawEntries, states] = await Promise.all([
    fetch(`${service.url}/rest/v1/clara_messages?user_profile_id=eq.${id}&week=eq.${week}&select=id,role,content,model_response_id,structured_response,created_at&order=created_at.desc&limit=20`, { headers }).then((r) => optionalRead(r, 'Clara-Verlauf konnte nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/participant_memory?user_profile_id=eq.${id}&select=id,memory_type,topic,value,source_week,confidence,status,created_at&order=created_at.desc&limit=100`, { headers }).then((r) => optionalRead(r, 'Teilnehmer-Memory konnte nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${id}&select=id,week,data_block,raw_answer,structured_data,created_at&raw_answer=not.is.null&order=created_at.desc&limit=80`, { headers }).then((r) => read(r, 'Rohantworten konnten nicht geladen werden.')),
    fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${id}&week=eq.1&data_block=eq.week_1_state&select=structured_data&order=created_at.desc&limit=1`, { headers }).then((r) => read(r, 'Woche 1 konnte nicht geladen werden.')),
  ]);
  const fallbackMessages = rawEntries.filter((entry) => ['week_1_clara_dialog', 'week_1_clara_assistant'].includes(entry.data_block)).map((entry) => ({ id: entry.id, role: entry.structured_data?.clara?.role || (entry.data_block.endsWith('assistant') ? 'assistant' : 'participant'), content: entry.raw_answer, model_response_id: entry.structured_data?.clara?.model_response_id || null, uiAction: entry.structured_data?.clara?.ui_action || null, created_at: entry.created_at }));
  const messages = (storedMessages || fallbackMessages).map((message) => ({ ...message, uiAction: message.uiAction || message.structured_response?._ui_action || null })).reverse();
  const previousResponseId = [...messages].reverse().find((message) => message.role === 'assistant' && message.model_response_id)?.model_response_id || null;
  return { messages, previousResponseId, memories: (storedMemories || []).reverse(), rawEntries: rawEntries.reverse(), state: states[0]?.structured_data?.week_1 || createWeekOneState() };
}

export async function findParticipantMessage(service, participantId, clientMessageId) {
  if (!clientMessageId) return null;
  const response = await fetch(`${service.url}/rest/v1/clara_messages?user_profile_id=eq.${encodeURIComponent(participantId)}&client_message_id=eq.${encodeURIComponent(clientMessageId)}&role=eq.participant&select=id&limit=1`, { headers: serviceHeaders(service.key) });
  const rows = await optionalRead(response, 'Nachricht konnte nicht geprüft werden.');
  if (rows) return rows[0] || null;
  const fallback = await fetch(`${service.url}/rest/v1/process_entries?user_profile_id=eq.${encodeURIComponent(participantId)}&data_block=eq.week_1_clara_dialog&select=id,structured_data&order=created_at.desc&limit=80`, { headers: serviceHeaders(service.key) });
  return (await read(fallback, 'Nachricht konnte nicht geprüft werden.')).find((entry) => entry.structured_data?.clara?.client_message_id === clientMessageId) || null;
}

export async function insertRawParticipantMessage(service, { participantId, week, content, clientMessageId }) {
  const entryResponse = await fetch(`${service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, data_block: `week_${week}_clara_dialog`, raw_answer: content, structured_data: { clara: { role: 'participant', client_message_id: clientMessageId || null } }, evidence_level: 'participant_statement' }) });
  const entry = (await read(entryResponse, 'Rohantwort konnte nicht gespeichert werden.'))[0];
  const messageResponse = await fetch(`${service.url}/rest/v1/clara_messages`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, role: 'participant', content, client_message_id: clientMessageId || null, source_entry_id: entry.id, prompt_version: CLARA_PROMPT_VERSION, schema_version: CLARA_SCHEMA_VERSION }) });
  const rows = await optionalRead(messageResponse, 'Clara-Nachricht konnte nicht gespeichert werden.');
  return { entry, message: rows?.[0] || { id: entry.id, role: 'participant', content, created_at: entry.created_at } };
}

export async function insertAssistantMessage(service, { participantId, week, llm, stateResult }) {
  const structuredResponse = { ...llm.response, _ui_action: llm.uiAction || null };
  const response = await fetch(`${service.url}/rest/v1/clara_messages`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, role: 'assistant', content: llm.response.message, model: llm.model, model_response_id: llm.responseId, prompt_version: CLARA_PROMPT_VERSION, schema_version: CLARA_SCHEMA_VERSION, structured_response: structuredResponse, accepted_state_updates: stateResult.accepted, rejected_state_updates: stateResult.rejected, token_usage: llm.usage }) });
  const rows = await optionalRead(response, 'Claras Antwort konnte nicht gespeichert werden.');
  if (rows?.[0]) return rows[0];
  const fallback = await fetch(`${service.url}/rest/v1/process_entries`, { method: 'POST', headers: serviceHeaders(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ user_profile_id: participantId, week, data_block: `week_${week}_clara_assistant`, raw_answer: llm.response.message, structured_data: { clara: { role: 'assistant', model: llm.model, model_response_id: llm.responseId, prompt_version: CLARA_PROMPT_VERSION, schema_version: CLARA_SCHEMA_VERSION, ui_action: llm.uiAction || null, accepted_state_updates: stateResult.accepted, rejected_state_updates: stateResult.rejected } }, evidence_level: 'derived' }) });
  return (await read(fallback, 'Claras Antwort konnte nicht gespeichert werden.'))[0];
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
      const lookupRows = await optionalRead(lookup, 'Memory-Korrektur konnte nicht vorbereitet werden.');
      if (lookupRows === null) return;
      superseded = lookupRows[0] || null;
      if (superseded) {
        const changed = await fetch(`${service.url}/rest/v1/participant_memory?id=eq.${superseded.id}`, { method: 'PATCH', headers: serviceHeaders(service.key), body: JSON.stringify({ status: 'superseded', updated_at: new Date().toISOString() }) });
        if (!changed.ok) throw new Error('Vorheriges Memory konnte nicht versioniert werden.');
      }
    }
    const response = await fetch(`${service.url}/rest/v1/participant_memory`, { method: 'POST', headers: serviceHeaders(service.key), body: JSON.stringify({ user_profile_id: participantId, memory_type: update.memory_type, topic: update.topic, value: update.value, source_entry_id: sourceEntryId, source_message_id: sourceMessageId, source_week: week, confidence: update.confidence, status: 'active', supersedes_memory_id: superseded?.id || null, memory_version: Number(superseded?.memory_version || 0) + 1, extractor_version: `${CLARA_PROMPT_VERSION}/${CLARA_SCHEMA_VERSION}` }) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (missingRelation(response, error)) return;
      throw new Error(error.message || 'Teilnehmer-Memory konnte nicht gespeichert werden.');
    }
  }
}
