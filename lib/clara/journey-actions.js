import crypto from 'node:crypto';
import { validateMinWords, WEEK_ONE_STEPS } from '../week-one.js';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function validWishConfirmation(state, response) {
  const wishes = response?.structured_data?.wishes;
  return state?.current_step === WEEK_ONE_STEPS.WISHES
    && response?.action === 'show_confirmation'
    && Array.isArray(wishes)
    && wishes.length === 3
    && wishes.every((wish) => validateMinWords(wish).valid);
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
  if (!validWishConfirmation(state, response)) return { type: response.action === 'show_confirmation' ? 'ask_followup' : response.action, stepStatus: response.action === 'show_confirmation' ? 'needs_clarification' : response.step_status, confirmation: null };
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
