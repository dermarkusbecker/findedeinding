import crypto from 'node:crypto';
import { validateWishClarity, WEEK_ONE_STEPS } from '../week-one.js';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function claimsWishCompletion(response) {
  return response?.action === 'show_confirmation'
    || response?.action === 'complete_step'
    || (response?.needs_followup === false
      && response?.next_action?.type === 'advance_if_valid'
      && ['awaiting_confirmation', 'confirmed', 'completed'].includes(response?.step_status));
}

export function validWishConfirmation(state, response) {
  const wishes = response?.structured_data?.wishes;
  return state?.current_step === WEEK_ONE_STEPS.WISHES
    && claimsWishCompletion(response)
    && Array.isArray(wishes)
    && wishes.length === 3
    && wishes.every((wish) => validateWishClarity(wish).valid);
}

export function createConfirmationToken({ participantId, week, wishes, secret = process.env.AUTH_SECRET }) {
  if (!secret) throw new Error('Bestätigungen sind noch nicht konfiguriert.');
  const payload = encode({ participantId, week, wishes, expiresAt: Date.now() + 60 * 60 * 1000 });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyConfirmationToken(token, { participantId, secret = process.env.AUTH_SECRET } = {}) {
  if (!secret || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (value.participantId !== participantId || value.expiresAt < Date.now() || !Array.isArray(value.wishes)) return null;
    return value;
  } catch { return null; }
}

export function buildJourneyUiAction({ state, response, participantId, week }) {
  const inWishCollection = state?.current_step === WEEK_ONE_STEPS.WISHES;
  if (!validWishConfirmation(state, response)) {
    const invalidCompletion = inWishCollection && claimsWishCompletion(response);
    return {
      type: invalidCompletion || response.action === 'show_confirmation' ? 'ask_followup' : response.action,
      stepStatus: invalidCompletion || response.action === 'show_confirmation' ? 'needs_clarification' : response.step_status,
      confirmation: null,
    };
  }
  return {
    type: 'show_confirmation',
    stepStatus: 'awaiting_confirmation',
    confirmation: {
      kind: 'three_wishes',
      title: 'Clara hat deine drei Wünsche zusammengefasst',
      wishes: response.structured_data.wishes,
      token: createConfirmationToken({ participantId, week, wishes: response.structured_data.wishes }),
    },
  };
}

export function restorePendingJourneyConfirmation({ state, messages, participantId, week }) {
  if (state?.current_step !== WEEK_ONE_STEPS.WISHES || !Array.isArray(messages)) return messages;
  const restored = [...messages];
  for (let index = restored.length - 1; index >= 0; index -= 1) {
    const message = restored[index];
    if (message?.role !== 'assistant' || !message?.structured_response) continue;
    const uiAction = buildJourneyUiAction({ state, response: message.structured_response, participantId, week });
    if (uiAction.type === 'show_confirmation') restored[index] = { ...message, uiAction };
    break;
  }
  return restored;
}
