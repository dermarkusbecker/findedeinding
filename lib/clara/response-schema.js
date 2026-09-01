import { CLARA_SCHEMA_VERSION } from './config.js';

const actionTypes = [
  'none', 'begin', 'save_wishes', 'correct_wish', 'save_wish_followup',
  'save_target', 'clarify_target', 'save_clarity', 'continue_clarity',
  'choose_career_dialog', 'save_career_history', 'confirm_career',
];
const journeyActions = ['respond', 'ask_followup', 'show_confirmation', 'complete_step', 'free_chat'];
const journeyModes = ['VALIDATE', 'COACH', 'REFINE', 'CONFIRM', 'FREE_CHAT'];
const journeyStatuses = ['open', 'in_progress', 'needs_clarification', 'awaiting_confirmation', 'confirmed', 'completed'];

export const claraResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema_version: { type: 'string', enum: [CLARA_SCHEMA_VERSION] },
    message: { type: 'string', minLength: 1, maxLength: 4000 },
    mode: { type: 'string', enum: journeyModes },
    action: { type: 'string', enum: journeyActions },
    step_status: { type: 'string', enum: journeyStatuses },
    structured_data: {
      type: 'object', additionalProperties: false,
      properties: {
        wishes: { type: ['array', 'null'], items: { type: 'string', minLength: 1, maxLength: 500 }, minItems: 3, maxItems: 3 },
        active_wish: { type: ['integer', 'null'], minimum: 0, maximum: 2 },
        clara_suggestion: { type: ['string', 'null'], maxLength: 1000 },
      },
      required: ['wishes', 'active_wish', 'clara_suggestion'],
    },
    intent: {
      type: 'object', additionalProperties: false,
      properties: { type: { type: 'string', maxLength: 80 }, target: { type: ['string', 'null'], maxLength: 160 }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
      required: ['type', 'target', 'confidence'],
    },
    extracted_information: {
      type: 'array', maxItems: 12, items: {
        type: 'object', additionalProperties: false,
        properties: { type: { type: 'string', maxLength: 80 }, topic: { type: 'string', maxLength: 120 }, value: { type: 'string', maxLength: 4000 }, source_quote: { type: 'string', maxLength: 1000 }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['type', 'topic', 'value', 'source_quote', 'confidence'],
      },
    },
    memory_updates: {
      type: 'array', maxItems: 12, items: {
        type: 'object', additionalProperties: false,
        properties: { operation: { type: 'string', enum: ['add', 'supersede'] }, memory_type: { type: 'string', enum: ['structured_fact', 'recurring_theme', 'tension', 'insight', 'open_question', 'preference', 'career_station'] }, topic: { type: 'string', maxLength: 120 }, value: { type: 'string', maxLength: 4000 }, reason: { type: 'string', maxLength: 300 }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['operation', 'memory_type', 'topic', 'value', 'reason', 'confidence'],
      },
    },
    suggested_state_updates: {
      type: 'array', maxItems: 3, items: {
        type: 'object', additionalProperties: false,
        properties: { action: { type: 'string', enum: actionTypes }, payload: {
          type: 'object', additionalProperties: false,
          properties: {
            wishes: { type: ['array', 'null'], items: { type: 'string' }, minItems: 3, maxItems: 3 },
            wish_index: { type: ['integer', 'null'], minimum: 0, maximum: 2 },
            wish: { type: ['string', 'null'] }, answer: { type: ['string', 'null'] }, score: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
            reason: { type: ['string', 'null'] }, source: { type: ['string', 'null'] }, confirmed: { type: ['boolean', 'null'] }, complete: { type: ['boolean', 'null'] },
          },
          required: ['wishes', 'wish_index', 'wish', 'answer', 'score', 'reason', 'source', 'confirmed', 'complete'],
        } },
        required: ['action', 'payload'],
      },
    },
    next_action: {
      type: 'object', additionalProperties: false,
      properties: { type: { type: 'string', enum: ['stay', 'return_to_open_step', 'advance_if_valid'] }, step: { type: ['string', 'null'], maxLength: 100 } },
      required: ['type', 'step'],
    },
    needs_followup: { type: 'boolean' },
  },
  required: ['schema_version', 'message', 'mode', 'action', 'step_status', 'structured_data', 'intent', 'extracted_information', 'memory_updates', 'suggested_state_updates', 'next_action', 'needs_followup'],
};

const plainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function validateClaraResponse(value) {
  if (!plainObject(value) || value.schema_version !== CLARA_SCHEMA_VERSION) return { valid: false, error: 'Ungültige Clara-Schemaversion.' };
  if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 4000) return { valid: false, error: 'Clara-Antwort fehlt.' };
  if (!journeyModes.includes(value.mode) || !journeyActions.includes(value.action) || !journeyStatuses.includes(value.step_status) || !plainObject(value.structured_data)) return { valid: false, error: 'Ungültige Journey-Action.' };
  const { wishes, active_wish: activeWish, clara_suggestion: suggestion } = value.structured_data;
  if (!(wishes === null || (Array.isArray(wishes) && wishes.length === 3 && wishes.every((wish) => typeof wish === 'string' && wish.trim() && wish.length <= 500)))) return { valid: false, error: 'Ungültige strukturierte Wünsche.' };
  if (!(activeWish === null || (Number.isInteger(activeWish) && activeWish >= 0 && activeWish <= 2)) || !(suggestion === null || (typeof suggestion === 'string' && suggestion.length <= 1000))) return { valid: false, error: 'Ungültige strukturierte Schrittdaten.' };
  if (!plainObject(value.intent) || typeof value.intent.type !== 'string' || !(value.intent.target === null || typeof value.intent.target === 'string') || typeof value.intent.confidence !== 'number') return { valid: false, error: 'Ungültige Intent-Struktur.' };
  for (const key of ['extracted_information', 'memory_updates', 'suggested_state_updates']) if (!Array.isArray(value[key])) return { valid: false, error: `Ungültiges Feld ${key}.` };
  if (value.suggested_state_updates.some((update) => !plainObject(update) || !actionTypes.includes(update.action) || !plainObject(update.payload))) return { valid: false, error: 'Nicht erlaubter State-Vorschlag.' };
  if (!plainObject(value.next_action) || !['stay', 'return_to_open_step', 'advance_if_valid'].includes(value.next_action.type) || typeof value.needs_followup !== 'boolean') return { valid: false, error: 'Ungültige Dialogsteuerung.' };
  return { valid: true, value };
}
