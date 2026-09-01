import OpenAI from 'openai';
import { claraConfig, CLARA_PROMPT_VERSION } from './config.js';
import { claraDeveloperPrompt, claraContextInput } from './prompts.js';
import { claraResponseJsonSchema, validateClaraResponse } from './response-schema.js';

export async function requestClaraResponse({ context, message, previousResponseId = null, client = null, env = process.env }) {
  const config = claraConfig(env);
  if (!config.apiKey) throw Object.assign(new Error('Claras KI-Verbindung ist noch nicht konfiguriert.'), { status: 503, code: 'CLARA_NOT_CONFIGURED' });
  const openai = client || new OpenAI({ apiKey: config.apiKey });
  let data;
  try {
    data = await openai.responses.create({
      model: config.model,
      store: true,
      reasoning: { effort: config.reasoningEffort },
      max_output_tokens: config.maxOutputTokens,
      instructions: claraDeveloperPrompt(),
      input: claraContextInput(context, message),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      text: { format: { type: 'json_schema', name: 'clara_response', strict: true, schema: claraResponseJsonSchema } },
      metadata: { prompt_version: CLARA_PROMPT_VERSION, week: String(context.week) },
      safety_identifier: `participant_${context.participantId}`,
      prompt_cache_key: `clara:${CLARA_PROMPT_VERSION}:week:${context.week}`,
    });
  } catch (error) {
    throw Object.assign(new Error(error.message || 'Clara konnte gerade nicht antworten.'), { status: Number(error.status) >= 500 ? 502 : Number(error.status) || 502, code: 'LLM_REQUEST_FAILED' });
  }
  let parsed;
  try { parsed = JSON.parse(data.output_text || ''); } catch { throw Object.assign(new Error('Claras Antwort hatte ein ungültiges Format.'), { status: 502, code: 'INVALID_LLM_JSON' }); }
  const validation = validateClaraResponse(parsed);
  if (!validation.valid) throw Object.assign(new Error(validation.error), { status: 502, code: 'INVALID_LLM_RESPONSE' });
  return { response: validation.value, model: data.model || config.model, responseId: data.id || null, usage: data.usage || null };
}
