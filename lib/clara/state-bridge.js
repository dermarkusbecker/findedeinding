import { applyWeekOneAction, WEEK_ONE_STEPS } from '../week-one.js';

const allowedByStep = {
  [WEEK_ONE_STEPS.ENTRY]: ['begin'],
  [WEEK_ONE_STEPS.WISHES]: ['save_wishes'],
  [WEEK_ONE_STEPS.WISH_1]: ['save_wish_followup'],
  [WEEK_ONE_STEPS.WISH_2]: ['save_wish_followup'],
  [WEEK_ONE_STEPS.WISH_3]: ['save_wish_followup'],
  [WEEK_ONE_STEPS.TARGET]: ['save_target'],
  [WEEK_ONE_STEPS.TARGET_CLARIFY]: ['clarify_target'],
  [WEEK_ONE_STEPS.CLARITY]: ['save_clarity', 'continue_clarity'],
  [WEEK_ONE_STEPS.CAREER_CHOICE]: [],
  [WEEK_ONE_STEPS.CAREER_DIALOG]: ['save_career_history'],
  [WEEK_ONE_STEPS.CAREER_CV]: [],
  [WEEK_ONE_STEPS.CAREER_CONFIRM]: ['confirm_career', 'save_career_history'],
  [WEEK_ONE_STEPS.REVIEW]: [],
};

function reducerAction(update) {
  const payload = update.payload || {};
  switch (update.action) {
    case 'begin': return { type: 'begin' };
    case 'save_wishes': return { type: 'save_wishes', wishes: payload.wishes };
    case 'correct_wish': return { type: 'correct_wish', wishIndex: Number(payload.wish_index), wish: payload.wish };
    case 'save_wish_followup': return { type: 'save_wish_followup', wishIndex: Number(payload.wish_index), answer: payload.answer };
    case 'save_target': return { type: 'save_target', answer: payload.answer };
    case 'clarify_target': return { type: 'clarify_target', answer: payload.answer };
    case 'save_clarity': return { type: 'save_clarity', score: Number(payload.score), reason: payload.reason };
    case 'continue_clarity': return { type: 'continue_clarity', reason: payload.reason };
    case 'choose_career_dialog': return { type: 'choose_career_dialog', source: payload.source };
    case 'save_career_history': return { type: 'save_career_history', answer: payload.answer, confirmed: payload.confirmed === true };
    case 'confirm_career': return { type: 'confirm_career', complete: payload.complete === true };
    default: return null;
  }
}

function permitted(state, update) {
  if (update.action === 'none') return true;
  if (update.action === 'correct_wish') return true;
  const allowed = allowedByStep[state.current_step] || [];
  if (!allowed.includes(update.action)) return false;
  if (update.action === 'save_wish_followup') {
    const activeIndex = Number(state.active_wish);
    return Number(update.payload?.wish_index) === activeIndex;
  }
  return true;
}

export function applyClaraStateSuggestions(state, suggestions = []) {
  let current = state;
  const accepted = [];
  const rejected = [];
  let stateChangeApplied = false;
  for (const suggestion of suggestions.slice(0, 3)) {
    if (suggestion.action === 'none') { accepted.push({ action: 'none' }); continue; }
    if (stateChangeApplied || !permitted(current, suggestion)) { rejected.push({ suggestion, reason: 'ACTION_NOT_ALLOWED_FOR_CURRENT_STEP' }); continue; }
    const action = reducerAction(suggestion);
    if (!action) { rejected.push({ suggestion, reason: 'UNKNOWN_ACTION' }); continue; }
    const result = applyWeekOneAction(current, action);
    if (!result.ok) { rejected.push({ suggestion, reason: result.details?.reason || 'REDUCER_REJECTED', error: result.error }); continue; }
    current = result.state;
    accepted.push({ action: suggestion.action, reducerAction: action });
    stateChangeApplied = true;
  }
  return { state: current, changed: current !== state, accepted, rejected };
}
